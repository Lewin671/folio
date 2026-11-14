// Package ark is a minimal client for the Volcengine Ark data-plane API:
// streaming chat completions, image understanding and image generation.
package ark

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const DefaultBaseURL = "https://ark.cn-beijing.volces.com/api/v3"

type Client struct {
	key  string
	base string
	http *http.Client
}

func New(key, base string) *Client {
	if base == "" {
		base = DefaultBaseURL
	}
	// A connection that has silently died (a proxy restarting, a laptop waking
	// up) would otherwise be reused for every call until the system gave up on
	// it, minutes later. Pinging it when it goes quiet drops it within seconds.
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.HTTP2 = &http.HTTP2Config{SendPingTimeout: 10 * time.Second, PingTimeout: 5 * time.Second}
	tr.MaxIdleConns = 64
	tr.MaxIdleConnsPerHost = 16
	tr.IdleConnTimeout = 90 * time.Second
	return &Client{key: key, base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 120 * time.Second, Transport: tr}}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// APIError is a refusal from the Ark API.
type APIError struct {
	Status  int
	Code    string
	Message string
	Model   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("ark %s: %d %s: %s", e.Model, e.Status, e.Code, e.Message)
}

// say picks the wording for the reader's language; English unless they use Chinese.
func say(lang, en, zh string) string {
	if lang == "zh" {
		return zh
	}
	return en
}

// Hint turns an error into something the person running the app can act on,
// or "" when the failure is not about their setup.
func Hint(err error, lang string) string {
	var e *APIError
	if !errors.As(err, &e) {
		return ""
	}
	switch {
	case e.Code == "MissingKey":
		return say(lang, "ARK_API_KEY isn’t set. Put your Volcengine Ark API key in .env, then restart.", "还没有配置 ARK_API_KEY：把火山方舟的 API Key 填进 .env，然后重启。")
	case e.Status == http.StatusUnauthorized:
		return say(lang, "The Volcengine API key is invalid or expired. Check ARK_API_KEY.", "火山 API Key 无效或已失效，请检查 ARK_API_KEY。")
	case e.Status == http.StatusNotFound || e.Status == http.StatusForbidden || strings.Contains(e.Code, "ModelNotOpen"):
		return fmt.Sprintf(say(lang, "Model %s isn’t available. Activate it in the Volcengine Ark console, or choose another model with the environment variable.", "模型 %s 用不了：请在火山方舟控制台的「开通管理」里开通它，或者用环境变量换一个模型。"), e.Model)
	case e.Status == http.StatusTooManyRequests || strings.Contains(e.Code, "Overdue") || strings.Contains(e.Code, "Quota"):
		return say(lang, "The Volcengine account is rate-limited, out of quota or overdue. Check the console.", "火山账号被限流、额度用完或欠费了，请到控制台看一下。")
	}
	return ""
}

func (c *Client) post(ctx context.Context, path, model string, body any) (*http.Response, error) {
	if c.key == "" {
		return nil, &APIError{Status: http.StatusUnauthorized, Code: "MissingKey", Message: "ARK_API_KEY is not set", Model: model}
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var parsed struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		json.Unmarshal(raw, &parsed)
		if parsed.Error.Message == "" {
			parsed.Error.Message = strings.TrimSpace(string(raw))
		}
		return nil, &APIError{Status: resp.StatusCode, Code: parsed.Error.Code, Message: parsed.Error.Message, Model: model}
	}
	return resp, nil
}

