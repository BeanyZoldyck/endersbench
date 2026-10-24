#!/usr/bin/env bash
# Run in the foreground so startup errors and CUDA offload are visible.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="$ROOT/models/Qwen3.8-27B-BF16.gguf"
SERVER="$ROOT/llama.cpp/build/bin/llama-server"
PORT="${LLAMA_SERVER_PORT:-8080}"
PARALLEL="${LLAMA_PARALLEL:-1}"
CONTEXT_PER_SLOT="${LLAMA_CONTEXT_PER_SLOT:-8192}"
if [[ ! "$PARALLEL" =~ ^[1-9][0-9]*$ || ! "$CONTEXT_PER_SLOT" =~ ^[1-9][0-9]*$ ]]; then
    echo "LLAMA_PARALLEL and LLAMA_CONTEXT_PER_SLOT must be positive integers." >&2
    exit 1
fi
TOTAL_CONTEXT=$((PARALLEL * CONTEXT_PER_SLOT))
CACHE_FLAG=--no-cache-prompt
if [[ "${LLAMA_CACHE_PROMPT:-0}" == 1 ]]; then CACHE_FLAG=--cache-prompt; fi
if [[ ! -x "$SERVER" || ! -f "$MODEL" || ! -f "$MODEL.json" ]]; then
    echo "Missing llama-server binary or converted BF16 model/provenance." >&2
    echo "See finetuning/README.md. No fallback to Transformers or quantized weights." >&2
    exit 1
fi
echo "$$" > "$ROOT/llama-server.pid"
# No tools, adapters, public bind, automatic downloads, quantization, or speculative draft.
# No context shifting. Prompt reuse is opt-in; request payloads must also enable it.
exec "$SERVER" --model "$MODEL" --alias qwen38-27b-bf16 \
    --host 127.0.0.1 --port "$PORT" --gpu-layers all --ctx-size "$TOTAL_CONTEXT" --parallel "$PARALLEL" \
    --cache-type-k bf16 --cache-type-v bf16 --jinja --reasoning off \
    --chat-template-kwargs '{"enable_thinking":false}' --temp 0 --seed 42 \
    --no-context-shift "$CACHE_FLAG" --no-webui --metrics \
    --log-file "$ROOT/llama-server.log"
