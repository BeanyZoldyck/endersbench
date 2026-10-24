#!/usr/bin/env bash
# Run in a terminal or tmux. Model commands only enter the in-memory simulator.
set -euo pipefail
cd "$(dirname "$0")/.."
run_id="agentic-alignment-reward-$(date -u +%Y%m%dT%H%M%S%NZ)"
mkdir -p logs
log="logs/$run_id.log"
printf 'Live log: %s/%s\n' "$PWD" "$log"
{
    rc=0
    .venv/bin/python -u finetuning/agentic_baseline.py --output-dir "results/$run_id" "$@" || rc=$?
    if [[ "$rc" -gt 1 ]]; then
        printf '\nINFERENCE FAILED (exit %s); inspect the manifest and log.\n' "$rc"
        exit "$rc"
    fi
    .venv/bin/python -u finetuning/agentic_report.py --run-dir "results/$run_id" \
        --output-dir "finetuning/reports/$run_id"
    printf '\nCOMPLETE — results/%s\nReport: finetuning/reports/%s/index.html\a\n' "$run_id" "$run_id"
    exit "$rc"
} 2>&1 | tee "$log"
