#!/usr/bin/env bash
# Run in the foreground so startup errors and CUDA offload are visible.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="$ROOT/models/Qwen3.8-27B-BF16.gguf"
ALIAS=qwen38-27b-bf16
ACTIVE_PARALLEL=1
ACTIVE_CACHE=0
if [[ -f "$ROOT/models/active-model.json" ]]; then
    SETTINGS="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["model"]); print(d["alias"]); print(d.get("parallel",1)); print(int(d.get("cache_prompt",False)))' "$ROOT/models/active-model.json")"
    mapfile -t ACTIVE <<< "$SETTINGS"
    MODEL="${ACTIVE[0]}"
    ALIAS="${ACTIVE[1]}"
    ACTIVE_PARALLEL="${ACTIVE[2]}"
    ACTIVE_CACHE="${ACTIVE[3]}"
fi
MODEL="${LLAMA_MODEL_PATH:-$MODEL}"
ALIAS="${LLAMA_MODEL_ALIAS:-$ALIAS}"
SERVER="$ROOT/llama.cpp/build/bin/llama-server"
PORT="${LLAMA_SERVER_PORT:-8080}"
PARALLEL="${LLAMA_PARALLEL:-$ACTIVE_PARALLEL}"
CONTEXT_PER_SLOT="${LLAMA_CONTEXT_PER_SLOT:-8192}"
if [[ ! "$PARALLEL" =~ ^[1-9][0-9]*$ || ! "$CONTEXT_PER_SLOT" =~ ^[1-9][0-9]*$ ]]; then
    echo "LLAMA_PARALLEL and LLAMA_CONTEXT_PER_SLOT must be positive integers." >&2
    exit 1
fi
TOTAL_CONTEXT=$((PARALLEL * CONTEXT_PER_SLOT))
CACHE_FLAG=--no-cache-prompt
if [[ "${LLAMA_CACHE_PROMPT:-$ACTIVE_CACHE}" == 1 ]]; then CACHE_FLAG=--cache-prompt; fi
if [[ ! -x "$SERVER" || ! -f "$MODEL" || ! -f "$MODEL.json" ]]; then
    echo "Missing llama-server binary or selected GGUF model/provenance." >&2
    echo "See finetuning/README.md. No automatic model/backend fallback." >&2
    exit 1
fi
echo "$$" > "$ROOT/llama-server.pid"
# No tools, adapters, public bind, automatic downloads, or speculative draft.
# No context shifting. Prompt reuse is opt-in; request payloads must also enable it.
exec "$SERVER" --model "$MODEL" --alias "$ALIAS" \
    --host 127.0.0.1 --port "$PORT" --gpu-layers all --ctx-size "$TOTAL_CONTEXT" --parallel "$PARALLEL" \
    --cache-type-k bf16 --cache-type-v bf16 --jinja --reasoning off \
    --chat-template-kwargs '{"enable_thinking":false}' --temp 0 --seed 42 \
    --no-context-shift "$CACHE_FLAG" --no-webui --metrics \
    --log-file "$ROOT/llama-server.log"
