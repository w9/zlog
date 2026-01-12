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
- `--max` (default: `10000`) max entries kept in memory

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
  - `.tags[0] == "api"`

## UI highlights

- Color-coded severity and optional channel column
- Level range filter, channel filters, and filter tags
- Toggle plain logs, wrap lines, alternating rows, and extra fields as tags
- Details panel with summary, extra fields, and raw entry view
- Dark mode with persisted preference
- Auto-scroll with pause and jump-to-bottom controls
- Keyboard shortcuts: j/down, k/up, u/d page up/down, space jump to bottom

## Design decisions (UX)

- Full-window layout with a fixed header/status bar and a scrollable log list.
- Compact single-line rows with no separators; hover and selection use outlines for focus.
- Fixed-width datetime and severity columns to avoid text overlap.
- Plain logs are faded; warnings and errors receive subtle background tints.
- Optional alternating row background for scanability.
- Channel column is hidden by default and shows blanks for unspecified channels.
- Tags are in a dedicated column with a max width and quiet styling; wrap mode shows all tags.
- Details panel stays hidden until a row is selected; summary and extra fields use readable tables.
- Raw view has a dedicated copy button.
- Filter input has inline help, validation tinting, and tag-based filters you can remove.
- Status bar surfaces keyboard shortcuts, counts, connection state, and a scrolled/at-bottom indicator.
- New logs do not steal scroll position when you are reviewing earlier lines.
- Theme defaults to system preference and persists in localStorage.

## Performance notes

- Server and client both cap log history (default 10000) to keep memory/DOM bounded.
- New logs append incrementally when filters are unchanged; full re-render happens only on state changes.
- Rendering uses `DocumentFragment` to minimize layout thrash.
- Filter input is debounced so typing does not trigger a full list rebuild every keystroke.
- SSE keeps a lightweight streaming connection; no polling.
- Large scanner buffer (10MB) avoids slow-path failures on long log lines.
