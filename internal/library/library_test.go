package library

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
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

func TestPageValidation(t *testing.T) {
	s, _ := Open(t.TempDir())
	for _, pages := range []string{"", "null", "{}", "123", "[]", "[", "[1,]", "[1] garbage", "[1] 123", "[1] []", "[1] null"} {
		if err := s.Put("abc123", "", "", "", json.RawMessage(pages)); !errors.Is(err, ErrBad) {
			t.Errorf("%q: %v", pages, err)
		}
	}
	for _, pages := range []string{`[null]`, ` [1, {"nested":[1,2]}, "x"] `} {
		if err := s.Put("abc123", "", "bad", "bad", json.RawMessage(pages)); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := s.Get("abc123")
	if got.Count != 3 || got.Bg != "" || got.Img != "" {
		t.Fatal(got)
	}
}

func TestIndexAndThreadCache(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	for i := range 3 {
		if err := s.Put(fmt.Sprintf("id%04d", i), fmt.Sprint(i), "", "", json.RawMessage(`[1]`)); err != nil {
			t.Fatal(err)
		}
	}
	reopened, err := Open(dir)
	if err != nil || !reflect.DeepEqual(reopened.List(), s.List()) {
		t.Fatalf("reopen: %v", err)
	}
	if got := s.ListN(2); len(got) != 2 || got[0].ID != "id0002" || got[1].ID != "id0001" {
		t.Fatal(got)
	}
	copy := s.ListN(1)
	copy[0].Title = "changed"
	if s.List()[0].Title == "changed" {
		t.Fatal("metadata alias")
	}
	pages := json.RawMessage(`[2]`)
	s.Put("id0002", "updated", "", "", pages)
	pages[1] = '9'
	got, _ := s.Get("id0002")
	got.Pages[1] = '8'
	// An unavailable file proves hot Get and List do not touch disk.
	os.Remove(s.path("id0002"))
	got, err = s.Get("id0002")
	if err != nil || string(got.Pages) != `[2]` || got.Title != "updated" || len(s.ListN(-1)) != 3 {
		t.Fatalf("%+v %v", got, err)
	}
	s.Delete("id0002")
	if _, err := s.Get("id0002"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if len(s.List()) != 2 {
		t.Fatal(s.List())
	}
	for i := range 33 {
		s.Put(fmt.Sprintf("xy%04d", i), "", "", "", json.RawMessage(`[1]`))
	}
	if s.threadCache.order.Len() != 32 {
		t.Fatal("unbounded thread cache")
	}
	if _, ok := s.threadCache.items["xy0000"]; ok {
		t.Fatal("oldest thread retained")
	}
	if _, err := s.Get("xy0000"); err != nil {
		t.Fatal(err)
	}
}

func TestImageCache(t *testing.T) {
	s, _ := Open(t.TempDir())
	raw := picture(t)
	ref, err := s.SaveImage(raw)
	if err != nil {
		t.Fatal(err)
	}
	file, _ := s.ImageFile(ref)
	if _, err := os.Stat(file); err != nil {
		t.Fatal("image not persisted")
	}
	raw[0] = 0
	data, ct, _, ok := s.ReadImage(ref)
	if !ok || ct != "image/png" || data[0] != 137 {
		t.Fatal("save cache alias")
	}
	data[0] = 0
	os.Remove(file)
	data, _, _, ok = s.ReadImage(ref)
	if !ok || data[0] != 137 {
		t.Fatal("read cache alias or miss")
	}
	ref, _ = s.SaveImage(picture(t))
	s.Sweep(time.Hour)
	if _, _, _, ok := s.ReadImage(ref); !ok {
		t.Fatal("swept recent image")
	}
	s.Sweep(0)
	if _, _, _, ok := s.ReadImage(ref); ok {
		t.Fatal("stale swept cache")
	}
	ref, _ = s.SaveImage(picture(t))
	pages, _ := json.Marshal([]map[string]string{{"img": ref}})
	s.Put("abc123", "", "", ref, pages)
	s.Put("abc124", "", "", ref, pages)
	s.Delete("abc123")
	if _, _, _, ok := s.ReadImage(ref); !ok {
		t.Fatal("shared image deleted")
	}
	s.Delete("abc124")
	if _, _, _, ok := s.ReadImage(ref); ok {
		t.Fatal("stale deleted cache")
	}
	if _, _, _, ok := s.ReadImage("../../x.png"); ok {
		t.Fatal("path escape")
	}
	// Oversize images bypass the cache; the cache also enforces a total budget.
	large := append(picture(t), make([]byte, maxCachedImage)...)
	big, _ := s.SaveImage(large)
	if _, ok := s.imageCache.items[strings.TrimPrefix(big, ImagePrefix)]; ok {
		t.Fatal("cached oversized image")
	}
	for range 10 {
		s.SaveImage(large[:maxCachedImage])
	}
	if s.imageCache.bytes > 16<<20 {
		t.Fatal("image byte budget exceeded")
	}
	for range 70 {
		s.SaveImage(picture(t))
	}
	if s.imageCache.order.Len() > 64 {
		t.Fatal("image entry budget exceeded")
	}
}

func TestImageETag(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	raw := picture(t)
	ref, err := s.SaveImage(raw)
	if err != nil {
		t.Fatal(err)
	}
	_, _, tag, ok := s.ReadImage(ref)
	if !ok || tag != `"`+strings.TrimPrefix(ref, ImagePrefix)+`"` {
		t.Fatalf("invalid ETag: %q", tag)
	}
	// Both a cold disk read and its subsequent cache hit keep the same validator.
	s, _ = Open(dir)
	for range 2 {
		data, ct, got, ok := s.ReadImage(ref)
		if !ok || ct != "image/png" || got != tag || !bytes.Equal(data, raw) {
			t.Fatalf("ETag changed across reads: %q != %q", got, tag)
		}
	}
	// Oversized pictures bypass the byte cache but still have stable validators.
	large, _ := s.SaveImage(append(raw, make([]byte, maxCachedImage)...))
	_, _, tag, _ = s.ReadImage(large)
	_, _, next, _ := s.ReadImage(large)
	if tag == "" || tag != next {
		t.Fatalf("uncached ETag changed: %q != %q", tag, next)
	}
	if _, _, tag, ok := s.ReadImage("../../invalid.png"); ok || tag != "" {
		t.Fatal("invalid image has a validator")
	}
}

func TestEvictionAndConcurrentSweep(t *testing.T) {
	s, _ := Open(t.TempDir())
	for i := range maxThreads + 1 {
		if err := s.Put(fmt.Sprintf("id%04d", i), "", "", "", json.RawMessage(`[1]`)); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.List()) != maxThreads {
		t.Fatal(len(s.List()))
	}
	if _, err := s.Get("id0000"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("old thread not evicted", err)
	}
	ref, _ := s.SaveImage(picture(t))
	pages, _ := json.Marshal([]string{ref})
	s.Put("shared1", "", "", ref, pages)
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 20 {
				s.Sweep(0)
				s.ListN(1)
				if err := s.Put(fmt.Sprintf("work%02d", i), "", "", ref, pages); err != nil {
					t.Error(err)
				}
				if _, _, _, ok := s.ReadImage(ref); !ok {
					t.Error("referenced image swept")
				}
				if _, err := s.Get("shared1"); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
}

func BenchmarkPut300(b *testing.B) {
	s, _ := Open(b.TempDir())
	pages := json.RawMessage(`[{"title":"benchmark"}]`)
	for i := range maxThreads {
		if err := s.Put(fmt.Sprintf("id%04d", i), "title", "", "", pages); err != nil {
			b.Fatal(err)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := s.Put(fmt.Sprintf("id%04d", i%maxThreads), "title", "", "", pages); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkList300(b *testing.B) {
	s, _ := Open(b.TempDir())
	for i := range maxThreads {
		s.Put(fmt.Sprintf("id%04d", i), "title", "", "", json.RawMessage(`[1]`))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.List()
	}
}

func BenchmarkGet(b *testing.B) {
	s, _ := Open(b.TempDir())
	s.Put("abc123", "title", "", "", json.RawMessage(`[{"title":"benchmark"}]`))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Get("abc123"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSaveAndReadImage(b *testing.B) {
	s, _ := Open(b.TempDir())
	var buf bytes.Buffer
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 64, 64)))
	raw := buf.Bytes()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ref, err := s.SaveImage(raw)
		if err != nil {
			b.Fatal(err)
		}
		if _, _, _, ok := s.ReadImage(ref); !ok {
			b.Fatal("read failed")
		}
		file, _ := s.ImageFile(ref)
		os.Remove(file)
	}
}

func TestCacheMissesAndFailedPut(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	ref, _ := s.SaveImage(picture(t))
	s.Put("abc123", "original", "", "", json.RawMessage(`[1]`))
	s, _ = Open(dir)
	got, err := s.Get("abc123")
	if err != nil || got.Title != "original" {
		t.Fatal(got, err)
	}
	data, ct, _, ok := s.ReadImage(ref)
	if !ok || ct != "image/png" {
		t.Fatal("cold image read failed")
	}
	file, _ := s.ImageFile(ref)
	os.Remove(file)
	next, _, _, ok := s.ReadImage(ref)
	if !ok || !bytes.Equal(data, next) {
		t.Fatal("cold read not cached")
	}
	// A failed atomic replacement must leave both caches and metadata untouched.
	os.Mkdir(s.path("abc123")+".tmp", 0o700)
	if err := s.Put("abc123", "replacement", "", "", json.RawMessage(`[2]`)); err == nil {
		t.Fatal("expected write error")
	}
	got, _ = s.Get("abc123")
	if got.Title != "original" || s.List()[0].Title != "original" {
		t.Fatal("published failed write")
	}
}

func TestReopenOrderingAndDamagedReferences(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	ref, _ := s.SaveImage(picture(t))
	updated := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, id := range []string{"abc124", "abc123"} {
		buf, _ := json.Marshal(Thread{Meta: Meta{ID: id, Updated: updated}, Pages: json.RawMessage(`[1]`)})
		if err := os.WriteFile(s.path(id), buf, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// The old sweeper protected references even in a damaged thread file.
	if err := os.WriteFile(s.path("broken1"), []byte(`{"pages":["`+ref), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s.ListN(2)
	if len(got) != 2 || got[0].ID != "abc123" || got[1].ID != "abc124" {
		t.Fatal(got)
	}
	s.Sweep(0)
	if _, _, _, ok := s.ReadImage(ref); !ok {
		t.Fatal("damaged thread's image swept")
	}
}

func TestDiscardImage(t *testing.T) {
	s, _ := Open(t.TempDir())
	ref, _ := s.SaveImage(picture(t))
	s.Put("abc123", "", "", ref, json.RawMessage(`[1]`))
	if err := s.DiscardImage(ref); err != nil {
		t.Fatal(err)
	}
	if _, _, _, ok := s.ReadImage(ref); !ok {
		t.Fatal("discarded referenced image")
	}
	orphan, _ := s.SaveImage(picture(t))
	if err := s.DiscardImage(orphan); err != nil {
		t.Fatal(err)
	}
	if _, _, _, ok := s.ReadImage(orphan); ok {
		t.Fatal("discarded image still cached")
	}
	if err := s.DiscardImage("../../private"); !errors.Is(err, ErrBad) {
		t.Fatal(err)
	}
}
