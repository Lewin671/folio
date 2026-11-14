package agent

import (
	"reflect"
	"testing"
)

func TestLineBufferSplitsAcrossDeltas(t *testing.T) {
	var l lineBuffer
	var got []string
	for _, d := range []string{`{"t":"sc`, `ene"}` + "\n" + `{"t":"te`, `xt"}` + "\n\n", `{"t":"actions"}`} {
		got = append(got, l.feed(d)...)
	}
	got = append(got, l.flush())
	want := []string{`{"t":"scene"}`, `{"t":"text"}`, "", `{"t":"actions"}`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestParseOp(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{`{"t":"scene","title":"x"}`, true},
		{`  {"t":"text","body":"x"},`, true},
		{"```json", false},
		{`这是一套搭配`, false},
		{`{"title":"no type"}`, false},
		{`{"t":"text","body":`, false},
	}
	for _, c := range cases {
		if _, ok := parseOp(c.in); ok != c.ok {
			t.Errorf("parseOp(%q) ok=%v want %v", c.in, ok, c.ok)
		}
	}
	op, _ := parseOp(`{"t":"image","pending":true}`)
	if _, has := op["pending"]; has {
		t.Error("model-supplied pending flag must be stripped")
	}
}

func TestValidRef(t *testing.T) {
	for in, want := range map[string]bool{
		"https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/a.jpeg?x=1": true,
		"http://x.volces.com/a.jpg":    false,
		"https://example.com/a.jpg":    false,
		"https://evilvolces.com/a.jpg": false,
		"":                             false,
	} {
		if got := validRef(in); got != want {
			t.Errorf("validRef(%q)=%v want %v", in, got, want)
		}
	}
}
