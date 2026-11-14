// Package agent turns a user request into a stream of UI operations.
//
// The text model writes one JSON object per line (a scene header followed by
// content blocks). Each complete line is forwarded to the browser as soon as
// it arrives, and every block that carries an image prompt starts an image
// generation in parallel, so layout and pictures fill in independently.
package agent

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Lewin671/folio/internal/ark"
	"github.com/Lewin671/folio/internal/library"
	"github.com/Lewin671/folio/internal/profile"
)

//go:embed prompt.md
var systemPrompt string

const (
	maxInputRunes = 400
	maxHistory    = 3
	maxImages     = 4
	maxTurnBytes  = 6 << 20 // room for one attached picture
	imageTimeout  = 75 * time.Second
)

// Pictures of a subject are shot on a seamless backdrop in the scene colour
// (%s). The page is then painted in the colour the picture really has, so the
// subject stands directly on the page without background removal. A "scene"
// is a full picture of a place or moment and is shown framed instead.
type imageKind struct {
	size, suffix string
	framed       bool // no backdrop to continue: skip colour sampling
}

var imageStyle = map[string]imageKind{
	"subject": {"768x1200", "Museum-catalogue studio image of the subject alone, whole subject visible and centred with generous empty space around it, photograph or realistic 3D render as fits the subject. Seamless backdrop and floor in one flat uniform colour: %s. Soft even light, no text, no labels, no captions, no people.", false},
	"set":     {"960x960", "Flat lay seen from directly above, the objects neatly arranged in the centre with space between them and a clear margin around. Flat uniform backdrop in %s. Soft even light, no text, no labels.", false},
	"detail":  {"960x960", "Close-up studio image of the detail, subject centred. Plain out-of-focus backdrop in %s. Soft even light, no text, no labels.", false},
	"scene":   {"960x960", "Wide atmospheric image of the place or moment, natural light, cinematic and realistic, no text, no captions. Colour mood leaning towards %s.", true},
}

type Agent struct {
	Ark         *ark.Client
	TextModel   string
	ImageModel  string
	VisionModel string         // puts an attached picture into words
	Profile     *profile.Store // what is remembered about the user
	Library     *library.Store // earlier pages and their pictures
	Debug       bool           // log every line the text model writes
}

type turn struct {
	User string            `json:"user"`
	Ops  []json.RawMessage `json:"ops"`
}

type request struct {
	Input   string            `json:"input"`
	History []turn            `json:"history"`
	Images  map[string]string `json:"images"` // block id -> image URL of the previous scene
	Image   string            `json:"image"`  // optional picture the question is about, as a data URL
}

type sse struct {
	mu sync.Mutex
	w  http.ResponseWriter
	f  http.Flusher
}

func (s *sse) send(event string, data any) {
	buf, err := json.Marshal(data)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, buf)
	s.f.Flush()
}

