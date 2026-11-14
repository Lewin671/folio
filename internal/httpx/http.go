// Package httpx contains shared HTTP representation negotiation.
package httpx

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func AcceptsGzip(r *http.Request) bool {
	wildcard := false
	for _, field := range r.Header.Values("Accept-Encoding") {
		for _, item := range strings.Split(field, ",") {
			parts := strings.Split(item, ";")
			coding := strings.TrimSpace(parts[0])
			q := 1.0
			for _, param := range parts[1:] {
				k, v, ok := strings.Cut(strings.TrimSpace(param), "=")
				if ok && strings.EqualFold(k, "q") {
					n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
					if err != nil || !(n >= 0 && n <= 1) {
						q = 0
					} else {
						q = n
					}
				}
			}
			if strings.EqualFold(coding, "gzip") {
				return q > 0
			}
			if coding == "*" {
				wildcard = q > 0
			}
		}
	}
	return wildcard
}

func ETag(data []byte) string { return fmt.Sprintf(`"%x"`, sha256.Sum256(data)) }

func NotModified(w http.ResponseWriter, r *http.Request, tag string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	for _, field := range r.Header.Values("If-None-Match") {
		for _, candidate := range strings.Split(field, ",") {
			t := strings.TrimSpace(candidate)
			if t == "*" || strings.TrimPrefix(t, "W/") == tag {
				w.WriteHeader(http.StatusNotModified)
				return true
			}
		}
	}
	return false
}

func Gzip(data []byte, level int) []byte {
	var buf bytes.Buffer
	gz, _ := gzip.NewWriterLevel(&buf, level)
	gz.Write(data)
	gz.Close()
	return buf.Bytes()
}
