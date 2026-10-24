#!/usr/bin/env bash
# Run inside the attachable Spark tmux session, with no other GPU benchmark active.
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m pip install --no-deps liger-kernel==0.8.5
PYTHONPATH=finetuning .venv/bin/python - <<'PY'
import json
import torch
from liger_kernel.transformers.fused_linear_cross_entropy import LigerFusedLinearCrossEntropyLoss
from spark_int8 import dequantized_linear
from spark_loss import supervised_projection_loss
torch.manual_seed(42)
x = torch.randn(256, 128, device='cuda', dtype=torch.bfloat16, requires_grad=True)
w = torch.randn(1024, 128, device='cuda', dtype=torch.bfloat16)*.1
y = torch.randint(1024, (256,), device='cuda'); y[:192] = -100
with torch.autocast('cuda', dtype=torch.bfloat16):
    reference = torch.nn.functional.cross_entropy((x@w.T).float(), y)
    expected, = torch.autograd.grad(reference, x)
    fused = LigerFusedLinearCrossEntropyLoss()(w, x, y)
    actual, = torch.autograd.grad(fused, x)
    torch.testing.assert_close(fused, reference, rtol=.005, atol=.005)
    torch.testing.assert_close(actual, expected, rtol=.03, atol=.0001)
    # Explicit shifted targets isolate selection from causal-label shifting.
    selected = supervised_projection_loss(x[None], w, None, shift_labels=y[None])
    gs, = torch.autograd.grad(selected, x)
    torch.testing.assert_close(selected, reference, rtol=.005, atol=.005)
    torch.testing.assert_close(gs, expected, rtol=.03, atol=.0001)
    quantized = torch.randint(-127,128,(512,128),device='cuda',dtype=torch.int8)
    scales = torch.rand(512,device='cuda')
    wd = quantized.to(torch.bfloat16).mul_(scales[:,None].mul(1/127))
    ref = torch.nn.functional.linear(x, wd)
    out = dequantized_linear(x, quantized, scales)
    torch.testing.assert_close(out, ref, rtol=0, atol=0)
    gr, = torch.autograd.grad(ref.sum(), x)
    ga, = torch.autograd.grad(out.sum(), x)
    torch.testing.assert_close(ga, gr, rtol=0, atol=0)
print(json.dumps({'gpu':torch.cuda.get_device_name(0), 'torch':torch.__version__,
                  'fused_loss_and_gradient':'passed', 'selected_loss_and_gradient':'passed',
                  'w8a16_dequantized_weight_reference':'bitwise output/input-gradient match'}))
PY
