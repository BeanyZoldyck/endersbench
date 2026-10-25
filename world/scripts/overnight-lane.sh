#!/usr/bin/env bash
# One overnight lane: repeated database-brained Clearing runs in one local world,
# cycling through "models|prompt" entries, until it has finished MAX runs, five runs
# in a row have failed, or runs/_overnight/STOP exists. Each run is scripts/db-run.sh
# (rules as published, food 1, time scale 0.5), so it is recorded and reported.
#
#   scripts/overnight-lane.sh <db> <max-runs> "<models>|<prompt>" ["<models>|<prompt>" ...]
#
# e.g.
#   scripts/overnight-lane.sh endersbench-nx-haiku 30 "anthropic:claude-haiku-5-5|reward" "anthropic:claude-haiku-5-5|charter"
set -u
DB=${1:?usage: scripts/overnight-lane.sh <db> <max-runs> "<models>|<prompt>" ...}
MAX=${2:?give a maximum number of runs}
shift 2
ENTRIES=("$@")
[ ${#ENTRIES[@]} -gt 0 ] || { echo "give at least one \"<models>|<prompt>\" entry"; exit 2; }
W=$(cd "$(dirname "$0")/.." && pwd)
OUT=$W/runs/_overnight
mkdir -p "$OUT"
LOG=$OUT/$DB.log
say() { echo "$(date -Is) $*" >> "$LOG"; }

done_runs=0
failed_in_a_row=0
i=0
say "lane start: $DB, up to $MAX runs, entries: ${ENTRIES[*]}"
while [ "$done_runs" -lt "$MAX" ] && [ ! -e "$OUT/STOP" ] && [ "$failed_in_a_row" -lt 5 ]; do
  IFS='|' read -r models prompt <<< "${ENTRIES[$((i % ${#ENTRIES[@]}))]}"
  i=$((i + 1))
  # Roles follow roster order; rotate them so no model always plays the same one.
  offset=$(( (i - 1) % 4 ))
  say "run start: $models · $prompt · roles +$offset"
  if ROLE_OFFSET=$offset SKIP_BUILD=1 "$W/scripts/db-run.sh" "$DB" "$models" "$prompt" 1 0.5 local >> "$LOG" 2>&1; then
    done_runs=$((done_runs + 1))
    failed_in_a_row=0
    say "run done ($done_runs/$MAX)"
  else
    failed_in_a_row=$((failed_in_a_row + 1))
    say "run failed ($failed_in_a_row in a row); waiting 120 s"
    sleep 120
  fi
done
say "lane finished: $done_runs runs$([ -e "$OUT/STOP" ] && echo ', stopped by STOP')$([ "$failed_in_a_row" -ge 5 ] && echo ', five failures in a row')"
