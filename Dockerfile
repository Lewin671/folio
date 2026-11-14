# syntax=docker/dockerfile:1

# 1. Front-end bundle
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /src/web
RUN npm install -g pnpm@10 --registry=$NPM_REGISTRY
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry=$NPM_REGISTRY
COPY web/ ./
RUN pnpm build

# 2. Server binary with the bundle embedded (standard library only, no module downloads)
# Cross-compiled on the build machine, so multi-arch images need no emulation.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY internal/ ./internal/
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /folio . \
 && mkdir /data

# 3. Runtime: just the binary and CA certificates, running as a non-root user
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /folio /folio
COPY --from=server --chown=nonroot:nonroot /data /data
ENV ADDR=0.0.0.0:8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/folio"]