// CheckChat confirms that the key works and the chat model is reachable, with
// a one-token request.
func (c *Client) CheckChat(ctx context.Context, model string) error {
	resp, err := c.post(ctx, "/chat/completions", model, map[string]any{
		"model":      model,
		"messages":   []Message{{Role: "user", Content: "hi"}},
		"max_tokens": 1,
		"thinking":   map[string]string{"type": "disabled"},
	})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// CheckImage confirms that the image model is reachable without paying for a
// picture: an impossible size is rejected as a bad parameter only after the
// key and the model have been accepted.
func (c *Client) CheckImage(ctx context.Context, model string) error {
	resp, err := c.post(ctx, "/images/generations", model, map[string]any{"model": model, "prompt": "x", "size": "1x1"})
	if err == nil {
		resp.Body.Close()
		return nil
	}
	var e *APIError
	if errors.As(err, &e) && e.Status == http.StatusBadRequest {
		return nil
	}
	return err
}

// ChatStream streams a completion with thinking disabled and calls onDelta
// for every content fragment.
// Usage is what a chat call consumed. Cached counts the input tokens the
// service recognised from an earlier call and bills at the lower cached rate.
type Usage struct {
	Input, Cached, Output int
}

// promptCacheKey keeps calls that share the long system prompt on servers
// that already hold it. Caching itself is automatic; this only improves the
// odds of a hit.
const promptCacheKey = "folio-pages-v1"

func (c *Client) ChatStream(ctx context.Context, model string, msgs []Message, maxTokens int, onDelta func(string)) (Usage, error) {
	var used Usage
	resp, err := c.post(ctx, "/chat/completions", model, map[string]any{
		"model":            model,
		"messages":         msgs,
		"stream":           true,
		"stream_options":   map[string]bool{"include_usage": true},
		"prompt_cache_key": promptCacheKey,
		"max_tokens":       maxTokens,
		"temperature":      0.8,
		"thinking":         map[string]string{"type": "disabled"},
	})
	if err != nil {
		return used, err
	}
	defer resp.Body.Close()

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		data, ok := bytes.CutPrefix(sc.Bytes(), []byte("data:"))
		if !ok {
			continue
		}
		data = bytes.TrimSpace(data)
		if bytes.Equal(data, []byte("[DONE]")) {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
				Details          struct {
					CachedTokens int `json:"cached_tokens"`
				} `json:"prompt_tokens_details"`
			} `json:"usage"`
		}
		if json.Unmarshal(data, &chunk) != nil {
			continue
		}
		// The last chunk carries the totals and no text.
		if u := chunk.Usage; u != nil {
			used = Usage{Input: u.PromptTokens, Cached: u.Details.CachedTokens, Output: u.CompletionTokens}
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if d := chunk.Choices[0].Delta.Content; d != "" {
			onDelta(d)
		}
	}
	return used, sc.Err()
}

// Vision asks a question about one or more images (URLs or data URLs) and
// returns the whole answer. Temperature is zero: these are judgements, not copy.
func (c *Client) Vision(ctx context.Context, model, prompt string, images []string) (string, error) {
	content := make([]map[string]any, 0, len(images)+1)
	for _, u := range images {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]string{"url": u}})
	}
	content = append(content, map[string]any{"type": "text", "text": prompt})
	resp, err := c.post(ctx, "/chat/completions", model, map[string]any{
		"model":       model,
		"messages":    []map[string]any{{"role": "user", "content": content}},
		"max_tokens":  700,
		"temperature": 0,
		"thinking":    map[string]string{"type": "disabled"},
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("ark vision: empty result")
	}
	return out.Choices[0].Message.Content, nil
}

// Image generates one image and returns its URL. refs are optional reference
// image URLs; when present the model edits instead of generating from scratch.
func (c *Client) Image(ctx context.Context, model, prompt, size string, refs []string) (string, error) {
	body := map[string]any{
		"model":           model,
		"prompt":          prompt,
		"size":            size,
		"response_format": "url",
		"watermark":       false,
	}
	if len(refs) > 0 {
		body["image"] = refs
	}
	resp, err := c.post(ctx, "/images/generations", model, body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Data) == 0 || out.Data[0].URL == "" {
		return "", fmt.Errorf("ark image: empty result")
	}
	return out.Data[0].URL, nil
}
