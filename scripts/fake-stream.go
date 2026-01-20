package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	initialCount     int
	minDelaySec      float64
	maxDelaySec      float64
	weightTrace      int
	weightDebug      int
	weightInfo       int
	weightWarn       int
	weightError      int
	weightPlain      int
	extraMin         int
	extraMax         int
	extraSampleProb  float64
	initialLambda    float64
	seed             int64
	hostnameFallback string
}

type samplePool struct {
	jsonSamples  []map[string]interface{}
	plainSamples []string
	msgSamples   []string
	channels     []string
	basePaths    []string
	actions      []string
	terms        []string
	hostnames    []string
}

func main() {
	cfg := config{
		initialCount:     10000,
		minDelaySec:      0.0,
		maxDelaySec:      1.0,
		weightTrace:      100,
		weightDebug:      10,
		weightInfo:       5,
		weightWarn:       3,
		weightError:      1,
		weightPlain:      5,
		extraMin:         0,
		extraMax:         4,
		extraSampleProb:  0.4,
		initialLambda:    0.01,
		seed:             time.Now().UnixNano(),
		hostnameFallback: "zlog-fake",
	}

	flag.IntVar(&cfg.initialCount, "initial", cfg.initialCount, "Initial log lines to emit immediately")
	flag.Float64Var(&cfg.minDelaySec, "min-delay", cfg.minDelaySec, "Minimum delay between emitted logs (seconds)")
	flag.Float64Var(&cfg.maxDelaySec, "max-delay", cfg.maxDelaySec, "Maximum delay between emitted logs (seconds)")
	flag.IntVar(&cfg.weightTrace, "weight-trace", cfg.weightTrace, "Weight for trace severity")
	flag.IntVar(&cfg.weightDebug, "weight-debug", cfg.weightDebug, "Weight for debug severity")
	flag.IntVar(&cfg.weightInfo, "weight-info", cfg.weightInfo, "Weight for info severity")
	flag.IntVar(&cfg.weightWarn, "weight-warn", cfg.weightWarn, "Weight for warning severity")
	flag.IntVar(&cfg.weightError, "weight-error", cfg.weightError, "Weight for error severity")
	flag.IntVar(&cfg.weightPlain, "weight-plain", cfg.weightPlain, "Weight for plain (non-JSON) lines")
	flag.IntVar(&cfg.extraMin, "extra-min", cfg.extraMin, "Minimum number of extra fields to add to JSON logs")
	flag.IntVar(&cfg.extraMax, "extra-max", cfg.extraMax, "Maximum number of extra fields to add to JSON logs")
	flag.Float64Var(&cfg.extraSampleProb, "extra-sample-prob", cfg.extraSampleProb, "Probability of copying extra fields from samples")
	flag.Float64Var(&cfg.initialLambda, "initial-lambda", cfg.initialLambda, "Lambda (1/s) for initial log time gaps")
	flag.Int64Var(&cfg.seed, "seed", cfg.seed, "Random seed")
	flag.StringVar(&cfg.hostnameFallback, "hostname", cfg.hostnameFallback, "Fallback hostname value")
	flag.Parse()

	if cfg.maxDelaySec < cfg.minDelaySec {
		cfg.maxDelaySec = cfg.minDelaySec
	}
	if cfg.extraMax < cfg.extraMin {
		cfg.extraMax = cfg.extraMin
	}

	pool := defaultSamples()
	rng := rand.New(rand.NewSource(cfg.seed))
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	if cfg.initialCount > 0 {
		gaps := make([]float64, cfg.initialCount)
		meanGap := 1.0
		if cfg.initialLambda > 0 {
			meanGap = 1 / cfg.initialLambda
		}
		for i := 0; i < cfg.initialCount; i++ {
			gaps[i] = rng.ExpFloat64() * meanGap
		}
		current := time.Now().Add(-time.Duration(meanGap*float64(cfg.initialCount)) * time.Second)
		for i := 0; i < cfg.initialCount; i++ {
			current = current.Add(time.Duration(gaps[i] * float64(time.Second)))
			emitLineAt(writer, rng, cfg, pool, current.UnixMilli())
		}
	}

	for {
		delay := cfg.minDelaySec
		if cfg.maxDelaySec > cfg.minDelaySec {
			delay = cfg.minDelaySec + rng.Float64()*(cfg.maxDelaySec-cfg.minDelaySec)
		}
		if delay > 0 {
			time.Sleep(time.Duration(delay * float64(time.Second)))
		}
		emitLineAt(writer, rng, cfg, pool, time.Now().UnixMilli())
	}
}

