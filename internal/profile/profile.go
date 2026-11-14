// Package profile keeps what the app remembers about its one user on disk:
// things the user has said about themselves and how they like explanations.
// It lives in one directory readable only by the account running the server.
package profile

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	maxPrefs    = 40
	maxPrefLen  = 60
	profileFile = "profile.json"
)

type Pref struct {
	ID    string    `json:"id"`
	Text  string    `json:"text"`
	Added time.Time `json:"added"`
}

type Profile struct {
	Prefs []Pref `json:"prefs"`
}

type Store struct {
	dir string
	mu  sync.Mutex
	p   Profile
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
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
	return Profile{Prefs: append([]Pref{}, s.p.Prefs...)}
}

// AddPrefs remembers new facts and returns the ones that were not already known.
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

// Clear forgets everything.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
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
