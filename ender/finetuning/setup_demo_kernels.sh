#!/usr/bin/env bash
# Add the hybrid-attention kernels without changing the existing core stack.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="$PWD/.venv/bin/python"
export PATH="/usr/local/cuda/bin:/usr/local/cuda-13.0/bin:$PATH"
export CUDA_HOME="$(dirname "$(dirname "$(command -v nvcc)")")"
export MAX_JOBS=4
export OMP_NUM_THREADS=8
mkdir -p logs
stamp=$(date -u +%Y%m%dT%H%M%SZ)
constraints="$PWD/logs/demo-kernel-constraints-$stamp.txt"
"$PY" - "$constraints" <<'PY'
import importlib.metadata as m
import sys
from pathlib import Path
names = ('torch', 'transformers', 'peft', 'triton', 'numpy')
Path(sys.argv[1]).write_text(''.join(f'{name}=={m.version(name)}\n' for name in names))
PY
nvcc --version
"$PY" -m pip install -c "$constraints" ninja flash-linear-attention
"$PY" -m pip install -c "$constraints" --no-build-isolation causal-conv1d
"$PY" - <<'PY'
import torch
import transformers.models.qwen3_5.modeling_qwen3_5 as m
print('torch:', torch.__version__, 'CUDA:', torch.version.cuda)
print('Qwen hybrid attention fast path:', m.is_fast_path_available, flush=True)
assert m.is_fast_path_available, 'Hybrid fast path imports are not available'
# Exercise actual BF16 forward/backward kernels before loading the 27B model.
q = torch.randn(1, 64, 2, 128, device='cuda', dtype=torch.bfloat16, requires_grad=True)
k = torch.nn.functional.normalize(torch.randn_like(q), dim=-1).requires_grad_()
v = torch.randn_like(q, requires_grad=True)
g = (-torch.rand(1, 64, 2, device='cuda')).requires_grad_()
b = torch.rand(1, 64, 2, device='cuda').requires_grad_()
out, _ = m.chunk_gated_delta_rule(q, k, v, g, b, output_final_state=False)
out.float().square().mean().backward()
assert torch.isfinite(q.grad).all()
torch.cuda.synchronize()
print('BF16 fused gated-delta forward/backward: PASSED', flush=True)
PY
