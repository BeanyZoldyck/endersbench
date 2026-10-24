#!/usr/bin/env bash
# Runs experiment arms in parallel against local databases, one Codex login per arm.
#
#   scripts/experiment.sh "db:codexProfile:promptVariant:foodScale[:model[:roleOffset[:rescueSeats]]]" ...
#
# e.g.
#   scripts/experiment.sh endersbench:mdl:reward:1 endersbench-b:ebe:charter:1 endersbench-c:jle:reward:2:gpt-6-sol
#
# Each arm: publish is up to you (one database per arm, published with
# --delete-data); this script starts the harness (4 survivors on the model, at
# TIME_SCALE 0.5) and a recorder, waits until the rescue resolves or everyone is
# dead, writes the report, and stops the harness. Logs go to runs/_logs/<stamp>/.
set -u
W=$(cd "$(dirname "$0")/.." && pwd)
LOG=${LOG:-$W/runs/_logs/$(date +%Y%m%dT%H%M%S)}
mkdir -p "$LOG"
export PATH="$HOME/.local/bin:$PATH"
cd "$W"
for entry in main record report; do
  npx esbuild harness/$entry$([ $entry = main ] && echo .ts || echo -main.ts) --bundle --platform=node --format=esm --packages=external --outfile=dist-harness/$entry.js --log-level=warning
done

# The spacetime CLI honours world/spacetime.json inside world/, so query from a neutral directory.
sql() { (cd /tmp && spacetime sql "$1" "$2" --server local 2>/dev/null); }

arm() {
  IFS=: read -r db profile variant food model offset seats <<< "$1"
  model=${model:-gpt-6-luna}; offset=${offset:-0}; seats=${seats:-0}
  local roster="Ivy:codex:$model,Rook:codex:$model,Sage:codex:$model,Wren:codex:$model"
  SPACETIMEDB_DB_NAME=$db ROSTER=$roster CODEX_HOME=$HOME/.codex-$profile PROMPT_VARIANT=$variant \
    FOOD_SCALE=$food ROLE_OFFSET=$offset RESCUE_SEATS=$seats TIME_SCALE=${TIME_SCALE:-0.5} DECISION_TIMEOUT_MS=45000 \
    node dist-harness/main.js > "$LOG/$db.harness.log" 2>&1 &
  local hpid=$!
  sleep 15
  SPACETIMEDB_DB_NAME=$db node dist-harness/record.js > "$LOG/$db.record.log" 2>&1 &
  local rpid=$!
  local state alive t
  while :; do
    state=$(sql "$db" "SELECT rescue_state FROM world" | tail -1 | tr -d ' "')
    alive=$(sql "$db" "SELECT name FROM agent WHERE alive = true" | tail -n +3 | grep -c .)
    t=$(sql "$db" "SELECT game_time_ms FROM world" | tail -1 | awk '{print int($1)}')
    if [ "${t:-0}" -gt 30000 ] && { [ "$state" != "waiting" ] || [ "$alive" -eq 0 ]; }; then break; fi
    kill -0 $hpid 2>/dev/null || { echo "$db: harness exited early" >> "$LOG/experiment.log"; break; }
    sleep 15
  done
  sleep 8
  SPACETIMEDB_DB_NAME=$db node dist-harness/report.js > "$LOG/$db.report.md" 2>&1
  kill $hpid 2>/dev/null; wait $rpid 2>/dev/null
  echo "$db done: rescue=$state alive=$alive t=$t $(grep -m1 'Wrote' "$LOG/$db.report.md")" >> "$LOG/experiment.log"
}

for spec in "$@"; do arm "$spec" & sleep 5; done
wait
echo "ALL DONE" >> "$LOG/experiment.log"
cat "$LOG/experiment.log"
