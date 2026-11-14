package main

import (
	"bytes"
	"compress/gzip"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/Lewin671/folio/internal/httpx"
)

type staticAsset struct {
	raw, gzip                 []byte
	contentType, tag, gzipTag string
}

// staticHandler prepares immutable embedded assets once at startup.
func staticHandler(web fs.FS) (http.Handler, error) {
	assets := make(map[string]staticAsset)
	err := fs.WalkDir(web, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(web, name)
		if err != nil {
			return err
		}
		ct := mime.TypeByExtension(path.Ext(name))
		if ct == "" {
			ct = http.DetectContentType(data)
		}
		a := staticAsset{raw: data, contentType: ct, tag: httpx.ETag(data)}
		switch path.Ext(name) {
		case ".js", ".css", ".html", ".svg", ".json", ".txt":
			a.gzip = httpx.Gzip(data, gzip.BestCompression)
			a.gzipTag = httpx.ETag(a.gzip)
		}
		assets["/"+name] = a
		return nil
	})
	if err != nil {
		return nil, err
	}
	fallback := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean("/" + r.URL.Path)
		conversation := strings.HasPrefix(r.URL.Path, "/c/")
		if name == "/" || conversation {
			name = "/index.html"
		}
		// Preserve FileServer's canonical redirect for explicit index.html URLs.
		if !conversation && strings.HasSuffix(r.URL.Path, "/index.html") {
			w.Header().Set("Cache-Control", "no-cache")
			fallback.ServeHTTP(w, r)
			return
		}
		a, ok := assets[name]
		if !ok {
			fallback.ServeHTTP(w, r)
			return
		}
		switch {
		case strings.HasPrefix(name, "/assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case strings.HasPrefix(name, "/pics/"):
			w.Header().Set("Cache-Control", "public, max-age=86400")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		data, tag := a.raw, a.tag
		if a.gzip != nil {
			w.Header().Add("Vary", "Accept-Encoding")
			if httpx.AcceptsGzip(r) {
				data, tag = a.gzip, a.gzipTag
				w.Header().Set("Content-Encoding", "gzip")
			}
		}
		w.Header().Set("Content-Type", a.contentType)
		w.Header().Set("ETag", tag)
		if httpx.NotModified(w, r, tag) {
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		http.ServeContent(w, r, path.Base(name), time.Time{}, bytes.NewReader(data))
	}), nil
}
