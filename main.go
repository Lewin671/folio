// Folio is an experiment in generative UI: an explainer whose every answer is
// a page composed on the fly instead of a chat message.
package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"atelier/internal/agent"
	"atelier/internal/ark"
	"atelier/internal/profile"
)

//go:embed all:web/dist
var dist embed.FS

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	// Without a key the server still starts, so the page can say what is missing.
	key := os.Getenv("ARK_API_KEY")
	// What is remembered about the user stays on this machine, readable only by this account.
	store, err := profile.Open(env("DATA_DIR", "data"))
	if err != nil {
		log.Fatalf("profile store: %v", err)
	}
	a := &agent.Agent{
		Ark:         ark.New(key, os.Getenv("ARK_BASE_URL")),
		TextModel:   env("TEXT_MODEL", "deepseek-v4-1-flash-261017"),
		ImageModel:  env("IMAGE_MODEL", "doubao-seedream-5-0-flash-260915"),
		VisionModel: env("VISION_MODEL", "doubao-seed-2-0-mini-260428"),
		Profile:     store,
		Debug:       os.Getenv("DEBUG") != "",
	}
	web, err := fs.Sub(dist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/turn", a.HandleTurn)
	mux.HandleFunc("GET /api/profile", a.HandleProfile)
	mux.HandleFunc("DELETE /api/profile", a.HandleClearProfile)
	mux.HandleFunc("DELETE /api/pref/{id}", a.HandleDeletePref)
	mux.HandleFunc("GET /api/setup", a.HandleSetup)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("/", http.FileServerFS(web))

	addr := env("ADDR", "127.0.0.1:8787")
	log.Printf("folio listening on %s (text=%s image=%s)", addr, a.TextModel, a.ImageModel)
	go func() {
		if problems := a.Setup(context.Background()); len(problems) > 0 {
			for _, p := range problems {
				log.Printf("SETUP: %s", p)
			}
		} else {
			log.Print("key and models are ready")
		}
	}()
	log.Fatal(http.ListenAndServe(addr, mux))
}
