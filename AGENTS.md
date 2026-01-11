# AGENTS.md

## Project overview

- `main.go` is the CLI server. It reads NDJSON from stdin, keeps an in-memory ring buffer, and serves the UI plus SSE endpoints.
- `web/` contains the vanilla HTML/CSS/JS UI.
- `scripts/feed-log.sh` simulates a live log stream for manual testing.

## Working conventions

- Keep the UI in plain HTML/CSS/JS (no frameworks).
- If filter syntax changes, update the tooltip examples in `web/index.html` and the README.
- Prefer small, direct changes over abstractions.

## Useful commands

```bash
go run .
go build -o zlog
./scripts/feed-log.sh --file log.txt --min 0.1 --max 2 --burst 25 | go run .
```
