package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestAcceptsGzip(t *testing.T) {
	for value, want := range map[string]bool{
		"": false, "gzip": true, "br, gzip;q=0.5": true, "gzip;q=0": false, "gzip;q=0, *;q=1": false,
		"*": true, "*;q=0": false, "GZip; Q=1": true, "gzip;q=oops": false, "gzip;q=NaN": false, "gzip;q=2": false, "xgzip": false, "gzip;q=0.000": false,
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Accept-Encoding", value)
		if got := AcceptsGzip(r); got != want {
			t.Errorf("%q: %v want %v", value, got, want)
		}
	}
}
