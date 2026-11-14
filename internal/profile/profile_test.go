package profile

import "testing"

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.AddPrefs([]string{"初中生", "  初中生 ", "", "喜欢用比喻讲"})
	if len(got) != 2 {
		t.Fatalf("want 2 new prefs, got %v", got)
	}
	s.DeletePref(got[0].ID)

	// Reopening sees the same state.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if p := s2.Get(); len(p.Prefs) != 1 || p.Prefs[0].Text != "喜欢用比喻讲" {
		t.Fatalf("unexpected profile after reopen: %+v", p)
	}
	s2.Clear()
	if p := s2.Get(); len(p.Prefs) != 0 {
		t.Fatalf("profile not empty after Clear: %+v", p)
	}
}
