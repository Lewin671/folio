// Package library keeps the pages the user has made, so a conversation can be
// reopened later and from another device. A thread is one conversation: the
// pages in the order they were made. Pictures are copied here as well, because
// the image service only serves its links for a short time.
package library

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxThreads  = 300
	ImagePrefix = "/api/img/" // how saved pictures are addressed in pages
)

var (
	hexRe   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
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
	Bg      string    `json:"bg,omitempty"`  // the first page's colour, for the list
	Img     string    `json:"img,omitempty"` // and its main picture
}

type Thread struct {
	Meta
	Pages json.RawMessage `json:"pages"` // laid out by the browser; opaque here
}

type Store struct {
	threads, images string
	mu              sync.Mutex
	index           map[string]Meta
	ordered         []Meta
	refs            map[string][]string
	threadCache     cache[Thread]
	imageCache      cache[cachedImage]
}

func Open(dir string) (*Store, error) {
	s := &Store{threads: filepath.Join(dir, "threads"), images: filepath.Join(dir, "images"), index: make(map[string]Meta), refs: make(map[string][]string)}
	for _, d := range []string{s.threads, s.images} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, err
		}
	}
	// Build metadata and image references once. Even a damaged thread file
	// protects its pictures from sweeping until the thread is removed.
	files, err := filepath.Glob(filepath.Join(s.threads, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		buf, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		s.refs[strings.TrimSuffix(filepath.Base(f), ".json")] = imageRefs(buf)
		var m Meta
		if json.Unmarshal(buf, &m) == nil && idRe.MatchString(m.ID) && filepath.Base(f) == m.ID+".json" {
			s.index[m.ID] = m
		}
	}
	s.sortIndex()
	return s, nil
}

// SaveImage stores a picture and returns the address pages refer to it by.
func (s *Store) SaveImage(data []byte) (string, error) {
	contentType := http.DetectContentType(data)
	ext, ok := imgExts[contentType]
	if !ok {
		return "", errors.New("not a picture")
	}
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	name := hex.EncodeToString(b) + ext
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.WriteFile(filepath.Join(s.images, name), data, 0o600); err != nil {
		return "", err
	}
	s.cacheImage(name, data, contentType)
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
func (s *Store) Put(id, title, bg, img string, pages json.RawMessage) error {
	count, valid := pageCount(pages)
	if !idRe.MatchString(id) || !valid {
		return ErrBad
	}
	if !hexRe.MatchString(bg) {
		bg = ""
	}
	if _, ok := s.ImageFile(img); !ok {
		img = ""
	}
	t := Thread{Meta: Meta{ID: id, Title: title, Updated: time.Now().UTC(), Count: count, Bg: bg, Img: img}, Pages: pages}
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
	s.index[id] = t.Meta
	s.refs[id] = imageRefs(buf)
	s.threadCache.put(id, cloneThread(t), 0, 32, 0)
	s.sortIndex()
	if len(s.ordered) > maxThreads {
		old := append([]Meta(nil), s.ordered[maxThreads:]...)
		for _, m := range old {
			s.remove(m.ID)
		}
	}
	return nil
}

func (s *Store) Get(id string) (Thread, error) {
	var t Thread
	if !idRe.MatchString(id) {
		return t, ErrBad
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.threadCache.get(id); ok {
		return cloneThread(t), nil
	}
	buf, err := os.ReadFile(s.path(id))
	if err != nil {
		return t, err
	}
	if err := json.Unmarshal(buf, &t); err != nil {
		return t, err
	}
	s.threadCache.put(id, t, 0, 32, 0)
	return cloneThread(t), nil
}

// List returns every thread, most recent first.
func (s *Store) List() []Meta { return s.ListN(0) }

// ListN returns at most limit entries; a non-positive limit returns all entries.
func (s *Store) ListN(limit int) []Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.ordered)
	if limit > 0 && limit < n {
		n = limit
	}
	out := make([]Meta, n)
	copy(out, s.ordered[:n])
	return out
}

func (s *Store) sortIndex() {
	s.ordered = s.ordered[:0]
	for _, m := range s.index {
		s.ordered = append(s.ordered, m)
	}
	sort.Slice(s.ordered, func(i, j int) bool {
		if s.ordered[i].Updated.Equal(s.ordered[j].Updated) {
			return s.ordered[i].ID < s.ordered[j].ID
		}
		return s.ordered[i].Updated.After(s.ordered[j].Updated)
	})
}

