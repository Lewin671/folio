package profile

import (
	"os"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := s.AddPhoto([]byte("a"))
	b, _ := s.AddPhoto([]byte("b"))
	if !a.Main || b.Main {
		t.Fatalf("first photo should be main: %+v %+v", a, b)
	}
	if got, _ := s.AddPrefs([]string{"不穿高跟鞋", "  不穿高跟鞋 ", "", "喜欢藏青"}); len(got) != 2 {
		t.Fatalf("want 2 new prefs, got %v", got)
	}
	if _, ok := s.PhotoPath("../../etc/passwd"); ok {
		t.Fatal("path traversal id accepted")
	}

	// Deleting the main photo promotes another; reopening sees the same state.
	s.DeletePhoto(a.ID)
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := s2.Get()
	if len(p.Photos) != 1 || !p.Photos[0].Main || p.Photos[0].ID != b.ID || len(p.Prefs) != 2 {
		t.Fatalf("unexpected profile after reopen: %+v", p)
	}
	if buf, ok := s2.MainPhoto(); !ok || string(buf) != "b" {
		t.Fatalf("main photo = %q %v", buf, ok)
	}

	path, _ := s2.PhotoPath(b.ID)
	s2.Clear()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("photo file should be removed by Clear")
	}
	if p := s2.Get(); len(p.Photos)+len(p.Prefs) != 0 {
		t.Fatalf("profile not empty after Clear: %+v", p)
	}
}
