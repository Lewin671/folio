# Atelier

An experiment in generative UI. A styling assistant whose answer is a page
composed on the fly, not a chat message: ask for an outfit, a comparison, a
colour scheme or a packing list and each gets a different layout, palette and
typeface, with pictures generated to match.

## How it works

1. The text model writes one JSON object per line: a `scene` header (layout,
   tone, three colours, title) followed by content blocks. The full vocabulary
   is in `internal/agent/prompt.md`.
2. The Go server forwards every complete line to the browser over SSE as it
   arrives, and starts an image generation for each block carrying a prompt.
3. The React client renders blocks as they land. Pictures are generated on a
   white backdrop and blended into the page colour with `mix-blend-mode:
   multiply`, so no background removal is needed.
4. On a follow-up the model re-emits the page reusing block ids; the client
   morphs matching blocks in place. An image block with `"edit": true` is
   regenerated from the previous picture, which keeps the person consistent.

## Run

```sh
export ARK_API_KEY=...        # Volcengine Ark data-plane key
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
