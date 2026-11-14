// Package library keeps the pages the user has made, so a conversation can be
// reopened later and from another device. A thread is one conversation: the
// pages in the order they were made. Pictures are copied here as well, because
// the image service only serves its links for a short time.
package library

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

const (
	maxThreads  = 300
	ImagePrefix = "/api/img/" // how saved pictures are addressed in pages
)

var (
	idRe    = regexp.MustCompile(`^[a-z0-9]{6,24}$`)
	nameRe  = regexp.MustCompile(`^[a-f0-9]{24}\.(jpg|png|webp)$`)
	imgRef  = regexp.MustCompile(`/api/img/([a-f0-9]{24}\.(?:jpg|png|webp))`)
	ErrBad  = errors.New("bad thread")
	imgExts = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
)

// Meta is what the history list shows.
type Meta struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Updated time.Time `json:"updated"`
	Count   int       `json:"count"`
}

type Thread struct {
	Meta
	Pages json.RawMessage `json:"pages"` // laid out by the browser; opaque here
}

type Store struct {
	threads, images string
	mu              sync.Mutex
}

func Open(dir string) (*Store, error) {
	s := &Store{threads: filepath.Join(dir, "threads"), images: filepath.Join(dir, "images")}
	for _, d := range []string{s.threads, s.images} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// SaveImage stores a picture and returns the address pages refer to it by.
func (s *Store) SaveImage(data []byte) (string, error) {
	ext, ok := imgExts[http.DetectContentType(data)]
	if !ok {
		return "", errors.New("not a picture")
	}
	b := make([]byte, 12)
	rand.Read(b)
	name := hex.EncodeToString(b) + ext
	if err := os.WriteFile(filepath.Join(s.images, name), data, 0o600); err != nil {
		return "", err
	}
	return ImagePrefix + name, nil
}

// ImageFile resolves a saved picture's address or bare name to its file.
func (s *Store) ImageFile(ref string) (string, bool) {
	name := ref
	if len(ref) > len(ImagePrefix) && ref[:len(ImagePrefix)] == ImagePrefix {
		name = ref[len(ImagePrefix):]
	}
	if !nameRe.MatchString(name) {
		return "", false
	}
	return filepath.Join(s.images, name), true
}

func (s *Store) path(id string) string { return filepath.Join(s.threads, id+".json") }

// Put saves a thread, replacing an earlier version of it.
func (s *Store) Put(id, title string, pages json.RawMessage) error {
	var list []json.RawMessage
	if !idRe.MatchString(id) || json.Unmarshal(pages, &list) != nil || len(list) == 0 {
		return ErrBad
	}
	t := Thread{Meta: Meta{ID: id, Title: title, Updated: time.Now().UTC(), Count: len(list)}, Pages: pages}
	buf, err := json.Marshal(t)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tmp := s.path(id) + ".tmp"
	if err := os.WriteFile(tmp, buf, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path(id)); err != nil {
		return err
	}
	if all := s.list(); len(all) > maxThreads {
		for _, old := range all[maxThreads:] {
			s.remove(old.ID)
		}
	}
	return nil
}

func (s *Store) Get(id string) (Thread, error) {
	var t Thread
	if !idRe.MatchString(id) {
		return t, ErrBad
	}
	buf, err := os.ReadFile(s.path(id))
	if err != nil {
		return t, err
	}
	return t, json.Unmarshal(buf, &t)
}

// List returns every thread, most recent first.
func (s *Store) List() []Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.list()
}

func (s *Store) list() []Meta {
	out := []Meta{}
	files, _ := filepath.Glob(filepath.Join(s.threads, "*.json"))
	for _, f := range files {
		buf, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var m Meta
		if json.Unmarshal(buf, &m) == nil && m.ID != "" {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out
}

// Delete removes a thread together with its pictures.
func (s *Store) Delete(id string) error {
	if !idRe.MatchString(id) {
		return ErrBad
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.remove(id)
}

func (s *Store) remove(id string) error {
	buf, err := os.ReadFile(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, m := range imgRef.FindAllSubmatch(buf, -1) {
		os.Remove(filepath.Join(s.images, string(m[1])))
	}
	return os.Remove(s.path(id))
}

// Sweep removes pictures no thread refers to, such as those of a page that was
// abandoned or replaced. Recent ones are left: their page may not be saved yet.
func (s *Store) Sweep(olderThan time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	used := map[string]bool{}
	files, _ := filepath.Glob(filepath.Join(s.threads, "*.json"))
	for _, f := range files {
		buf, _ := os.ReadFile(f)
		for _, m := range imgRef.FindAllSubmatch(buf, -1) {
			used[string(m[1])] = true
		}
	}
	entries, _ := os.ReadDir(s.images)
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || used[e.Name()] || time.Since(info.ModTime()) < olderThan {
			continue
		}
		os.Remove(filepath.Join(s.images, e.Name()))
	}
}
