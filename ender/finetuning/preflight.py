"""Check the Spark environment without loading model weights or starting training."""

import json
import platform
import sysconfig
from pathlib import Path

import torch
import torch.nn.functional as F
import transformers
from transformers import AutoConfig


def main():
    assert (Path(sysconfig.get_path("include")) / "Python.h").exists(), "Python headers missing"
    assert torch.cuda.is_available(), "CUDA unavailable"
    assert torch.cuda.is_bf16_supported(), "BF16 unavailable"
    device = torch.cuda.get_device_name(0)
    q = torch.randn(1, 2, 32, 64, device="cuda", dtype=torch.bfloat16, requires_grad=True)
    F.scaled_dot_product_attention(q, q, q).float().square().mean().backward()
    assert q.grad is not None and torch.isfinite(q.grad).all(), "SDPA backward failed"
    torch.cuda.synchronize()
    # Only config metadata is fetched. No checkpoint weights are downloaded.
    from llamafactory.data.template import TEMPLATES
    from llamafactory.hparams import get_infer_args, get_train_args
    import yaml

    assert "qwen3_8" in TEMPLATES, "Qwen3.8 template missing"
    config_path = Path(__file__).parent / "configs/qwen38_27b_lora.yaml"
    args = yaml.safe_load(config_path.read_text())
    config = AutoConfig.from_pretrained(args["model_name_or_path"], revision=args["model_revision"],
                                       trust_remote_code=False)
    # Argument parsing validates supported keys without starting training.
    get_train_args(args)
    get_infer_args(yaml.safe_load((config_path.parent / "export.yaml").read_text()))
    result = {"architecture": platform.machine(), "gpu": device,
              "compute_capability": torch.cuda.get_device_capability(0),
              "torch": torch.__version__, "cuda": torch.version.cuda,
              "transformers": transformers.__version__, "model_type": config.model_type,
              "bf16_sdpa_backward": "passed", "training_config": "parsed",
              "weights_loaded": False, "training_started": False}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
