# zlog

zlog is a tiny CLI plus browser UI for streaming newline-delimited JSON (NDJSON) logs.

## Quick start

Build and run:

```bash
go build -o zlog
kubectl logs nextjs-pod-1 -f | ./zlog
```

Open `http://localhost:8037` to explore logs.

## Local sample

```bash
cat log.txt | go run .
```

Simulated stream:

```bash
./scripts/feed-log.sh --file log.txt --min 0.1 --max 2 --burst 25 | go run .
```

## Flags

- `--host` (default: `127.0.0.1`)
- `--port` (default: `8037`)
- `--max` (default: `5000`) max entries kept in memory

## Filter syntax

Filters are combined with AND and are saved in localStorage.

- Plain text (no leading dot) means message contains:
  - `timeout`
- Regex on message:
  - `/timeout/i`
- jq-style path filters:
  - `.level == "error"`
  - `.channel == "action"`
  - `.session` (field exists)
  - `.duration >= 120`
  - `.message contains "timeout"`
  - `select(.user.id == "42")`
  - `.tags[0] == "api"`

## UI highlights

- Color-coded severity and optional channel column
- Search, level filter, channel filter, and filter tags
- Toggle plain logs, wrap lines, alternating rows, and extra fields as tags
- Details panel with summary, extra fields, and raw entry view
- Dark mode with persisted preference
- Auto-scroll with pause and jump-to-bottom controls
- Keyboard shortcuts: j/down, k/up, u/d page up/down, space jump to bottom
