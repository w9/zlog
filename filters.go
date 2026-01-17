package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type filterExpression struct {
	kind     string
	path     []interface{}
	operator string
	value    interface{}
	regex    *regexp.Regexp
}

func parseFilterExpressions(filters []string) ([]filterExpression, error) {
	if len(filters) == 0 {
		return nil, nil
	}
	expressions := make([]filterExpression, 0, len(filters))
	for _, raw := range filters {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		expr, err := parseFilterExpression(trimmed)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", trimmed, err)
		}
		expressions = append(expressions, expr)
	}
	return expressions, nil
}

func parseFilterExpression(input string) (filterExpression, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return filterExpression{}, fmt.Errorf("filter is empty")
	}
	if strings.HasPrefix(strings.ToLower(raw), "select(") {
		return filterExpression{}, fmt.Errorf("select syntax is not supported")
	}
	if expr, ok := parseMessageContainsShorthand(raw); ok {
		return expr, nil
	}
	if expr, err := parseRegexShorthand(raw); err != nil || expr.kind != "" {
		return expr, err
	}
	pathResult, err := parsePathExpression(raw)
	if err != nil {
		return filterExpression{}, err
	}
	rest := strings.TrimSpace(pathResult.rest)
	if strings.HasPrefix(rest, "?") {
		rest = strings.TrimSpace(rest[1:])
	}
	if rest == "" {
		return filterExpression{kind: "exists", path: pathResult.path}, nil
	}
	opResult, err := parseOperatorAndValue(rest)
	if err != nil {
		return filterExpression{}, err
	}
	return filterExpression{
		kind:     "compare",
		path:     pathResult.path,
		operator: opResult.operator,
		value:    opResult.value,
	}, nil
}

func parseMessageContainsShorthand(expr string) (filterExpression, bool) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" || strings.HasPrefix(trimmed, ".") || strings.HasPrefix(trimmed, "/") {
		return filterExpression{}, false
	}
	value := trimmed
	if len(value) > 1 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return filterExpression{
		kind:     "compare",
		path:     []interface{}{"message"},
		operator: "contains",
		value:    value,
	}, true
}

func parseRegexShorthand(expr string) (filterExpression, error) {
	trimmed := strings.TrimSpace(expr)
	if !strings.HasPrefix(trimmed, "/") {
		return filterExpression{}, nil
	}
	if trimmed == "/" {
		return filterExpression{}, fmt.Errorf("regex pattern is empty")
	}
	pattern := trimmed[1:]
	flags := ""
	lastSlash := findLastUnescapedSlash(trimmed)
	if lastSlash > 0 {
		tail := trimmed[lastSlash+1:]
		if regexp.MustCompile(`^[gimsuy]*$`).MatchString(tail) {
			pattern = trimmed[1:lastSlash]
			flags = tail
		}
	}
	if pattern == "" {
		return filterExpression{}, fmt.Errorf("regex pattern is empty")
	}
	compiled, err := compileRegex(pattern, flags)
	if err != nil {
		return filterExpression{}, fmt.Errorf("invalid regex")
	}
	return filterExpression{
		kind: "regex",
		path: []interface{}{"message"},
		regex: compiled,
	}, nil
}

func compileRegex(pattern, flags string) (*regexp.Regexp, error) {
	var prefix string
	if strings.Contains(flags, "i") {
		prefix += "(?i)"
	}
	if strings.Contains(flags, "m") {
		prefix += "(?m)"
	}
	if strings.Contains(flags, "s") {
		prefix += "(?s)"
	}
	return regexp.Compile(prefix + pattern)
}

func findLastUnescapedSlash(input string) int {
	for i := len(input) - 1; i >= 0; i-- {
		if input[i] == '/' {
			if i == 0 || input[i-1] != '\\' {
				return i
			}
		}
	}
	return -1
}

type pathParseResult struct {
	path []interface{}
	rest string
}

func parsePathExpression(input string) (pathParseResult, error) {
	if !strings.HasPrefix(input, ".") {
		return pathParseResult{}, fmt.Errorf("filters must start with a '.' path")
	}
	i := 1
	path := make([]interface{}, 0)
loop:
	for i < len(input) {
		if input[i] == '.' {
			i++
		}
		if i >= len(input) {
			break
		}
		switch input[i] {
		case '[':
			value, next, err := parseBracketSegment(input, i)
			if err != nil {
				return pathParseResult{}, err
			}
			path = append(path, value)
			i = next
		case '\'', '"':
			value, next, err := parseQuotedString(input, i)
			if err != nil {
				return pathParseResult{}, err
			}
			path = append(path, value)
			i = next
		default:
			if !isIdentifierChar(input[i]) {
				break loop
			}
			start := i
			for i < len(input) && isIdentifierChar(input[i]) {
				i++
			}
			path = append(path, input[start:i])
		}
		if i < len(input) && input[i] == '?' {
			i++
		}
		if i >= len(input) {
			break
		}
		if input[i] == '.' || input[i] == '[' {
			continue
		}
		if isOperatorStart(input[i]) || isWhitespace(input[i]) {
			break
		}
		return pathParseResult{}, fmt.Errorf("unexpected token in path")
	}
	return pathParseResult{path: path, rest: input[i:]}, nil
}

