# Atelier

An experiment in generative UI. A styling assistant whose answer is a page
composed on the fly, not a chat message: ask for an outfit, a comparison, a
colour scheme or a packing list and each gets a different layout, palette and
typeface, with pictures generated to match.

## How it works

1. The text model writes one JSON object per line: a `scene` header (layout,
   tone, stage colour, title) followed by content blocks. The full vocabulary
   is in `internal/agent/prompt.md`.
2. The Go server forwards every complete line to the browser over SSE as it
   arrives, and starts an image generation for each block carrying a prompt.
3. Every scene is a full-screen colour field. Pictures are shot on a seamless
   studio backdrop in the scene colour; the server then reads the colour along
   the picture's edges (`internal/agent/sample.go`) and the page is painted
   with those colours at the same heights, so the figure stands directly on
   the page. No background removal is involved.
4. On a follow-up the model re-emits the page reusing block ids; the client
   morphs matching blocks in place. An image block with `"edit": true` is
   regenerated from the previous picture, which keeps the person consistent.

## Profile and memory

The app has one user. What it remembers lives under `DATA_DIR` (default
`./data`, mode 700): confirmed photos of the user, a one-line appearance note
and stated preferences.

- **Whose photo is it.** An uploaded picture goes to a vision model that boxes
  every person in it. Only a person the user has confirmed is cropped out and
  stored. A group photo always asks which one; a single person is accepted
  without asking only when the model matches them to an already confirmed
  photo with confidence of at least 0.9, and that is announced with an undo.
  The thresholds and the reason are at the top of `internal/agent/photo.go`.
- **Try-on.** With a photo on file the text model marks figure pictures with
  `"me": true` and the main photo is sent as the reference image.
- **Preferences.** The text model emits `{"t":"remember","items":[…]}` for
  lasting facts; they are stored, shown as a toast with undo, and added to the
  system prompt of later turns. Everything can be viewed and deleted in the
  profile panel.

Photos leave the machine only as requests to the Ark models. There is no
login: anyone who can reach the server can see and change the profile.

## Run

```sh
export ARK_API_KEY=...        # Volcengine Ark data-plane key
# optional: TEXT_MODEL, IMAGE_MODEL, VISION_MODEL, DATA_DIR, ADDR
make build && ./atelier       # http://127.0.0.1:8787
```

| Variable | Default |
|---|---|
| `ADDR` | `127.0.0.1:8787` |
| `TEXT_MODEL` | `deepseek-v4-1-flash-261017` |
| `IMAGE_MODEL` | `doubao-seedream-5-0-flash-260915` |
| `DEBUG` | unset; any value logs each line the text model writes |

Open `/?mock` to drive the UI from offline fixtures (`web/src/mock.ts`) with no
model calls; type a keyword such as 面试, 还是, 配色, 清单, 怎么选, 风格, 拥挤, 出错.

## Measured (2026-11, Beijing region)

First block about 1.5 s, full page 3–6 s, each picture 8–13 s (pictures run in
parallel, so a page with three takes about as long as a page with one).
