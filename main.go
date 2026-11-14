// Atelier is an experiment in generative UI: a styling assistant whose every
// answer is a page composed on the fly instead of a chat message.
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"atelier/internal/agent"
	"atelier/internal/ark"
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
	key := os.Getenv("ARK_API_KEY")
	if key == "" {
		log.Fatal("ARK_API_KEY is not set")
	}
	a := &agent.Agent{
		Ark:        ark.New(key, os.Getenv("ARK_BASE_URL")),
		TextModel:  env("TEXT_MODEL", "deepseek-v4-1-flash-261017"),
		ImageModel: env("IMAGE_MODEL", "doubao-seedream-5-0-flash-260915"),
		Debug:      os.Getenv("DEBUG") != "",
	}
	web, err := fs.Sub(dist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/turn", a.HandleTurn)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("/", http.FileServerFS(web))

	addr := env("ADDR", "127.0.0.1:8787")
	log.Printf("atelier listening on %s (text=%s image=%s)", addr, a.TextModel, a.ImageModel)
	log.Fatal(http.ListenAndServe(addr, mux))
}
