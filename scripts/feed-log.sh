#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: feed-log.sh [options]

Feeds a file line-by-line to stdout with random delays.

Options:
  -f, --file PATH     Input file (default: log.txt)
  --min SECONDS       Minimum delay in seconds (default: 0.1)
  --max SECONDS       Maximum delay in seconds (default: 2)
  -b, --burst N       Print N lines immediately before delays (default: 0)
  -h, --help          Show this help

Example:
  ./scripts/feed-log.sh --file log.txt --min 0.1 --max 2 --burst 25
USAGE
}

file="log.txt"
min_delay="0.1"
max_delay="2"
burst="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      file="$2"
      shift 2
      ;;
    --min)
      min_delay="$2"
      shift 2
      ;;
    --max)
      max_delay="$2"
      shift 2
      ;;
    -b|--burst)
      burst="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
 done

if [[ ! -f "$file" ]]; then
  echo "File not found: $file" >&2
  exit 1
fi

if ! awk -v min="$min_delay" -v max="$max_delay" 'BEGIN{exit !(min >= 0 && max >= 0 && max >= min)}'; then
  echo "Invalid delay range: min=$min_delay max=$max_delay" >&2
  exit 1
fi

if ! [[ "$burst" =~ ^[0-9]+$ ]]; then
  echo "Invalid burst value: $burst" >&2
  exit 1
fi

line_num=0
while IFS= read -r line; do
  line_num=$((line_num + 1))
  printf '%s\n' "$line"
  if (( line_num <= burst )); then
    continue
  fi
  delay=$(awk -v r="$RANDOM" -v min="$min_delay" -v max="$max_delay" 'BEGIN{printf "%.3f", min + (r/32767)*(max-min)}')
  sleep "$delay"
 done < "$file"