func parseBracketSegment(input string, index int) (interface{}, int, error) {
	i := index + 1
	for i < len(input) && isWhitespace(input[i]) {
		i++
	}
	if i >= len(input) {
		return nil, 0, fmt.Errorf("unclosed bracket in path")
	}
	var value interface{}
	if input[i] == '"' || input[i] == '\'' {
		parsed, next, err := parseQuotedString(input, i)
		if err != nil {
			return nil, 0, err
		}
		value = parsed
		i = next
	} else {
		start := i
		for i < len(input) && !isWhitespace(input[i]) && input[i] != ']' {
			i++
		}
		token := input[start:i]
		if token == "" {
			return nil, 0, fmt.Errorf("empty bracket segment")
		}
		if regexp.MustCompile(`^-?\d+$`).MatchString(token) {
			num, _ := strconv.Atoi(token)
			value = num
		} else {
			value = token
		}
	}
	for i < len(input) && isWhitespace(input[i]) {
		i++
	}
	if i >= len(input) || input[i] != ']' {
		return nil, 0, fmt.Errorf("unclosed bracket in path")
	}
	return value, i + 1, nil
}

func parseQuotedString(input string, index int) (string, int, error) {
	quote := input[index]
	i := index + 1
	var value strings.Builder
	for i < len(input) {
		ch := input[i]
		if ch == '\\' {
			next := byte(0)
			if i+1 < len(input) {
				next = input[i+1]
			}
			if next != 0 {
				value.WriteByte(next)
				i += 2
				continue
			}
		}
		if ch == quote {
			return value.String(), i + 1, nil
		}
		value.WriteByte(ch)
		i++
	}
	return "", 0, fmt.Errorf("unterminated string")
}

type operatorParseResult struct {
	operator string
	value    interface{}
}

func parseOperatorAndValue(input string) (operatorParseResult, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return operatorParseResult{}, fmt.Errorf("missing operator")
	}
	wordMatch := regexp.MustCompile(`^(contains|startswith|endswith)\b(?i)`).FindStringSubmatch(trimmed)
	if len(wordMatch) > 0 {
		operator := strings.ToLower(wordMatch[1])
		rest := strings.TrimSpace(trimmed[len(wordMatch[0]):])
		value, err := parseValueLiteral(rest)
		if err != nil {
			return operatorParseResult{}, err
		}
		return operatorParseResult{operator: operator, value: value}, nil
	}
	symbolMatch := regexp.MustCompile(`^(==|!=|>=|<=|>|<|=)`).FindStringSubmatch(trimmed)
	if len(symbolMatch) == 0 {
		return operatorParseResult{}, fmt.Errorf("expected an operator")
	}
	operator := symbolMatch[1]
	if operator == "=" {
		operator = "=="
	}
	rest := strings.TrimSpace(trimmed[len(symbolMatch[0]):])
	value, err := parseValueLiteral(rest)
	if err != nil {
		return operatorParseResult{}, err
	}
	return operatorParseResult{operator: operator, value: value}, nil
}

func parseValueLiteral(input string) (interface{}, error) {
	if strings.TrimSpace(input) == "" {
		return nil, fmt.Errorf("missing value")
	}
	trimmed := strings.TrimSpace(input)
	if trimmed[0] == '"' || trimmed[0] == '\'' {
		value, next, err := parseQuotedString(trimmed, 0)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(trimmed[next:]) != "" {
			return nil, fmt.Errorf("unexpected token after quoted value")
		}
		return value, nil
	}
	token := strings.Fields(trimmed)[0]
	rest := strings.TrimSpace(trimmed[len(token):])
	if rest != "" {
		return nil, fmt.Errorf("unexpected token after value")
	}
	return coerceLiteral(token), nil
}

func coerceLiteral(value string) interface{} {
	lower := strings.ToLower(value)
	if lower == "true" {
		return true
	}
	if lower == "false" {
		return false
	}
	if lower == "null" {
		return nil
	}
	if regexp.MustCompile(`^-?\d+(\.\d+)?$`).MatchString(value) {
		if num, err := strconv.ParseFloat(value, 64); err == nil {
			return num
		}
	}
	return value
}

func isIdentifierChar(char byte) bool {
	return (char >= 'A' && char <= 'Z') ||
		(char >= 'a' && char <= 'z') ||
		(char >= '0' && char <= '9') ||
		char == '_' || char == '@' || char == '-'
}

func isOperatorStart(char byte) bool {
	return char == '=' || char == '!' || char == '>' || char == '<'
}

func isWhitespace(char byte) bool {
	return char == ' ' || char == '\t' || char == '\n' || char == '\r'
}

