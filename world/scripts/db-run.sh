#!/usr/bin/env bash
# Runs one database-brained Clearing episode: the module asks the models
# itself, so no harness runs. Starts it with begin_run (Ivy, Rook, Sage and
# Wren cycle over the given models), records it, waits until the rescue
# resolves or every model survivor is dead, pauses the world (also on Ctrl-C,
# or early when every model keeps failing), and writes the report. Load the
# keys first with scripts/load-model-keys.sh.
#
#   scripts/db-run.sh <db> <modelId>[,<modelId>...] [promptVariant] [food] [timeScale] [local|maincloud]
#
# e.g.
#   scripts/db-run.sh endersbench-deepseek bitdeer:deepseek-ai/DeepSeek-V4.1-Flash
set -u
DB=${1:?usage: scripts/db-run.sh <db> <modelId>[,<modelId>...] [promptVariant] [food] [timeScale] [local|maincloud]}
MODELS=${2:?give at least one modelId}
VARIANT=${3:-reward}
FOOD=${4:-1}
SCALE=${5:-0.5}
SERVER=${6:-local}
W=$(cd "$(dirname "$0")/.." && pwd)
LOG=${LOG:-$W/runs/_logs/db-$DB-$(date +%Y%m%dT%H%M%S)}
mkdir -p "$LOG"
export PATH="$HOME/.local/bin:$PATH"
HOST=ws://localhost:3000
[ "$SERVER" = maincloud ] && HOST=wss://maincloud.spacetimedb.com
cd "$W"
for entry in record report; do
  npx esbuild harness/$entry-main.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-harness/$entry.js --log-level=warning
done

# The spacetime CLI honours world/spacetime.json inside world/, so call from a neutral directory.
sql() { (cd /tmp && spacetime sql "$DB" "$1" --server "$SERVER" 2>/dev/null); }

IFS=, read -ra M <<< "$MODELS"
roster=''
i=0
for name in Ivy Rook Sage Wren; do
  roster+="${roster:+,}{\"name\":\"$name\",\"model_id\":\"${M[$((i % ${#M[@]}))]}\"}"
  i=$((i + 1))
done
out=$(cd /tmp && spacetime call "$DB" begin_run "[$roster]" "\"$VARIANT\"" "$FOOD" 0 0 "$SCALE" --server "$SERVER" 2>&1) \
  || { echo "$out" | grep -v WARNING; echo "begin_run failed"; exit 1; }
echo "Started $DB: [$roster] · prompt $VARIANT · food $FOOD · time scale $SCALE. Logs: $LOG"

SPACETIMEDB_HOST=$HOST SPACETIMEDB_DB_NAME=$DB node dist-harness/record.js > "$LOG/record.log" 2>&1 &
rpid=$!

# No process asks the models in a database run, so stopping means pausing the
# world: otherwise a missed plane keeps survivors (and the bill) going.
stop_world() { (cd /tmp && spacetime call "$DB" set_running false --server "$SERVER" > /dev/null 2>&1); }
trap 'echo "Interrupted: pausing $DB so its models stop being asked."; stop_world; kill $rpid 2>/dev/null; exit 130' INT TERM

n=0
while :; do
  sleep 15
  state=$(sql "SELECT rescue_state FROM world" | tail -1 | tr -d ' "')
  alive=$(sql "SELECT name FROM agent WHERE alive = true AND kind = 'llm'" | tail -n +3 | grep -c .)
  t=$(sql "SELECT game_time_ms FROM world" | tail -1 | awk '{print int($1)}')
  # Every model failing over and over (no key, a rejected key, a dead endpoint): stop now, not after a wasted episode.
  streaks=$(sql "SELECT failing_in_a_row FROM model_health" | tail -n +3 | grep -E '[0-9]')
  if [ -n "$streaks" ] && [ "$(echo "$streaks" | awk '$1 < 5' | wc -l)" -eq 0 ]; then
    echo "Every model is failing; pausing $DB. Last errors:"
    sql "SELECT model_id, last_error FROM model_health"
    stop_world
    kill $rpid 2>/dev/null
    exit 1
  fi
  if [ "${t:-0}" -gt 30000 ] && { [ "$state" != "waiting" ] || [ "${alive:-1}" -eq 0 ]; }; then break; fi
  n=$((n + 1))
  [ $((n % 4)) -eq 0 ] && echo "game time $((${t:-0} / 1000)) s · alive $alive · rescue $state"
done
stop_world
sleep 8
SPACETIMEDB_HOST=$HOST SPACETIMEDB_DB_NAME=$DB node dist-harness/report.js > "$LOG/report.md" 2>&1
kill $rpid 2>/dev/null
wait $rpid 2>/dev/null
echo "$DB done: rescue=$state alive=$alive t=$t $(grep -m1 'Wrote' "$LOG/report.md")"
