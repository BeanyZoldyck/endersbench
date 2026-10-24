#!/usr/bin/env bash
# Run in the foreground, or inside tmux for an attachable live Spark terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
run_id="alignment-reward-$(date -u +%Y%m%dT%H%M%S%NZ)"
mkdir -p logs
log="logs/${run_id}.log"
printf 'Live log: %s/%s\n' "$PWD" "$log"
{
    .venv/bin/python -u finetuning/scenario_baseline.py --output-dir "results/$run_id" "$@"
    .venv/bin/python -u finetuning/scenario_report.py --run-dir "results/$run_id" \
        --output-dir "finetuning/reports/$run_id"
    printf '\nCOMPLETE — results/%s\nReport: finetuning/reports/%s/index.html\a\n' "$run_id" "$run_id"
} 2>&1 | tee "$log"