func cloneThread(t Thread) Thread {
	t.Pages = bytes.Clone(t.Pages)
	return t
}

// pageCount validates the complete JSON document without retaining every page.
func pageCount(pages []byte) (int, bool) {
	dec := json.NewDecoder(bytes.NewReader(pages))
	token, err := dec.Token()
	if err != nil || token != json.Delim('[') {
		return 0, false
	}
	var page json.RawMessage
	count := 0
	for dec.More() {
		if dec.Decode(&page) != nil {
			return 0, false
		}
		count++
	}
	token, err = dec.Token()
	if err != nil || token != json.Delim(']') || count == 0 {
		return 0, false
	}
	return count, dec.Decode(&page) == io.EOF
}

func imageRefs(buf []byte) []string {
	var refs []string
	for _, m := range imgRef.FindAllSubmatch(buf, -1) {
		refs = append(refs, string(m[1]))
	}
	return refs
}

func (s *Store) usedImage(name string) bool {
	for _, refs := range s.refs {
		for _, ref := range refs {
			if ref == name {
				return true
			}
		}
	}
	return false
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
	if err := os.Remove(s.path(id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	refs := s.refs[id]
	delete(s.index, id)
	delete(s.refs, id)
	s.threadCache.remove(id)
	s.sortIndex()
	for _, name := range refs {
		// Pictures may be reused by another conversation.
		if !s.usedImage(name) {
			os.Remove(filepath.Join(s.images, name))
			s.imageCache.remove(name)
		}
	}
	return nil
}

// Sweep removes pictures no thread refers to, such as those of a page that was
// abandoned or replaced. Recent ones are left: their page may not be saved yet.
func (s *Store) Sweep(olderThan time.Duration) {
	// Directory enumeration does not stall readers or writers. Recheck references
	// and modification time under the lock immediately before each removal.
	entries, _ := os.ReadDir(s.images)
	for _, e := range entries {
		if !nameRe.MatchString(e.Name()) {
			continue
		}
		s.mu.Lock()
		info, err := os.Stat(filepath.Join(s.images, e.Name()))
		if err == nil && !s.usedImage(e.Name()) && time.Since(info.ModTime()) >= olderThan {
			if os.Remove(filepath.Join(s.images, e.Name())) == nil {
				s.imageCache.remove(e.Name())
			}
		}
		s.mu.Unlock()
	}
}

type cachedImage struct {
	data        []byte
	contentType string
	etag        string
}

const maxCachedImage = 2 << 20

func (s *Store) cacheImage(name string, data []byte, contentType string) {
	if len(data) <= maxCachedImage {
		s.imageCache.put(name, cachedImage{data: bytes.Clone(data), contentType: contentType, etag: imageETag(name)}, len(data), 64, 16<<20)
	}
}

// DiscardImage removes an abandoned upload, unless a saved thread uses it.
func (s *Store) DiscardImage(ref string) error {
	file, ok := s.ImageFile(ref)
	if !ok {
		return ErrBad
	}
	name := filepath.Base(file)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.usedImage(name) {
		return nil
	}
	if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.imageCache.remove(name)
	return nil
}

// Image names are fresh random IDs and immutable, so the name identifies the
// representation even after cache eviction or a restart. No content hash needed.
func imageETag(name string) string { return `"` + name + `"` }

// ReadImage reads a saved picture, returning independent bytes and its ETag.
func (s *Store) ReadImage(ref string) ([]byte, string, string, bool) {
	file, ok := s.ImageFile(ref)
	if !ok {
		return nil, "", "", false
	}
	name := filepath.Base(file)
	s.mu.Lock()
	defer s.mu.Unlock()
	if img, ok := s.imageCache.get(name); ok {
		return bytes.Clone(img.data), img.contentType, img.etag, true
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, "", "", false
	}
	contentType := http.DetectContentType(data)
	if _, ok := imgExts[contentType]; !ok {
		return nil, "", "", false
	}
	s.cacheImage(name, data, contentType)
	return data, contentType, imageETag(name), true
}
