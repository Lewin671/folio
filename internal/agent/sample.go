package agent

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const backdropStops = 6

var (
	hexRe      = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	sampleHTTP = newSampleHTTP()
)

func newSampleHTTP() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 64
	tr.MaxIdleConnsPerHost = 16
	tr.IdleConnTimeout = 90 * time.Second
	return &http.Client{Timeout: 8 * time.Second, Transport: tr}
}

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
		rgb := edgeMedian(img, strip, max(cy-band, b.Min.Y), min(cy+band, b.Max.Y))
		const hex = "0123456789abcdef"
		text := [7]byte{'#', hex[rgb[0]>>4], hex[rgb[0]&15], hex[rgb[1]>>4], hex[rgb[1]&15], hex[rgb[2]>>4], hex[rgb[2]&15]}
		stops[i] = string(text[:])
	}

	return stops
}

// edgeMedian uses fixed histograms: sampling itself allocates no memory.
func edgeMedian(img image.Image, strip, y0, y1 int) [3]uint8 {
	var hist [3][256]uint32
	var count uint32
	b := img.Bounds()
	for y := y0; y < y1; y += 2 {
		for dx := 0; dx < strip; dx += 2 {
			for _, x := range [2]int{b.Min.X + dx, b.Max.X - 1 - dx} {
				r, g, bl := edgePixel(img, x, y)
				hist[0][r]++
				hist[1][g]++
				hist[2][bl]++
				count++
			}
		}
	}
	var rgb [3]uint8
	if count == 0 {
		return rgb
	}
	for channel := range hist {
		var cumulative uint32
		for value, n := range hist[channel] {
			cumulative += n
			if cumulative > count/2 {
				rgb[channel] = uint8(value)
				break
			}
		}
	}
	return rgb
}

func edgePixel(img image.Image, x, y int) (uint8, uint8, uint8) {
	switch p := img.(type) {
	case *image.YCbCr:
		yi, ci := p.YOffset(x, y), p.COffset(x, y)
		return color.YCbCrToRGB(p.Y[yi], p.Cb[ci], p.Cr[ci])
	case *image.RGBA:
		i := p.PixOffset(x, y)
		return p.Pix[i], p.Pix[i+1], p.Pix[i+2]
	case *image.NRGBA:
		i := p.PixOffset(x, y)
		a := uint32(p.Pix[i+3])
		return uint8((uint32(p.Pix[i]) * 0x101 * a / 0xff) >> 8), uint8((uint32(p.Pix[i+1]) * 0x101 * a / 0xff) >> 8), uint8((uint32(p.Pix[i+2]) * 0x101 * a / 0xff) >> 8)
	default:
		r, g, b, _ := img.At(x, y).RGBA()
		return uint8(r >> 8), uint8(g >> 8), uint8(b >> 8)
	}
}
