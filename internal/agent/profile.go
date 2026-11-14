package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Lewin671/folio/internal/ark"
	"github.com/Lewin671/folio/internal/profile"
)

const visionTimeout = 40 * time.Second

const lookPrompt = `用中文描述这张图片，供一位讲解员据此为用户讲解。说清：画面的主体是什么（尽量具体到种类、型号、作品或地点；拿不准就说"可能是"并说明依据）、值得讲的细节、画面里能读出的文字。如果是题目、图表或文档，把内容完整转述出来。不要识别或猜测画面中真实人物的身份，只描述其可见特征。不超过 220 字，只输出描述。`

// look puts an attached picture into words for the text model. Only pictures
// that decode as images are forwarded.
func (a *Agent) look(ctx context.Context, dataURL string) (string, error) {
	_, b64, ok := strings.Cut(dataURL, ";base64,")
	raw, err := base64.StdEncoding.DecodeString(b64)
	if !ok || err != nil {
		return "", fmt.Errorf("not a base64 data url")
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(raw)); err != nil {
		return "", fmt.Errorf("not an image: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, visionTimeout)
	defer cancel()
	text, err := a.Ark.Vision(ctx, a.VisionModel, lookPrompt, []string{dataURL})
	if err != nil {
		return "", err
	}
	return clipRunes(text, 400), nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (a *Agent) HandleProfile(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleClearProfile(w http.ResponseWriter, _ *http.Request) {
	if err := a.Profile.Clear(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "没清掉，请再试一次。"})
		return
	}
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleDeletePref(w http.ResponseWriter, r *http.Request) {
	a.Profile.DeletePref(r.PathValue("id"))
	writeJSON(w, http.StatusOK, a.Profile.Get())
}

// profileNote is what the text model is told about the user on every turn.
func profileNote(p profile.Profile) string {
	if len(p.Prefs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n## 用户档案（当前用户）\n\n")
	for _, pref := range p.Prefs {
		fmt.Fprintf(&b, "- %s\n", pref.Text)
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

// Setup reports what stops the app from working with the configured key and
// models, in words for the person who started it. An empty list means ready.
func (a *Agent) Setup(ctx context.Context) []string {
	checks := []struct {
		model string
		run   func(context.Context, string) error
	}{
		{a.TextModel, a.Ark.CheckChat},
		{a.VisionModel, a.Ark.CheckChat},
		{a.ImageModel, a.Ark.CheckImage},
	}
	problems := make([]string, len(checks))
	var wg sync.WaitGroup
	for i, c := range checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			if err := c.run(cctx, c.model); err != nil {
				log.Printf("setup check %s: %v", c.model, err)
				if problems[i] = ark.Hint(err); problems[i] == "" {
					problems[i] = fmt.Sprintf("连不上模型 %s，请检查网络。", c.model)
				}
			}
		}()
	}
	wg.Wait()
	seen := map[string]bool{}
	out := []string{}
	for _, p := range problems {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// HandleSetup lets the page tell a first-time user what is missing.
func (a *Agent) HandleSetup(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"problems": a.Setup(r.Context())})
}
