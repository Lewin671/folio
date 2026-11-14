package agent

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const backdropStops = 6

var (
	hexRe      = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	sampleHTTP = &http.Client{Timeout: 8 * time.Second}
)

// backdrop describes the studio paper colour for an image prompt. The page is
// later painted in the colour the picture actually came out with, so the
// request only has to be roughly honoured.
func backdrop(hex, name string) string {
	hex = strings.TrimSpace(hex)
	if !hexRe.MatchString(hex) {
		hex = ""
	}
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == ' ' || r == '-' {
			b.WriteRune(r)
		}
	}
	name = strings.TrimSpace(b.String())
	if len(name) > 40 {
		name = name[:40]
	}
	switch {
	case name != "" && hex != "":
		return fmt.Sprintf("%s (%s)", name, hex)
	case hex != "":
		return hex
	case name != "":
		return name
	}
	return "warm stone grey (#8C857B)"
}

// fetchPicture downloads a generated picture, so it can be kept and measured.
func fetchPicture(ctx context.Context, raw string) ([]byte, error) {
	if !validRef(raw) {
		return nil, fmt.Errorf("not a generated image url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	res, err := sampleHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 12<<20))
}

// stopsOf reports the backdrop colour of a picture, or nil if it cannot be read.
func stopsOf(data []byte) []string {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	return edgeStops(img, backdropStops)
}

// edgeStops reads the colour along the left and right edges of a picture at n
// heights, top to bottom. With a seamless studio backdrop those edges are the
// backdrop itself, so a page painted with these stops continues the picture.
// Medians keep stray hair, hands or shadows near the edge from tinting a stop.
func edgeStops(img image.Image, n int) []string {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 20 || h < 20 || n < 1 {
		return nil
	}
	strip := max(w*3/100, 2)
	band := max(h/(n*4), 1)
	stops := make([]string, n)
	for i := range n {
		cy := b.Min.Y + (2*i+1)*h/(2*n)
		var rs, gs, bs []int
		for y := max(cy-band, b.Min.Y); y < min(cy+band, b.Max.Y); y += 2 {
			for dx := 0; dx < strip; dx += 2 {
				for _, x := range [2]int{b.Min.X + dx, b.Max.X - 1 - dx} {
					r, g, bl, _ := img.At(x, y).RGBA()
					rs, gs, bs = append(rs, int(r>>8)), append(gs, int(g>>8)), append(bs, int(bl>>8))
				}
			}
		}
		stops[i] = fmt.Sprintf("#%02x%02x%02x", median(rs), median(gs), median(bs))
	}
	return stops
}

func median(v []int) int {
	if len(v) == 0 {
		return 0
	}
	sort.Ints(v)
	return v[len(v)/2]
}
