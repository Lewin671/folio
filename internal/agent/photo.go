package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"atelier/internal/profile"
)

// Only photos the user has confirmed as themselves enter the profile. The
// vision model proposes, the user decides:
//   - several people in the picture: always ask which one;
//   - one person and a confirmed photo to compare with: accept without asking
//     only at high confidence, and say so, so it can be undone;
//   - anything else: ask.
//
// The model was seen picking the wrong person from a group with 0.85
// confidence, which is why a group is never decided automatically.
const (
	autoConfidence = 0.9
	maxUploadBytes = 6 << 20
	maxPeople      = 6
	pendingTTL     = 15 * time.Minute
	maxPending     = 8
	minCropHeight  = 240
	visionTimeout  = 40 * time.Second
)

type person struct {
	Box  [4]float64 `json:"box"` // x1, y1, x2, y2 as fractions of the picture
	Desc string     `json:"desc"`
}

type pendingUpload struct {
	img     image.Image
	people  []person
	expires time.Time
}

type uploads struct {
	mu sync.Mutex
	m  map[string]*pendingUpload
}

func (u *uploads) put(p *pendingUpload) string {
	b := make([]byte, 12)
	rand.Read(b)
	token := hex.EncodeToString(b)
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.m == nil {
		u.m = map[string]*pendingUpload{}
	}
	now := time.Now()
	for k, v := range u.m {
		if now.After(v.expires) || len(u.m) >= maxPending {
			delete(u.m, k)
		}
	}
	p.expires = now.Add(pendingTTL)
	u.m[token] = p
	return token
}

func (u *uploads) take(token string) *pendingUpload {
	u.mu.Lock()
	defer u.mu.Unlock()
	p := u.m[token]
	delete(u.m, token)
	if p == nil || time.Now().After(p.expires) {
		return nil
	}
	return p
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func dataURL(jpg []byte) string {
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpg)
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// jsonIn pulls the first JSON value out of a model answer, which may be
// wrapped in a code fence or followed by a remark.
func jsonIn(answer string, v any) error {
	i := strings.IndexAny(answer, "{[")
	if i < 0 {
		return fmt.Errorf("no json in %q", answer)
	}
	return json.NewDecoder(strings.NewReader(answer[i:])).Decode(v)
}

const findPeoplePrompt = `找出图中每一个真实的人（不算海报、屏幕、镜框里的人像）。按从左到右输出 JSON 数组，每个人一个对象：{"box":[x1,y1,x2,y2],"desc":"一句话，说清发型和衣服，便于区分"}。box 是这个人全身可见部分的边界框，坐标归一化到 0-1000。没有人就输出 []。只输出 JSON。`

// findPeople locates the people in a picture, left to right.
func (a *Agent) findPeople(ctx context.Context, jpg []byte) ([]person, error) {
	answer, err := a.Ark.Vision(ctx, a.VisionModel, findPeoplePrompt, []string{dataURL(jpg)})
	if err != nil {
		return nil, err
	}
	var raw []struct {
		Box  []float64 `json:"box"`
		Desc string    `json:"desc"`
	}
	if err := jsonIn(answer, &raw); err != nil {
		return nil, err
	}
	people := []person{}
	for _, r := range raw {
		if len(r.Box) != 4 || len(people) >= maxPeople {
			continue
		}
		var b [4]float64
		for i, v := range r.Box {
			b[i] = min(max(v/1000, 0), 1)
		}
		if b[2]-b[0] < 0.03 || b[3]-b[1] < 0.06 {
			continue // too small to be a usable picture of anyone
		}
		people = append(people, person{Box: b, Desc: clipRunes(r.Desc, 40)})
	}
	return people, nil
}

// matchUser asks which of the people is the person in the confirmed profile
// photo. It returns -1 when none is, with the model's own confidence.
func (a *Agent) matchUser(ctx context.Context, known, jpg []byte, people []person) (int, float64) {
	var list strings.Builder
	for i, p := range people {
		fmt.Fprintf(&list, "%d. %s\n", i+1, p.Desc)
	}
	prompt := fmt.Sprintf("第一张图是已确认的用户本人。第二张图里有 %d 个人，从左到右编号：\n%s比较面部五官、脸型和发际线（衣服和发型可能变了，不能作为依据），判断其中哪一个是第一张图里的同一个人；都不是就填 0。拿不准时把 confidence 填低。只输出 JSON：{\"index\":编号,\"confidence\":0到1}", len(people), list.String())
	answer, err := a.Ark.Vision(ctx, a.VisionModel, prompt, []string{dataURL(known), dataURL(jpg)})
	if err != nil {
		log.Printf("match: %v", err)
		return -1, 0
	}
	var out struct {
		Index      int     `json:"index"`
		Confidence float64 `json:"confidence"`
	}
	if jsonIn(answer, &out) != nil || out.Index < 0 || out.Index > len(people) {
		return -1, 0
	}
	return out.Index - 1, min(max(out.Confidence, 0), 1)
}

// HandleInspect receives a picture and reports who is in it and which of them
// is probably the user. Nothing is stored until the choice is confirmed.
func (a *Agent) HandleInspect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Image string `json:"image"` // data URL, already downscaled and upright
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxUploadBytes)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "图片太大或格式不对。")
		return
	}
	_, b64, ok := strings.Cut(req.Image, ";base64,")
	raw, err := base64.StdEncoding.DecodeString(b64)
	if !ok || err != nil {
		fail(w, http.StatusBadRequest, "图片格式不对。")
		return
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil || img.Bounds().Dx() < 200 || img.Bounds().Dy() < 200 || img.Bounds().Dx() > 4000 || img.Bounds().Dy() > 4000 {
		fail(w, http.StatusBadRequest, "这张图读不出来，换一张试试。")
		return
	}
	jpg, err := encodeJPEG(img)
	if err != nil {
		fail(w, http.StatusInternalServerError, "图片处理失败。")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), visionTimeout)
	defer cancel()

	people, err := a.findPeople(ctx, jpg)
	if err != nil {
		log.Printf("inspect: %v", err)
		fail(w, http.StatusBadGateway, "没能看清这张图，请再试一次。")
		return
	}
	guess, confidence := -1, 0.0
	known, hasKnown := a.Profile.MainPhoto()
	if hasKnown && len(people) > 0 {
		guess, confidence = a.matchUser(ctx, known, jpg, people)
	}
	resp := map[string]any{
		"people":     people,
		"guess":      guess,
		"confidence": confidence,
		"known":      hasKnown,
		"auto":       hasKnown && len(people) == 1 && guess == 0 && confidence >= autoConfidence,
	}
	if len(people) > 0 {
		resp["token"] = a.pending.put(&pendingUpload{img: img, people: people})
	}
	writeJSON(w, http.StatusOK, resp)
}

