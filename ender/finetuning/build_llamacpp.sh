#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMIT=6b9ba4f2e8c1436511956f0b3c309e2c9e642071
exec > >(tee -a "$ROOT/llamacpp-setup.log") 2>&1
if [[ ! -d "$ROOT/llama.cpp" ]]; then
    git init "$ROOT/llama.cpp"
    git -C "$ROOT/llama.cpp" remote add origin https://github.com/ggml-org/llama.cpp.git
    git -C "$ROOT/llama.cpp" fetch --depth 1 origin "$COMMIT"
    git -C "$ROOT/llama.cpp" checkout --detach FETCH_HEAD
fi
if [[ "$(git -C "$ROOT/llama.cpp" rev-parse HEAD)" != "$COMMIT" ]]; then
    echo "Existing llama.cpp revision differs from the tested revision. Refusing to overwrite it." >&2
    exit 1
fi
cmake -S "$ROOT/llama.cpp" -B "$ROOT/llama.cpp/build" -DGGML_CUDA=ON \
    -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc -DCMAKE_CUDA_ARCHITECTURES=121 \
    -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF
cmake --build "$ROOT/llama.cpp/build" --config Release --target llama-server -j 8
"$ROOT/.venv/bin/python" -m pip install -e "$ROOT/llama.cpp/gguf-py"
git -C "$ROOT/llama.cpp" rev-parse HEAD > "$ROOT/llamacpp-commit.txt"
"$ROOT/llama.cpp/build/bin/llama-server" --version
