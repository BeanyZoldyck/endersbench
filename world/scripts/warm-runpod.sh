#!/usr/bin/env bash
# Wakes our Runpod vLLM endpoints (Ender, Abliterated) and waits until each answers,
# so a run's first decisions don't time out on a cold worker: a cold A40 worker takes
# minutes (10-14 the first time on a new template). Workers stop after 60 idle seconds,
# so warm right before a run; scripts/db-run.sh does this for rosters that use them.
# URLs and keys come from the repo's .env, else this shell. Nothing secret is printed,
# and keys reach curl on stdin, not its command line.
#
#   scripts/warm-runpod.sh                 # both
#   scripts/warm-runpod.sh ender           # or: abliterated
#   WARM_TIMEOUT=1800 scripts/warm-runpod.sh
set -u
W=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=$W/../.env
# In an extra git worktree, the keys live in the main checkout's .env.
if [ ! -f "$ENV_FILE" ]; then
  common=$(git -C "$W" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$common" ] && ENV_FILE=$(dirname "$common")/.env
fi
setting() {
  local v
  v=$( (grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null || true) | cut -d= -f2- | tr -d "\"' \r")
  echo "${v:-${!1:-}}"
}
RUNPOD_KEY=$(setting RUNPOD_API_KEY)
ENDER_URL=$(setting ENDER_BASE_URL)
ENDER_KEY=$(setting ENDER_API_KEY)
ENDER_KEY=${ENDER_KEY:-$RUNPOD_KEY}
ABLITERATED_URL=$(setting ABLITERATED_BASE_URL)
ABLITERATED_URL=${ABLITERATED_URL:-https://api.runpod.ai/v2/g79oyxa5vbrwnv/openai/v1}
TIMEOUT=${WARM_TIMEOUT:-1500}
TARGETS=${*:-ender abliterated}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

authed() { printf 'header = "Authorization: Bearer %s"\n' "$1" | curl -s -K - "${@:2}"; }

# Worker counts from Runpod's health route, e.g. "initializing 1, idle 0, running 0".
health() {
  authed "$2" -m 10 "https://api.runpod.ai/v2/$1/health" | python3 -I -c '
import json, sys
try:
    w = json.load(sys.stdin).get("workers", {})
    print(", ".join(f"{k} {w[k]}" for k in ("initializing", "idle", "running", "unhealthy") if k in w))
except Exception:
    pass'
}

warm() { # name url key model
  local name=$1 url=${2%/} key=$3 model=$4
  if [ -z "$url" ] || [ -z "$key" ]; then echo "$name: no URL or key, skipped"; return 1; fi
  local id start pid code
  id=$(echo "$url" | sed -nE 's#.*/v2/([^/]+)/.*#\1#p')
  start=$(date +%s)
  authed "$key" -m "$TIMEOUT" -o "$tmp/$name.json" -w '%{http_code}' -H 'content-type: application/json' \
    -d "{\"model\":\"$model\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ready?\"}]}" \
    "$url/chat/completions" > "$tmp/$name.code" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15
    kill -0 "$pid" 2>/dev/null || break
    echo "$name: waiting $(( $(date +%s) - start )) s${id:+ · workers: $(health "$id" "$key")}"
  done
  wait "$pid"
  code=$(cat "$tmp/$name.code" 2>/dev/null)
  if [ "$code" = 200 ]; then
    echo "$name: warm after $(( $(date +%s) - start )) s"
    return 0
  fi
  echo "$name: not warm (HTTP ${code:-none} after $(( $(date +%s) - start )) s): $(head -c 200 "$tmp/$name.json" 2>/dev/null)"
  return 1
}

pids=()
for target in $TARGETS; do
  case $target in
    ender) warm ender "$ENDER_URL" "$ENDER_KEY" ender & pids+=($!) ;;
    abliterated) warm abliterated "$ABLITERATED_URL" "$RUNPOD_KEY" abliterated & pids+=($!) ;;
    *) echo "unknown endpoint '$target' (use ender or abliterated)"; exit 2 ;;
  esac
done
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
exit $status
