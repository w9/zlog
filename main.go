package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultPort      = 8037
	defaultMaxEntries = 10000
	maxScanTokenSize = 10 * 1024 * 1024
)

type LogEntry struct {
	ID         int64                  `json:"id"`
	Time       string                 `json:"time,omitempty"`
	Ingested   string                 `json:"ingested"`
	SentMs     int64                  `json:"sentMs,omitempty"`
	Level      string                 `json:"level"`
	LevelNum   int                    `json:"levelNum,omitempty"`
	Msg        string                 `json:"msg"`
	Raw        string                 `json:"raw"`
	Fields     map[string]interface{} `json:"fields,omitempty"`
	ParseError string                 `json:"parseError,omitempty"`
}

type LogStore struct {
	mu      sync.Mutex
	entries []LogEntry
	max     int
	nextID  int64
}

func NewLogStore(max int) *LogStore {
	if max < 1 {
		max = 1
	}
	return &LogStore{
		entries: make([]LogEntry, 0, max),
		max:     max,
	}
}

func (s *LogStore) Add(entry LogEntry) LogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextID++
	entry.ID = s.nextID

	s.entries = append(s.entries, entry)
	if len(s.entries) > s.max {
		start := len(s.entries) - s.max
		trimmed := make([]LogEntry, s.max)
		copy(trimmed, s.entries[start:])
		s.entries = trimmed
	}

	return entry
}

func (s *LogStore) List() []LogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]LogEntry, len(s.entries))
	copy(out, s.entries)
	return out
}

func (s *LogStore) Max() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.max
}

type Hub struct {
	register   chan chan string
	unregister chan chan string
	broadcast  chan string
	clients    map[chan string]struct{}
}

func NewHub() *Hub {
	return &Hub{
		register:   make(chan chan string),
		unregister: make(chan chan string),
		broadcast:  make(chan string, 256),
		clients:    make(map[chan string]struct{}),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case ch := <-h.register:
			h.clients[ch] = struct{}{}
		case ch := <-h.unregister:
			if _, ok := h.clients[ch]; ok {
				delete(h.clients, ch)
				close(ch)
			}
		case msg := <-h.broadcast:
			for ch := range h.clients {
				select {
				case ch <- msg:
				default:
				}
			}
		}
	}
}

func (h *Hub) Register(ch chan string) {
	h.register <- ch
}

func (h *Hub) Unregister(ch chan string) {
	h.unregister <- ch
}

func (h *Hub) Broadcast(msg string) {
	h.broadcast <- msg
}

//go:embed web/*
var webFS embed.FS

func main() {
	log.SetFlags(0)

	host := flag.String("host", "127.0.0.1", "Host to bind")
	port := flag.Int("port", defaultPort, "Port to bind")
	maxEntries := flag.Int("max", defaultMaxEntries, "Max log entries to keep in memory")
	debugLatency := flag.Bool("debug-latency", false, "Include sentMs in SSE payloads")
	flag.Parse()

	store := NewLogStore(*maxEntries)
	hub := NewHub()
	go hub.Run()

	go func() {
		if err := readStdin(store, hub, *debugLatency); err != nil {
			log.Printf("stdin read error: %v", err)
		}
	}()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("failed to load web assets: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/events", serveEvents(hub))
	mux.HandleFunc("/logs", serveLogs(store))
	mux.HandleFunc("/config", serveConfig(store))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/", http.FileServer(http.FS(sub)))

	addr := net.JoinHostPort(*host, strconv.Itoa(*port))
	displayAddr := fmt.Sprintf("http://%s:%d", displayHost(*host), *port)
	if *debugLatency {
		displayAddr = displayAddr + "/?latency=1"
	}
	fmt.Printf("Server running on %s\n", displayAddr)
	if err := http.ListenAndServe(addr, mux); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func readStdin(store *LogStore, hub *Hub, includeSentMs bool) error {
	scanner := bufio.NewScanner(os.Stdin)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, maxScanTokenSize)

	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		var entry LogEntry
		if strings.TrimSpace(line) == "" {
			entry = LogEntry{
				Raw:      line,
				Ingested: formatTime(time.Now()),
				Level:    "plain",
				Msg:      "",
			}
		} else {
			entry = parseLine(line)
		}
		entry = store.Add(entry)
		if includeSentMs {
			entry.SentMs = time.Now().UnixMilli()
		}
		payload, err := json.Marshal(entry)
		if err != nil {
			continue
		}
		hub.Broadcast(string(payload))
	}

	return scanner.Err()
}