func (a *Agent) HandleTurn(w http.ResponseWriter, r *http.Request) {
	var req request
	lang := langOf(r)
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxTurnBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	req.Input = strings.TrimSpace(req.Input)
	if req.Input == "" && req.Image != "" {
		req.Input = say(lang, "What is this? Tell me about it.", "这是什么？讲讲它。")
	}
	if req.Input == "" {
		http.Error(w, "empty input", http.StatusBadRequest)
		return
	}
	if rs := []rune(req.Input); len(rs) > maxInputRunes {
		req.Input = string(rs[:maxInputRunes])
	}
	if len(req.History) > maxHistory {
		req.History = req.History[len(req.History)-maxHistory:]
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	out := &sse{w: w, f: flusher}

	ctx := r.Context()
	start := time.Now()
	since := func() int64 { return time.Since(start).Milliseconds() }
	out.send("meta", map[string]any{"text_model": a.TextModel, "image_model": a.ImageModel})

	msgs := []ark.Message{{Role: "system", Content: systemPrompt + languageNote(lang) + profileNote(a.Profile.Get())}}
	for _, t := range req.History {
		lines := make([]string, len(t.Ops))
		for i, op := range t.Ops {
			lines[i] = string(op)
		}
		msgs = append(msgs, ark.Message{Role: "user", Content: t.User}, ark.Message{Role: "assistant", Content: strings.Join(lines, "\n")})
	}
	// The text model cannot see pictures, so an attached one is first put into
	// words; the browser keeps those words as part of the question for later turns.
	question := req.Input
	if req.Image != "" {
		seen, err := a.look(ctx, req.Image, lang)
		if err != nil {
			log.Printf("look: %v", err)
			msg := ark.Hint(err, lang)
			if msg == "" {
				msg = say(lang, "Couldn’t make out that picture. Please try another.", "没能看清这张图，请换一张再试。")
			}
			out.send("error", map[string]any{"message": msg})
			out.send("end", map[string]any{"ms": since()})
			return
		}
		question = fmt.Sprintf(say(lang, "%s\n\n(The user attached a picture. It shows: %s)", "%s\n\n（用户附了一张图片。图片里是：%s）"), req.Input, seen)
		// The picture is kept so the page still shows it when reopened later.
		kept, err := a.keepUpload(req.Image)
		if err != nil {
			log.Printf("keep upload: %v", err)
		}
		out.send("seen", map[string]any{"text": question, "url": kept})
	}
	msgs = append(msgs, ark.Message{Role: "user", Content: question})

	var (
		wg     sync.WaitGroup
		lines  lineBuffer
		nOps   int
		nImgs  int
		seenID = map[string]bool{}
		// The scene line sets the backdrop for every picture that follows.
		sceneBg, sceneBgName string
	)
	handle := func(line string) {
		if a.Debug {
			log.Printf("line: %s", line)
		}
		op, ok := parseOp(line)
		if !ok {
			return
		}
		// A remembered preference is not part of the page: it is stored and
		// the browser is only told, so the user can see it and take it back.
		if op["t"] == "remember" {
			var texts []string
			if items, ok := op["items"].([]any); ok {
				for _, it := range items {
					if s, ok := it.(string); ok {
						texts = append(texts, s)
					}
				}
			}
			if added, err := a.Profile.AddPrefs(texts); err != nil {
				log.Printf("remember: %v", err)
			} else if len(added) > 0 {
				out.send("memory", map[string]any{"added": added, "profile": a.Profile.Get()})
			}
			return
		}
		id, _ := op["id"].(string)
		if id == "" || seenID[id] {
			id = fmt.Sprintf("b%d", nOps)
			op["id"] = id
		}
		seenID[id] = true
		if op["t"] == "scene" {
			sceneBg, _ = op["bg"].(string)
			sceneBgName, _ = op["bgName"].(string)
		}
		if nOps == 0 {
			out.send("first", map[string]any{"ms": since()})
		}
		nOps++

		prompt, _ := op["prompt"].(string)
		keep, _ := op["keep"].(bool)
		t := op["t"]
		wantsImage := (t == "image" || t == "option") && prompt != "" && !keep
		if wantsImage && nImgs >= maxImages {
			wantsImage = false
			delete(op, "prompt")
		}
		if wantsImage {
			op["pending"] = true
		}
		out.send("op", op)
		if !wantsImage {
			return
		}
		nImgs++
		kind, _ := op["kind"].(string)
		style, ok := imageStyle[kind]
		if !ok {
			style = imageStyle["subject"]
		}
		bg, bgName := sceneBg, sceneBgName
		if own, _ := op["bg"].(string); hexRe.MatchString(strings.TrimSpace(own)) {
			bg = own
			bgName, _ = op["bgName"].(string)
		}
		var refs []string
		if edit, _ := op["edit"].(bool); edit {
			if ref := a.editRef(req.Images[id]); ref != "" {
				refs = []string{ref}
			}
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			ictx, cancel := context.WithTimeout(ctx, imageTimeout)
			defer cancel()
			t0 := time.Now()
			full := prompt + ". " + fmt.Sprintf(style.suffix, backdrop(bg, bgName))
			if len(refs) > 0 {
				full = prompt + " Keep everything else, including the backdrop colour, the same."
			}
			u, err := a.Ark.Image(ictx, a.ImageModel, full, style.size, refs)
			if err != nil {
				log.Printf("image %s: %v", id, err)
				out.send("image_error", map[string]any{"id": id})
				if msg := ark.Hint(err, lang); msg != "" {
					out.send("error", map[string]any{"message": msg})
				}
				return
			}
			// The picture is copied here, because the service's link stops working
			// after a while and the page should still open later. If the copy
			// fails the page shows the original link, on the colour the model asked for.
			var stops []string
			if data, err := fetchPicture(ictx, u); err != nil {
				log.Printf("fetch %s: %v", id, err)
			} else {
				if !style.framed {
					stops = stopsOf(data)
				}
				if local, err := a.Library.SaveImage(data); err != nil {
					log.Printf("keep %s: %v", id, err)
				} else {
					u = local
				}
			}
			out.send("image", map[string]any{"id": id, "url": u, "stops": stops, "ms": since(), "took_ms": time.Since(t0).Milliseconds()})
		}()
	}

	err := a.Ark.ChatStream(ctx, a.TextModel, msgs, 1400, func(delta string) {
		for _, line := range lines.feed(delta) {
			handle(line)
		}
	})
	if rest := lines.flush(); rest != "" {
		handle(rest)
	}
	if err != nil && ctx.Err() == nil {
		log.Printf("chat: %v", err)
		msg := ark.Hint(err, lang)
		if msg == "" {
			msg = say(lang, "The model didn’t respond. Please try again.", "模型暂时没有回应，请再试一次。")
		}
		out.send("error", map[string]any{"message": msg})
	} else if nOps == 0 && ctx.Err() == nil {
		out.send("error", map[string]any{"message": say(lang, "Nothing came out this time. Try asking another way.", "这次没有生成出内容，请换个说法再试。")})
	}
	out.send("scene_done", map[string]any{"ms": since(), "ops": nOps})
	wg.Wait()
	out.send("end", map[string]any{"ms": since()})
}

// lineBuffer splits a token stream into complete lines.
type lineBuffer struct{ buf strings.Builder }

func (l *lineBuffer) feed(delta string) []string {
	l.buf.WriteString(delta)
	s := l.buf.String()
	i := strings.LastIndexByte(s, '\n')
	if i < 0 {
		return nil
	}
	l.buf.Reset()
	l.buf.WriteString(s[i+1:])
	return strings.Split(s[:i], "\n")
}

func (l *lineBuffer) flush() string {
	s := l.buf.String()
	l.buf.Reset()
	return s
}

// parseOp accepts one model output line and returns it as a UI operation.
// Anything that is not a JSON object with a "t" field is dropped, which also
// discards stray code fences or prose.
func parseOp(line string) (map[string]any, bool) {
	line = strings.TrimSpace(line)
	line = strings.TrimSuffix(line, ",")
	if !strings.HasPrefix(line, "{") {
		return nil, false
	}
	var op map[string]any
	if json.Unmarshal([]byte(line), &op) != nil {
		return nil, false
	}
	if t, _ := op["t"].(string); t == "" {
		return nil, false
	}
	delete(op, "pending")
	return op, true
}

// validRef only lets image URLs issued by Volcengine storage be fetched, so a
// client cannot make this server or the image service fetch arbitrary URLs.
func validRef(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	h := u.Hostname()
	return strings.HasSuffix(h, ".volces.com") || strings.HasSuffix(h, ".volccdn.com") || strings.HasSuffix(h, ".byteimg.com")
}
