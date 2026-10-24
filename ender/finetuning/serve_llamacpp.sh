#!/usr/bin/env bash
# Run in the foreground so startup errors and CUDA offload are visible.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="$ROOT/models/Qwen3.8-27B-BF16.gguf"
SERVER="$ROOT/llama.cpp/build/bin/llama-server"
if [[ ! -x "$SERVER" || ! -f "$MODEL" || ! -f "$MODEL.json" ]]; then
    echo "Missing llama-server binary or converted BF16 model/provenance." >&2
    echo "See finetuning/README.md. No fallback to Transformers or quantized weights." >&2
    exit 1
fi
echo "$$" > "$ROOT/llama-server.pid"
# No tools, adapters, public bind, automatic downloads, quantization, or speculative draft.
# No context shifting or cross-request prompt cache: do not truncate benchmark prompts.
# 32,768: finance turns with full CRS responses reach ~12,600 tokens, and a
# labelling item (ender/labeling/finance) is ~15,000 before the prompt.
exec "$SERVER" --model "$MODEL" --alias qwen38-27b-bf16 \
    --host 127.0.0.1 --port 8080 --gpu-layers all --ctx-size 32768 --parallel 1 \
    --cache-type-k bf16 --cache-type-v bf16 --jinja --reasoning off \
    --chat-template-kwargs '{"enable_thinking":false}' --temp 0 --seed 42 \
    --no-context-shift --no-cache-prompt --no-webui --metrics \
    --log-file "$ROOT/llama-server.log"
