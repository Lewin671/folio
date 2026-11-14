package agent

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Lewin671/folio/internal/ark"
	"github.com/Lewin671/folio/internal/httpx"
	"github.com/Lewin671/folio/internal/profile"
)

const lookPromptEN = `Describe this picture in English for an explainer who will use your description to explain it to the user. Say what the main subject is (as specific as you can: species, model, artwork or place; if unsure, say "possibly" and give your reason), which details are worth explaining, and any text that can be read. If it is a problem, a chart or a document, restate its content in full. Do not identify or guess who any real person is; describe only what is visible. At most 130 words. Output only the description.`

const visionTimeout = 40 * time.Second

const lookPrompt = `用中文描述这张图片，供一位讲解员据此为用户讲解。说清：画面的主体是什么（尽量具体到种类、型号、作品或地点；拿不准就说"可能是"并说明依据）、值得讲的细节、画面里能读出的文字。如果是题目、图表或文档，把内容完整转述出来。不要识别或猜测画面中真实人物的身份，只描述其可见特征。不超过 220 字，只输出描述。`

// look puts an attached picture into words for the text model. Only pictures
// that decode as images are forwarded.
func (a *Agent) look(ctx context.Context, dataURL, lang string) (string, error) {
	if _, err := decodeUpload(dataURL); err != nil {
		return "", err
	}
	return a.describe(ctx, dataURL, lang)
}

func decodeUpload(dataURL string) ([]byte, error) {
	_, b64, ok := strings.Cut(dataURL, ";base64,")
	raw, err := base64.StdEncoding.DecodeString(b64)
	if !ok || err != nil {
		return nil, fmt.Errorf("not a base64 data url")
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(raw)); err != nil {
		return nil, fmt.Errorf("not an image: %w", err)
	}
	return raw, nil
}

func (a *Agent) describe(ctx context.Context, dataURL, lang string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, visionTimeout)
	defer cancel()
	text, err := a.Ark.Vision(ctx, a.VisionModel, say(lang, lookPromptEN, lookPrompt), []string{dataURL})
	a.invalidateSetup(err)
	if err != nil {
		return "", err
	}
	return clipRunes(text, 400), nil
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(v); err != nil {
		http.Error(w, "json encoding failed", 500)
		return
	}
	data := buf.Bytes()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Add("Vary", "Accept-Encoding")
	if len(data) >= 512 && httpx.AcceptsGzip(r) {
		data = httpx.Gzip(data, gzip.DefaultCompression)
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.WriteHeader(status)
	w.Write(data)
}

func (a *Agent) HandleProfile(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleClearProfile(w http.ResponseWriter, r *http.Request) {
	if err := a.Profile.Clear(); err != nil {
		writeJSON(w, r, http.StatusInternalServerError, map[string]string{"error": say(langOf(r), "Couldn’t clear it. Please try again.", "没清掉，请再试一次。")})
		return
	}
	writeJSON(w, r, http.StatusOK, a.Profile.Get())
}

func (a *Agent) HandleDeletePref(w http.ResponseWriter, r *http.Request) {
	a.Profile.DeletePref(r.PathValue("id"))
	writeJSON(w, r, http.StatusOK, a.Profile.Get())
}

// profileNote is what the text model is told about the user on every turn.
func profileNote(p profile.Profile) string {
	if len(p.Prefs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n## 关于用户的记忆\n\n")
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
type setupResult struct {
	model string
	err   error
}

type setupFlight struct {
	done    chan struct{}
	results []setupResult
}

type setupCache struct {
	mu         sync.Mutex
	expires    time.Time
	results    []setupResult
	flight     *setupFlight
	generation uint64
}

func (a *Agent) invalidateSetup(err error) {
	var apiErr *ark.APIError
	if !errors.As(err, &apiErr) {
		return
	}
	a.setup.mu.Lock()
	a.setup.expires = time.Time{}
	a.setup.generation++
	a.setup.mu.Unlock()
}

func (a *Agent) Setup(ctx context.Context, lang string) []string {
	return a.setupProblems(ctx, lang, false)
}

func (a *Agent) setupProblems(ctx context.Context, lang string, fresh bool) []string {
	a.setup.mu.Lock()
	if !fresh && time.Now().Before(a.setup.expires) {
		results := a.setup.results
		a.setup.mu.Unlock()
		return formatSetup(results, lang)
	}
	flight := a.setup.flight
	if flight == nil {
		flight = &setupFlight{done: make(chan struct{})}
		a.setup.flight = flight
		generation := a.setup.generation
		// One disconnected browser must not cancel checks shared by other callers.
		go func() {
			results := a.checkSetup(context.WithoutCancel(ctx))
			ttl := 5 * time.Minute
			for _, result := range results {
				if result.err != nil {
					ttl = 15 * time.Second
					break
				}
			}
			a.setup.mu.Lock()
			flight.results = results
			if generation == a.setup.generation {
				a.setup.results = results
				a.setup.expires = time.Now().Add(ttl)
			}
			a.setup.flight = nil
			close(flight.done)
			a.setup.mu.Unlock()
		}()
	}
	a.setup.mu.Unlock()
	select {
	case <-flight.done:
		return formatSetup(flight.results, lang)
	case <-ctx.Done():
		return formatSetup([]setupResult{{a.TextModel, ctx.Err()}}, lang)
	}
}

func (a *Agent) checkSetup(ctx context.Context) []setupResult {
	checks := []struct {
		model string
		run   func(context.Context, string) error
	}{{a.TextModel, a.Ark.CheckChat}, {a.VisionModel, a.Ark.CheckChat}, {a.ImageModel, a.Ark.CheckImage}}
	results := make([]setupResult, len(checks))
	var wg sync.WaitGroup
	for i, c := range checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			err := c.run(cctx, c.model)
			if err != nil {
				log.Printf("setup check %s: %v", c.model, err)
			}
			results[i] = setupResult{c.model, err}
		}()
	}
	wg.Wait()
	return results
}

func formatSetup(results []setupResult, lang string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, result := range results {
		if result.err == nil {
			continue
		}
		p := ark.Hint(result.err, lang)
		if p == "" {
			p = fmt.Sprintf(say(lang, "Can’t reach model %s. Check the network.", "连不上模型 %s，请检查网络。"), result.model)
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// HandleSetup lets the page tell a first-time user what is missing.
func (a *Agent) HandleSetup(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{"problems": a.setupProblems(r.Context(), langOf(r), r.URL.Query().Get("fresh") == "1")})
}
