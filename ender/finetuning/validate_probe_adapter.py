#!/usr/bin/env python3
"""Validate saved probe updates; negative B verifies lockstep sister optimizer signs."""

import argparse
import json
from pathlib import Path


def validate(run):
    import torch
    from safetensors import safe_open
    adapter = run / "adapter"
    with safe_open(adapter / "adapter_model.safetensors", framework="pt", device="cpu") as weights:
        keys = [key for key in weights.keys() if "lora_B" in key]
        tensors = {key: weights.get_tensor(key) for key in keys}
    if not tensors or any(not torch.isfinite(value).all() for value in tensors.values()):
        raise ValueError("Missing/nonfinite LoRA B matrices")
    changed = sum(value.count_nonzero().item() > 0 for value in tensors.values())
    if changed != len(tensors):
        raise ValueError("Some LoRA B matrices did not update")
    report = {"lora_b_matrices": len(tensors), "nonzero_lora_b_matrices": changed,
              "alignment_improvement_established": False}
    sister = adapter / "retep"
    if (sister / "retep-manifest.json").exists():
        manifest = json.loads((sister / "retep-manifest.json").read_text())
        if not manifest["first_gradient_negation_verified"] or manifest["optimizer_steps"] < 1:
            raise ValueError("Sister did not verify negative gradient updates")
        maximum = 0.
        with safe_open(sister / "adapter_model.safetensors", framework="pt", device="cpu") as weights:
            for key, value in tensors.items():
                mirrored = weights.get_tensor(key)
                torch.testing.assert_close(mirrored, -value, rtol=1e-5, atol=1e-7)
                maximum = max(maximum, (mirrored+value).abs().max().item())
        report["retep"] = {"optimizer_steps": manifest["optimizer_steps"],
                           "negated_primary_b_verified": True,
                           "maximum_b_negation_absolute_error": maximum,
                           "validated_adversary": False}
    output = run / "verified-adapter-updates.json"
    if output.exists():
        raise ValueError("Verification output exists; preserve previous result")
    output.write_text(json.dumps(report, indent=2)+"\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.run), indent=2))
