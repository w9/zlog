# zlog

A tiny CLI + browser UI for streaming newline-delimited JSON (NDJSON) logs.

## Quick start

Build and run:

```bash
go build -o zlog
kubectl logs nextjs-pod-1 -f | ./zlog
```

Open `http://localhost:8037` to explore logs.

## Flags

- `--host` (default: `127.0.0.1`)
- `--port` (default: `8037`)
- `--max` (default: `5000`) max entries kept in memory

## Local sample

```bash
cat log.txt | go run .
```

## UI highlights

- Color-coded severity
- Search, minimum level, field/value filters
- Auto-scroll, wrap, pause/resume, and copy JSON details