func passesFilterExpressions(entry LogEntry, filters []filterExpression) bool {
	if len(filters) == 0 {
		return true
	}
	scope := buildFilterScope(entry)
	for _, expr := range filters {
		if !evaluateFilterExpression(expr, scope) {
			return false
		}
	}
	return true
}

func buildFilterScope(entry LogEntry) map[string]interface{} {
	scope := map[string]interface{}{}
	for key, value := range entry.Fields {
		scope[key] = value
	}
	assignIfMissing(scope, "level", entry.Level)
	assignIfMissing(scope, "time", entry.Time)
	assignIfMissing(scope, "ingested", entry.Ingested)
	assignIfMissing(scope, "msg", entry.Msg)
	assignIfMissing(scope, "message", entry.Msg)
	assignIfMissing(scope, "raw", entry.Raw)
	assignIfMissing(scope, "parseError", entry.ParseError)
	channelValue := getChannelValue(entry)
	if channelValue != nil {
		assignIfMissing(scope, "channel", channelValue)
		assignIfMissing(scope, "chanel", channelValue)
	}
	return scope
}

func assignIfMissing(target map[string]interface{}, key string, value interface{}) {
	if _, ok := target[key]; !ok {
		target[key] = value
	}
}

func getChannelValue(entry LogEntry) interface{} {
	if entry.Fields == nil {
		return nil
	}
	if value, ok := entry.Fields["channel"]; ok {
		return value
	}
	if value, ok := entry.Fields["chanel"]; ok {
		return value
	}
	return nil
}

func evaluateFilterExpression(expression filterExpression, scope map[string]interface{}) bool {
	if expression.kind == "regex" {
		value := getValueAtPath(scope, expression.path)
		if value == nil {
			return false
		}
		return expression.regex.MatchString(fmt.Sprint(value))
	}
	value := getValueAtPath(scope, expression.path)
	if expression.kind == "exists" {
		return value != nil
	}
	if value == nil {
		return false
	}
	return compareValues(value, expression.operator, expression.value)
}

func getValueAtPath(scope interface{}, path []interface{}) interface{} {
	current := scope
	for _, segment := range path {
		if current == nil {
			return nil
		}
		switch idx := segment.(type) {
		case int:
			slice, ok := current.([]interface{})
			if !ok {
				return nil
			}
			if idx < 0 || idx >= len(slice) {
				return nil
			}
			current = slice[idx]
		case string:
			obj, ok := current.(map[string]interface{})
			if !ok {
				return nil
			}
			value, ok := obj[idx]
			if !ok {
				return nil
			}
			current = value
		default:
			return nil
		}
	}
	return current
}

func compareValues(actual interface{}, operator string, expected interface{}) bool {
	switch operator {
	case "contains":
		switch value := actual.(type) {
		case []interface{}:
			for _, item := range value {
				if valuesEqual(item, expected) {
					return true
				}
			}
			return false
		default:
			return strings.Contains(fmt.Sprint(actual), fmt.Sprint(expected))
		}
	case "startswith":
		return strings.HasPrefix(fmt.Sprint(actual), fmt.Sprint(expected))
	case "endswith":
		return strings.HasSuffix(fmt.Sprint(actual), fmt.Sprint(expected))
	}
	leftNum, leftOk := coerceNumber(actual)
	rightNum, rightOk := coerceNumber(expected)
	if leftOk && rightOk {
		switch operator {
		case "==":
			return leftNum == rightNum
		case "!=":
			return leftNum != rightNum
		case ">":
			return leftNum > rightNum
		case "<":
			return leftNum < rightNum
		case ">=":
			return leftNum >= rightNum
		case "<=":
			return leftNum <= rightNum
		default:
			return false
		}
	}
	leftStr := fmt.Sprint(actual)
	rightStr := fmt.Sprint(expected)
	switch operator {
	case "==":
		return leftStr == rightStr
	case "!=":
		return leftStr != rightStr
	case ">":
		return leftStr > rightStr
	case "<":
		return leftStr < rightStr
	case ">=":
		return leftStr >= rightStr
	case "<=":
		return leftStr <= rightStr
	default:
		return false
	}
}

func valuesEqual(actual interface{}, expected interface{}) bool {
	leftNum, leftOk := coerceNumber(actual)
	rightNum, rightOk := coerceNumber(expected)
	if leftOk && rightOk {
		return leftNum == rightNum
	}
	leftBool, okLeft := actual.(bool)
	rightBool, okRight := expected.(bool)
	if okLeft && okRight {
		return leftBool == rightBool
	}
	return fmt.Sprint(actual) == fmt.Sprint(expected)
}

func coerceNumber(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed != "" && regexp.MustCompile(`^-?\d+(\.\d+)?$`).MatchString(trimmed) {
			num, err := strconv.ParseFloat(trimmed, 64)
			if err == nil {
				return num, true
			}
		}
	}
	return 0, false
}