func serveEvents(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		headers := w.Header()
		headers.Set("Content-Type", "text/event-stream")
		headers.Set("Cache-Control", "no-cache")
		headers.Set("Connection", "keep-alive")
		headers.Set("X-Accel-Buffering", "no")

		ch := make(chan string, 64)
		hub.Register(ch)
		defer hub.Unregister(ch)

		_, _ = w.Write([]byte(":ok\n\n"))
		flusher.Flush()

		done := r.Context().Done()
		for {
			select {
			case <-done:
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				_, _ = fmt.Fprintf(w, "data: %s\n\n", msg)
				flusher.Flush()
			}
		}
	}
}

func serveLogs(store *LogStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		entries := store.List()
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if limit, err := strconv.Atoi(limitStr); err == nil && limit > 0 && limit < len(entries) {
				entries = entries[len(entries)-limit:]
			}
		}
		_ = json.NewEncoder(w).Encode(entries)
	}
}

func serveConfig(store *LogStore) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{
			"maxEntries": store.Max(),
		})
	}
}

func parseLine(line string) LogEntry {
	now := time.Now()
	entry := LogEntry{
		Raw:      line,
		Ingested: formatTime(now),
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		entry.Level = "plain"
		entry.Msg = line
		entry.ParseError = err.Error()
		return entry
	}

	entry.Fields = payload
	entry.Msg = pickString(payload, "msg", "message", "event", "error", "err")
	level, levelNum := extractLevel(payload)
	entry.Level = level
	entry.LevelNum = levelNum
	entry.Time = extractTime(payload)

	if entry.Msg == "" {
		entry.Msg = line
	}
	if entry.Level == "" {
		entry.Level = "unknown"
	}

	return entry
}

func pickString(fields map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		val, ok := fields[key]
		if !ok || val == nil {
			continue
		}
		switch v := val.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return v
			}
		default:
			return fmt.Sprint(v)
		}
	}
	return ""
}

func extractLevel(fields map[string]interface{}) (string, int) {
	keys := []string{"level", "severity", "lvl", "level_name"}
	for _, key := range keys {
		if val, ok := fields[key]; ok {
			return normalizeLevel(val)
		}
	}
	return "", 0
}

func normalizeLevel(val interface{}) (string, int) {
	switch v := val.(type) {
	case float64:
		return levelFromNumber(int(v))
	case string:
		return levelFromString(v)
	default:
		return "unknown", 0
	}
}

func levelFromNumber(num int) (string, int) {
	switch {
	case num >= 60:
		return "fatal", num
	case num >= 50:
		return "error", num
	case num >= 40:
		return "warn", num
	case num >= 30:
		return "info", num
	case num >= 20:
		return "debug", num
	case num >= 10:
		return "trace", num
	default:
		return "unknown", num
	}
}

func levelFromString(raw string) (string, int) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "unknown", 0
	}
	if num, err := strconv.Atoi(s); err == nil {
		return levelFromNumber(num)
	}

	switch s {
	case "trace":
		return "trace", 10
	case "debug", "dbg":
		return "debug", 20
	case "info", "information", "notice":
		return "info", 30
	case "warn", "warning":
		return "warn", 40
	case "error", "err":
		return "error", 50
	case "fatal", "panic", "critical", "crit":
		return "fatal", 60
	default:
		return "unknown", 0
	}
}

func extractTime(fields map[string]interface{}) string {
	keys := []string{"time", "timestamp", "ts", "@timestamp"}
	for _, key := range keys {
		if val, ok := fields[key]; ok {
			if rendered := formatTimeValue(val); rendered != "" {
				return rendered
			}
		}
	}
	return ""
}

func formatTimeValue(val interface{}) string {
	switch v := val.(type) {
	case float64:
		if t, ok := timeFromNumber(v); ok {
			return formatTime(t)
		}
	case string:
		if t, ok := parseTimeString(v); ok {
			return formatTime(t)
		}
		if num, err := strconv.ParseFloat(v, 64); err == nil {
			if t, ok := timeFromNumber(num); ok {
				return formatTime(t)
			}
		}
		return v
	}
	return ""
}

func timeFromNumber(num float64) (time.Time, bool) {
	if num <= 0 {
		return time.Time{}, false
	}
	switch {
	case num > 1e17:
		return time.Unix(0, int64(num)), true
	case num > 1e14:
		return time.UnixMicro(int64(num)), true
	case num > 1e11:
		return time.UnixMilli(int64(num)), true
	case num > 1e9:
		return time.Unix(int64(num), 0), true
	default:
		return time.Time{}, false
	}
}

func parseTimeString(raw string) (time.Time, bool) {
	candidates := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.000",
		"2006-01-02 15:04:05",
	}
	for _, layout := range candidates {
		if t, err := time.Parse(layout, raw); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func formatTime(t time.Time) string {
	return t.Local().Format("2006-01-02 15:04:05.000")
}

func displayHost(host string) string {
	switch host {
	case "", "0.0.0.0", "127.0.0.1", "::", "::1":
		return "localhost"
	default:
		return host
	}
}
