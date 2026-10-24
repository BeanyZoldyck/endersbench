#!/usr/bin/env bash
# Restart only unresolved episodes, without replacing the original run.
set -euo pipefail
if [[ "$#" -lt 2 ]]; then
    echo "Usage: bash finetuning/retry_unresolved.sh <source-run-directory> <dataset-snapshot-directory>"
    exit 2
fi
source_run="$(realpath "$1")"
data_root="$(realpath "$2")"
shift 2
cd "$(dirname "$0")/.."
bash finetuning/run_agentic_scenarios.sh \
    --retry-unresolved-from "$source_run" --data-root "$data_root" \
    --max-turns 80 --max-tokens-per-turn 1024 --max-episode-tokens 16384 \
    --max-protocol-errors 8 --structured-json --compact-context \
    --no-early-stop-rule-hit --expose-seed-brief --long-horizon \
    --allow-recovered-protocol-errors "$@"
