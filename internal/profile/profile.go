// Package profile keeps what the app remembers about its one user on disk:
// confirmed photos of the user, a short appearance note and stated
// preferences. Everything lives under one directory readable only by the
// account running the server.
package profile

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxPhotos   = 12
	maxPrefs    = 40
	maxPrefLen  = 60
	profileFile = "profile.json"
)

var idRe = regexp.MustCompile(`^[0-9a-f]{16}$`)

type Photo struct {
	ID    string    `json:"id"`
	Added time.Time `json:"added"`
	Main  bool      `json:"main"` // the one used as the reference for try-on pictures
}

type Pref struct {
	ID    string    `json:"id"`
	Text  string    `json:"text"`
	Added time.Time `json:"added"`
}

type Profile struct {
	Photos     []Photo `json:"photos"`
	Appearance string  `json:"appearance"`
	Prefs      []Pref  `json:"prefs"`
}

type Store struct {
	dir string
	mu  sync.Mutex
	p   Profile
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "photos"), 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
	buf, err := os.ReadFile(filepath.Join(dir, profileFile))
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(buf, &s.p); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// save writes the profile atomically; the caller holds the lock.
func (s *Store) save() error {
	buf, err := json.MarshalIndent(s.p, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dir, profileFile+".tmp")
	if err := os.WriteFile(tmp, buf, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dir, profileFile))
}

func (s *Store) Get() Profile {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Profile{
		Photos:     append([]Photo{}, s.p.Photos...),
		Appearance: s.p.Appearance,
		Prefs:      append([]Pref{}, s.p.Prefs...),
	}
}

func (s *Store) photoPath(id string) string { return filepath.Join(s.dir, "photos", id+".jpg") }

// PhotoPath returns the file of a stored photo, or false for an unknown id.
func (s *Store) PhotoPath(id string) (string, bool) {
	if !idRe.MatchString(id) {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ph := range s.p.Photos {
		if ph.ID == id {
			return s.photoPath(id), true
		}
	}
	return "", false
}

// MainPhoto returns the JPEG used as the try-on reference.
func (s *Store) MainPhoto() ([]byte, bool) {
	s.mu.Lock()
	id := ""
	for _, ph := range s.p.Photos {
		if ph.Main {
			id = ph.ID
		}
	}
	s.mu.Unlock()
	if id == "" {
		return nil, false
	}
	buf, err := os.ReadFile(s.photoPath(id))
	return buf, err == nil
}

// AddPhoto stores a confirmed photo of the user. The first one becomes the
// main photo; when the album is full the oldest non-main photo makes room.
func (s *Store) AddPhoto(jpeg []byte) (Photo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ph := Photo{ID: newID(), Added: time.Now().UTC(), Main: len(s.p.Photos) == 0}
	if err := os.WriteFile(s.photoPath(ph.ID), jpeg, 0o600); err != nil {
		return Photo{}, err
	}
	if len(s.p.Photos) >= maxPhotos {
		for i, old := range s.p.Photos {
			if !old.Main {
				os.Remove(s.photoPath(old.ID))
				s.p.Photos = append(s.p.Photos[:i], s.p.Photos[i+1:]...)
				break
			}
		}
	}
	s.p.Photos = append(s.p.Photos, ph)
	return ph, s.save()
}

func (s *Store) DeletePhoto(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, ph := range s.p.Photos {
		if ph.ID != id {
			continue
		}
		os.Remove(s.photoPath(id))
		s.p.Photos = append(s.p.Photos[:i], s.p.Photos[i+1:]...)
		if ph.Main && len(s.p.Photos) > 0 {
			s.p.Photos[len(s.p.Photos)-1].Main = true
		}
		if len(s.p.Photos) == 0 {
			s.p.Appearance = "" // it described a picture that is gone
		}
		return s.save()
	}
	return nil
}

func (s *Store) SetMain(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	found := false
	for _, ph := range s.p.Photos {
		found = found || ph.ID == id
	}
	if !found {
		return nil
	}
	for i := range s.p.Photos {
		s.p.Photos[i].Main = s.p.Photos[i].ID == id
	}
	return s.save()
}

func (s *Store) SetAppearance(text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.p.Appearance = clip(text, 120)
	return s.save()
}

// AddPrefs remembers new preferences and returns the ones that were not
// already known.
func (s *Store) AddPrefs(texts []string) ([]Pref, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var added []Pref
	for _, t := range texts {
		t = clip(t, maxPrefLen)
		if t == "" || s.hasPref(t) {
			continue
		}
		p := Pref{ID: newID(), Text: t, Added: time.Now().UTC()}
		s.p.Prefs = append(s.p.Prefs, p)
		added = append(added, p)
	}
	if over := len(s.p.Prefs) - maxPrefs; over > 0 {
		s.p.Prefs = s.p.Prefs[over:]
	}
	if len(added) == 0 {
		return nil, nil
	}
	return added, s.save()
}

func (s *Store) hasPref(t string) bool {
	for _, p := range s.p.Prefs {
		if p.Text == t {
			return true
		}
	}
	return false
}

func (s *Store) DeletePref(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, p := range s.p.Prefs {
		if p.ID == id {
			s.p.Prefs = append(s.p.Prefs[:i], s.p.Prefs[i+1:]...)
			return s.save()
		}
	}
	return nil
}

// Clear forgets everything, including the photo files.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ph := range s.p.Photos {
		os.Remove(s.photoPath(ph.ID))
	}
	s.p = Profile{}
	return s.save()
}

func clip(t string, n int) string {
	t = strings.Join(strings.Fields(t), " ")
	if rs := []rune(t); len(rs) > n {
		t = string(rs[:n])
	}
	return t
}