func defaultSamples() samplePool {
	return samplePool{
		msgSamples: []string{
			"Cache warm completed",
			"User session refreshed",
			"Background worker tick",
			"Payment intent created",
			"Email delivery queued",
			"Device heartbeat received",
			"Feature flag evaluated",
			"Rolling restart scheduled",
			"Queue depth high",
			"Index rebuilt",
		},
		plainSamples: []string{
			"starting service on port 8037",
			"connected to upstream",
			"retrying after network error",
			"healthy",
			"waiting for dependency",
			"reading configuration",
		},
		channels: []string{
			"api",
			"worker",
			"auth",
			"billing",
			"cache",
			"search",
		},
		basePaths: []string{
			"/api/v1/users",
			"/api/v1/search",
			"/api/v1/orders",
			"/api/v1/sessions",
			"/healthz",
		},
		actions: []string{
			"create",
			"update",
			"list",
			"delete",
			"refresh",
			"reindex",
		},
		terms: []string{
			"/action/list",
			"/action/create",
			"/action/refresh",
			"/jobs/worker",
		},
		hostnames: []string{
			"zlog-alpha",
			"zlog-beta",
			"zlog-gamma",
			"zlog-delta",
		},
		jsonSamples: []map[string]interface{}{
			{"feature": "fast-path", "enabled": true, "ratio": 0.15},
			{"region": "us-east-1", "az": "use1-az2", "retry": 1},
			{"region": "eu-west-1", "latencyMs": 128, "cached": false},
			{"queue": "ingest", "depth": 120, "lagMs": 450},
		},
	}
}

func emitLineAt(w *bufio.Writer, rng *rand.Rand, cfg config, pool samplePool, tsMs int64) {
	kind := pickSeverity(rng, cfg)
	if kind == "plain" {
		line := pickPlain(rng, pool)
		_, _ = w.WriteString(line + "\n")
		_ = w.Flush()
		return
	}

	level, levelName := levelForSeverity(kind)
	payload := map[string]interface{}{
		"level": level,
		"time":  tsMs,
		"pid":   rng.Intn(9000) + 1,
		"msg":   pickMessage(rng, pool, levelName),
	}
	hostname := pickOne(rng, pool.hostnames)
	if hostname == "" {
		hostname = cfg.hostnameFallback
	}
	payload["hostname"] = hostname

	if channel := pickOne(rng, pool.channels); channel != "" && rng.Float64() < 0.5 {
		payload["channel"] = channel
	}
	if basePath := pickOne(rng, pool.basePaths); basePath != "" && rng.Float64() < 0.4 {
		payload["basePath"] = basePath
	}
	if action := pickOne(rng, pool.actions); action != "" && rng.Float64() < 0.4 {
		payload["action"] = action
	}
	if term := pickOne(rng, pool.terms); term != "" && rng.Float64() < 0.4 {
		payload["term"] = term
	}

	addExtraFields(payload, rng, cfg, pool)

	encoded, err := json.Marshal(payload)
	if err != nil {
		_, _ = w.WriteString(fmt.Sprintf("failed to encode log: %v\n", err))
		_ = w.Flush()
		return
	}
	_, _ = w.WriteString(string(encoded) + "\n")
	_ = w.Flush()
}