// cropPerson cuts one person out of a picture with a little room around them,
// so the stored photo shows the user and nobody else.
func cropPerson(img image.Image, box [4]float64) image.Image {
	b := img.Bounds()
	w, h := float64(b.Dx()), float64(b.Dy())
	padX, padY := (box[2]-box[0])*0.10, (box[3]-box[1])*0.05
	r := image.Rect(
		b.Min.X+int(max(box[0]-padX, 0)*w), b.Min.Y+int(max(box[1]-padY, 0)*h),
		b.Min.X+int(min(box[2]+padX, 1)*w), b.Min.Y+int(min(box[3]+padY, 1)*h),
	)
	type subImager interface {
		SubImage(image.Rectangle) image.Image
	}
	if s, ok := img.(subImager); ok {
		return s.SubImage(r)
	}
	return img
}

const appearancePrompt = `用一句中文描述这个人和穿搭建议有关的外观：性别呈现、发型和发色、肤色偏冷还是偏暖、身形轮廓。不要描述衣服和配饰，不要猜年龄、种族、姓名或职业，不要评价好看与否。不超过 40 个字，只输出这句话。`

// HandleConfirm stores the person the user pointed at as a photo of themselves.
func (a *Agent) HandleConfirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
		Index int    `json:"index"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	up := a.pending.take(req.Token)
	if up == nil || req.Index < 0 || req.Index >= len(up.people) {
		fail(w, http.StatusGone, "这张图已经过期，请重新上传。")
		return
	}
	crop := cropPerson(up.img, up.people[req.Index].Box)
	if crop.Bounds().Dy() < minCropHeight {
		fail(w, http.StatusUnprocessableEntity, "照片里的你太小了，换一张近一点的。")
		return
	}
	jpg, err := encodeJPEG(crop)
	if err != nil {
		fail(w, http.StatusInternalServerError, "图片处理失败。")
		return
	}
	photo, err := a.Profile.AddPhoto(jpg)
	if err != nil {
		log.Printf("save photo: %v", err)
		fail(w, http.StatusInternalServerError, "没存上，请再试一次。")
		return
	}
	if photo.Main {
		a.describe(r.Context(), jpg)
	}
	writeJSON(w, http.StatusOK, map[string]any{"photo": photo, "profile": a.Profile.Get()})
}

// describe notes what the main photo shows, so advice fits the user even in
// answers that have no picture. A failure only leaves the note empty.
func (a *Agent) describe(ctx context.Context, jpg []byte) {
	ctx, cancel := context.WithTimeout(ctx, visionTimeout)
	defer cancel()
	text, err := a.Ark.Vision(ctx, a.VisionModel, appearancePrompt, []string{dataURL(jpg)})
	if err != nil {
		log.Printf("describe: %v", err)
		return
	}
	a.Profile.SetAppearance(strings.TrimPrefix(strings.TrimSpace(text), "为"))
}

func (a *Agent) HandleProfile(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleClearProfile(w http.ResponseWriter, _ *http.Request) {
	if err := a.Profile.Clear(); err != nil {
		fail(w, http.StatusInternalServerError, "没清掉，请再试一次。")
		return
	}
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandlePhotoFile(w http.ResponseWriter, r *http.Request) {
	path, ok := a.Profile.PhotoPath(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}

func (a *Agent) HandleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	a.Profile.DeletePhoto(r.PathValue("id"))
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleMainPhoto(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.Profile.SetMain(id)
	if jpg, ok := a.Profile.MainPhoto(); ok {
		a.describe(r.Context(), jpg)
	}
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleDeletePref(w http.ResponseWriter, r *http.Request) {
	a.Profile.DeletePref(r.PathValue("id"))
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

// profileNote is what the text model is told about the user on every turn.
func profileNote(p profile.Profile) string {
	if len(p.Photos) == 0 && len(p.Prefs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n## 用户档案（当前用户）\n\n")
	if len(p.Photos) > 0 {
		b.WriteString("- 有本人照片：是\n")
	}
	if p.Appearance != "" {
		fmt.Fprintf(&b, "- 外观：%s\n", p.Appearance)
	}
	for _, pref := range p.Prefs {
		fmt.Fprintf(&b, "- 记住的偏好：%s\n", pref.Text)
	}
	return b.String()
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if rs := []rune(s); len(rs) > n {
		return string(rs[:n])
	}
	return s
}
