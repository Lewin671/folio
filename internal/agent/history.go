package agent

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/Lewin671/folio/internal/library"
)

const maxThreadBytes = 4 << 20

// keepUpload stores the picture a question came with and returns its address.
func (a *Agent) keepUpload(dataURL string) (string, error) {
	_, b64, _ := strings.Cut(dataURL, ";base64,")
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	return a.Library.SaveImage(raw)
}

// editRef turns the picture a block showed on the previous page into a
// reference for the image model: a saved picture is sent inline, and anything
// else must be a link the image service issued itself.
func (a *Agent) editRef(ref string) string {
	if file, ok := a.Library.ImageFile(ref); ok && strings.HasPrefix(ref, library.ImagePrefix) {
		data, err := os.ReadFile(file)
		if err != nil {
			return ""
		}
		return "data:" + http.DetectContentType(data) + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	if validRef(ref) {
		return ref
	}
	return ""
}

func (a *Agent) HandleImage(w http.ResponseWriter, r *http.Request) {
	file, ok := a.Library.ImageFile(r.PathValue("name"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	// A picture never changes once saved.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, file)
}

func (a *Agent) HandleThreads(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"threads": a.Library.List()})
}

func (a *Agent) HandleThread(w http.ResponseWriter, r *http.Request) {
	t, err := a.Library.Get(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": say(langOf(r), "That conversation is no longer here.", "这段记录已经不在了。")})
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *Agent) HandleSaveThread(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string          `json:"title"`
		Bg    string          `json:"bg"`
		Img   string          `json:"img"`
		Pages json.RawMessage `json:"pages"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxThreadBytes)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": say(langOf(r), "That conversation is too large to save.", "这段记录太大了，没能保存。")})
		return
	}
	err := a.Library.Put(r.PathValue("id"), clipRunes(body.Title, 60), strings.TrimSpace(body.Bg), body.Img, body.Pages)
	switch {
	case errors.Is(err, library.ErrBad):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": say(langOf(r), "Couldn’t save this conversation.", "没能保存这段记录。")})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": say(langOf(r), "Couldn’t save this conversation.", "没能保存这段记录。")})
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (a *Agent) HandleDeleteThread(w http.ResponseWriter, r *http.Request) {
	if err := a.Library.Delete(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": say(langOf(r), "Couldn’t delete it. Please try again.", "没删掉，请再试一次。")})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"threads": a.Library.List()})
}