func pickSeverity(rng *rand.Rand, cfg config) string {
	total := cfg.weightTrace + cfg.weightDebug + cfg.weightInfo + cfg.weightWarn + cfg.weightError + cfg.weightPlain
	if total <= 0 {
		return "info"
	}
	target := rng.Intn(total)
	if target < cfg.weightTrace {
		return "trace"
	}
	target -= cfg.weightTrace
	if target < cfg.weightDebug {
		return "debug"
	}
	target -= cfg.weightDebug
	if target < cfg.weightInfo {
		return "info"
	}
	target -= cfg.weightInfo
	if target < cfg.weightWarn {
		return "warn"
	}
	target -= cfg.weightWarn
	if target < cfg.weightError {
		return "error"
	}
	return "plain"
}

func levelForSeverity(severity string) (int, string) {
	switch severity {
	case "trace":
		return 10, "trace"
	case "debug":
		return 20, "debug"
	case "info":
		return 30, "info"
	case "warn":
		return 40, "warning"
	case "error":
		return 50, "error"
	default:
		return 30, "info"
	}
}

func pickPlain(rng *rand.Rand, pool samplePool) string {
	if len(pool.plainSamples) == 0 {
		return fmt.Sprintf("plain log line %d", rng.Intn(100000))
	}
	return ensurePlainLine(pool.plainSamples[rng.Intn(len(pool.plainSamples))])
}

func pickMessage(rng *rand.Rand, pool samplePool, severity string) string {
	if len(pool.msgSamples) == 0 {
		return fmt.Sprintf("Generated %s message %d", severity, rng.Intn(100000))
	}
	return pool.msgSamples[rng.Intn(len(pool.msgSamples))]
}

func ensurePlainLine(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "plain log line"
	}
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return fmt.Sprintf("plain: %s", trimmed)
	}
	var payload interface{}
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		return fmt.Sprintf("plain: %s", trimmed)
	}
	return trimmed
}

func pickOne(rng *rand.Rand, items []string) string {
	if len(items) == 0 {
		return ""
	}
	return items[rng.Intn(len(items))]
}

func addExtraFields(payload map[string]interface{}, rng *rand.Rand, cfg config, pool samplePool) {
	extraCount := cfg.extraMin
	if cfg.extraMax > cfg.extraMin {
		extraCount = cfg.extraMin + rng.Intn(cfg.extraMax-cfg.extraMin+1)
	}
	if extraCount == 0 {
		return
	}

	if len(pool.jsonSamples) > 0 && rng.Float64() < cfg.extraSampleProb {
		sample := pool.jsonSamples[rng.Intn(len(pool.jsonSamples))]
		keys := make([]string, 0, len(sample))
		for key := range sample {
			if key == "level" || key == "time" || key == "msg" {
				continue
			}
			keys = append(keys, key)
		}
		rng.Shuffle(len(keys), func(i, j int) { keys[i], keys[j] = keys[j], keys[i] })
		for i := 0; i < len(keys) && extraCount > 0; i++ {
			payload[keys[i]] = sample[keys[i]]
			extraCount--
		}
	}

	for extraCount > 0 {
		key, value := randomField(rng)
		if _, exists := payload[key]; exists {
			continue
		}
		payload[key] = value
		extraCount--
	}
}

func randomField(rng *rand.Rand) (string, interface{}) {
	switch rng.Intn(6) {
	case 0:
		return "requestId", randomHex(rng, 12)
	case 1:
		return "duration", rng.Intn(5000)
	case 2:
		return "userId", rng.Intn(9999)
	case 3:
		return "feature", fmt.Sprintf("feature_%d", rng.Intn(20))
	case 4:
		return "retry", rng.Intn(3)
	default:
		return "metadata", map[string]interface{}{
			"attempt": rng.Intn(5),
			"region":  fmt.Sprintf("us-%d", rng.Intn(3)+1),
		}
	}
}

func randomHex(rng *rand.Rand, length int) string {
	const chars = "abcdef0123456789"
	var b strings.Builder
	for i := 0; i < length; i++ {
		b.WriteByte(chars[rng.Intn(len(chars))])
	}
	return b.String()
}

func parseLevel(value interface{}) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 30
}
