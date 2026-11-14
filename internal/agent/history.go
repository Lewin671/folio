package agent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Lewin671/folio/internal/httpx"
	"github.com/Lewin671/folio/internal/library"
)

const maxThreadBytes = 4 << 20

// editRef turns the picture a block showed on the previous page into a
// reference for the image model: a saved picture is sent inline, and anything
// else must be a link the image service issued itself.
func (a *Agent) editRef(ref string) string {
	if strings.HasPrefix(ref, library.ImagePrefix) {
		data, contentType, _, ok := a.Library.ReadImage(ref)
		if !ok {
			return ""
		}
		return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
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
	if data, contentType, tag, ok := a.Library.ReadImage(r.PathValue("name")); ok {
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("ETag", tag)
		if httpx.NotModified(w, r, tag) {
			return
		}
		http.ServeContent(w, r, file, time.Time{}, bytes.NewReader(data))
		return
	}
	http.ServeFile(w, r, file)
}

func (a *Agent) HandleThreads(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{"threads": a.Library.ListN(threadLimit(r))})
}

func (a *Agent) HandleThread(w http.ResponseWriter, r *http.Request) {
	t, err := a.Library.Get(r.PathValue("id"))
	if err != nil {
		writeJSON(w, r, http.StatusNotFound, map[string]string{"error": say(langOf(r), "That conversation is no longer here.", "这段记录已经不在了。")})
		return
	}
	writeJSON(w, r, http.StatusOK, t)
}

func (a *Agent) HandleSaveThread(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string          `json:"title"`
		Bg    string          `json:"bg"`
		Img   string          `json:"img"`
		Pages json.RawMessage `json:"pages"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxThreadBytes)).Decode(&body); err != nil {
		writeJSON(w, r, http.StatusBadRequest, map[string]string{"error": say(langOf(r), "That conversation is too large to save.", "这段记录太大了，没能保存。")})
		return
	}
	err := a.Library.Put(r.PathValue("id"), clipRunes(body.Title, 60), strings.TrimSpace(body.Bg), body.Img, body.Pages)
	switch {
	case errors.Is(err, library.ErrBad):
		writeJSON(w, r, http.StatusBadRequest, map[string]string{"error": say(langOf(r), "Couldn’t save this conversation.", "没能保存这段记录。")})
	case err != nil:
		writeJSON(w, r, http.StatusInternalServerError, map[string]string{"error": say(langOf(r), "Couldn’t save this conversation.", "没能保存这段记录。")})
	default:
		writeJSON(w, r, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (a *Agent) HandleDeleteThread(w http.ResponseWriter, r *http.Request) {
	if err := a.Library.Delete(r.PathValue("id")); err != nil {
		writeJSON(w, r, http.StatusInternalServerError, map[string]string{"error": say(langOf(r), "Couldn’t delete it. Please try again.", "没删掉，请再试一次。")})
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"threads": a.Library.List()})
}

func threadLimit(r *http.Request) int { n, _ := strconv.Atoi(r.URL.Query().Get("limit")); return n }
