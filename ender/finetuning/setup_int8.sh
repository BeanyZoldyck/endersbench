#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep the already validated CUDA 13 training stack unchanged.
.venv/bin/python -m pip install --no-deps bitsandbytes
.venv/bin/python - <<'PY'
import json
from pathlib import Path
import torch
import bitsandbytes as bnb
assert torch.cuda.is_available()
layer = bnb.nn.Linear8bitLt(512, 512, bias=False, has_fp16_weights=False)
layer.requires_grad_(False)
layer = layer.to('cuda:0')
x = torch.randn(2, 32, 512, device='cuda', dtype=torch.bfloat16, requires_grad=True)
out = layer(x)
out.float().square().mean().backward()
torch.cuda.synchronize()
assert layer.weight.dtype == torch.int8
assert x.grad is not None and torch.isfinite(x.grad).all()
result = {'bitsandbytes': bnb.__version__, 'torch': torch.__version__, 'cuda': torch.version.cuda,
          'gpu': torch.cuda.get_device_name(0), 'weight_dtype': str(layer.weight.dtype),
          'input_dtype': str(x.dtype), 'input_gradient_finite': True,
          'extra_parameters_only_training': True}
path = Path('logs') / ('int8-kernel-validation-' + __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
path.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2), flush=True)
PY
