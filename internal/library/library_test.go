package library

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"testing"
)

func picture(t *testing.T) []byte {
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestThreadsAndPictures(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	kept, _ := s.SaveImage(picture(t))
	orphan, _ := s.SaveImage(picture(t))
	if _, err := s.SaveImage([]byte("<html>")); err == nil {
		t.Fatal("non-picture accepted")
	}
	pages, _ := json.Marshal([]map[string]string{{"img": kept}})
	if err := s.Put("abc123", "标题", "#112233", kept, pages); err != nil {
		t.Fatal(err)
	}
	if err := s.Put("../etc", "x", "", "", pages); err == nil {
		t.Fatal("bad id accepted")
	}
	if err := s.Put("abc124", "x", "", "", json.RawMessage(`[]`)); err == nil {
		t.Fatal("empty thread accepted")
	}
	if l := s.List(); len(l) != 1 || l[0].Title != "标题" || l[0].Count != 1 || l[0].Img != kept {
		t.Fatalf("list = %+v", l)
	}
	if got, err := s.Get("abc123"); err != nil || !bytes.Equal(got.Pages, pages) {
		t.Fatalf("get = %+v, %v", got, err)
	}
	if _, ok := s.ImageFile("/api/img/../../x.jpg"); ok {
		t.Fatal("path escape accepted")
	}

	s.Sweep(0)
	exists := func(ref string) bool {
		p, ok := s.ImageFile(ref)
		if !ok {
			t.Fatalf("bad ref %q", ref)
		}
		_, err := os.Stat(p)
		return err == nil
	}
	if !exists(kept) || exists(orphan) {
		t.Fatal("sweep should keep referenced pictures and drop the rest")
	}
	if err := s.Delete("abc123"); err != nil || exists(kept) || len(s.List()) != 0 {
		t.Fatal("delete should remove the thread and its pictures")
	}
}
