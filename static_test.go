package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Lewin671/folio/internal/agent"
	"github.com/Lewin671/folio/internal/ark"
	"github.com/Lewin671/folio/internal/library"
	"github.com/Lewin671/folio/internal/profile"
)

func TestStaticAssets(t *testing.T) {
	content := strings.Repeat("const hello = 'world';\n", 100)
	web := fstest.MapFS{
		"index.html":      {Data: []byte("<html>hello</html>")},
		"assets/main.js":  {Data: []byte(content)},
		"assets/main.css": {Data: []byte("body { color: red }")},
		"pics/cover.png":  {Data: []byte("picture")},
	}
	h, err := staticHandler(web)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path, encoding, cache string
		compressed            bool
	}{
		{"/assets/main.js", "gzip", "public, max-age=31536000, immutable", true},
		{"/assets/main.js", "br, gzip;q=0", "public, max-age=31536000, immutable", false},
		{"/assets/main.js", "gzip;q=0.2", "public, max-age=31536000, immutable", true},
		{"/assets/main.css", "gzip", "public, max-age=31536000, immutable", true},
		{"/pics/cover.png", "gzip", "public, max-age=86400", false},
		{"/", "gzip", "no-cache", true},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		r.Header.Set("Accept-Encoding", tc.encoding)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Header().Get("Cache-Control") != tc.cache || (w.Header().Get("Content-Encoding") == "gzip") != tc.compressed {
			t.Fatalf("%+v: %d %v", tc, w.Code, w.Header())
		}
		if w.Header().Get("Content-Length") == "" {
			t.Fatal("missing content length")
		}
		data := w.Body.Bytes()
		if tc.compressed {
			if w.Header().Get("Vary") != "Accept-Encoding" {
				t.Fatal("missing Vary")
			}
			gz, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			data, _ = io.ReadAll(gz)
			gz.Close()
		}
		if tc.path == "/assets/main.js" && string(data) != content {
			t.Fatal("wrong body")
		}
		tag := w.Header().Get("ETag")
		if tag == "" {
			t.Fatal("missing tag")
		}
		r.Header.Set("If-None-Match", `"other", W/`+tag)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 304 || w.Body.Len() != 0 {
			t.Fatal("conditional response", w)
		}
		r.Method = "HEAD"
		r.Header.Del("If-None-Match")
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
			t.Fatal("HEAD", w)
		}
	}
	raw := httptest.NewRecorder()
	gz := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/assets/main.js", nil)
	h.ServeHTTP(raw, r)
	r.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(gz, r)
	if raw.Header().Get("ETag") == gz.Header().Get("ETag") {
		t.Fatal("representations share a strong ETag")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/missing", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/index.html", nil))
	if w.Code != 301 {
		t.Fatal(w.Code)
	}
}

func TestTurnFlushesWithoutCompression(t *testing.T) {
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	// Always release a blocked upstream before closing the servers on failure.
	defer close(release)
	dir := t.TempDir()
	prefs, _ := profile.Open(dir)
	lib, _ := library.Open(dir)
	a := &agent.Agent{Ark: ark.New("key", upstream.URL), Profile: prefs, Library: lib}
	assets, _ := staticHandler(fstest.MapFS{"index.html": {Data: []byte("hello")}})
	server := httptest.NewServer(newMux(a, assets))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/turn", strings.NewReader(`{"input":"hello"}`))
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Encoding") != "" || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal(res.Header)
	}
	// Upstream has produced nothing; meta must already have reached the client.
	line, err := bufio.NewReader(res.Body).ReadString('\n')
	if err != nil || line != "event: meta\n" {
		t.Fatal(line, err)
	}
}
