package ark

import (
	"context"
	"strings"
	"testing"
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
