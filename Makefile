.PHONY: web build test dev darwin-amd64

web:
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web
	go build -o folio .

test: web
	go vet ./... && go test ./...

# Front-end with hot reload; expects the server on 127.0.0.1:8787.
dev:
	cd web && pnpm dev

# Single binary for an Intel Mac, with the front-end embedded.
darwin-amd64: web
	GOOS=darwin GOARCH=amd64 go build -o dist-bin/folio-darwin-amd64 .
