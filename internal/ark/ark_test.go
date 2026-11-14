package ark

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHint(t *testing.T) {
	// No key: refused locally, with a hint that says what to fill in.
	err := New("", "").CheckChat(context.Background(), "m")
	if h := Hint(err, "zh"); !strings.Contains(h, "ARK_API_KEY") {
		t.Fatalf("hint for missing key = %q", h)
	}
	for _, c := range []struct {
		err  *APIError
		want string
	}{
		{&APIError{Status: 401, Code: "AuthenticationError"}, "无效"},
		{&APIError{Status: 404, Code: "InvalidEndpointOrModel.NotFound", Model: "some-model"}, "some-model"},
		{&APIError{Status: 429}, "限流"},
		{&APIError{Status: 500}, ""},
	} {
		if got := Hint(c.err, "zh"); (c.want == "") != (got == "") || !strings.Contains(got, c.want) {
			t.Errorf("Hint(%d %s) = %q, want it to mention %q", c.err.Status, c.err.Code, got, c.want)
		}
	}
}

func TestTransportAndStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "event: ignored\ndata: invalid\ndata: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\r\n\n")
		io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"prompt_tokens_details\":{\"cached_tokens\":8}}}\n\ndata:   [DONE] \n")
	}))
	defer server.Close()
	c := New("key", server.URL)
	tr := c.http.Transport.(*http.Transport)
	if tr.MaxIdleConns != 64 || tr.MaxIdleConnsPerHost != 16 || tr.IdleConnTimeout != 90*time.Second || tr.HTTP2.SendPingTimeout != 10*time.Second || tr.HTTP2.PingTimeout != 5*time.Second {
		t.Fatal("transport config", tr)
	}
	var text string
	used, err := c.ChatStream(context.Background(), "m", nil, 10, func(delta string) { text += delta })
	if err != nil || text != "hello" || used != (Usage{10, 8, 2}) {
		t.Fatal(text, used, err)
	}
}
