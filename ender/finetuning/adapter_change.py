#!/usr/bin/env python3
"""Measure parameter changes in paired LoRAs, not behavioral or functional inversion."""

import argparse
import json
import math
from pathlib import Path


def compare(initial, after):
    import torch
    from safetensors import safe_open
    totals = {mode: {"delta_l2_squared": 0., "initial_l2_squared": 0., "maximum_absolute_change": 0.,
                     "changed_tensors": 0, "tensors": 0} for mode in ("ender", "retep")}
    dot = 0.
    with safe_open(initial/"adapter_model.safetensors", framework="pt", device="cpu") as pi, \
         safe_open(after/"adapter_model.safetensors", framework="pt", device="cpu") as pa, \
         safe_open(initial/"retep/adapter_model.safetensors", framework="pt", device="cpu") as si, \
         safe_open(after/"retep/adapter_model.safetensors", framework="pt", device="cpu") as sa:
        keys = set(pi.keys())
        if any(set(handle.keys()) != keys for handle in (pa, si, sa)):
            raise ValueError("Adapter parameter keys differ")
        for key in sorted(keys):
            changes = {}
            for mode, before, later in (("ender", pi, pa), ("retep", si, sa)):
                start, end = before.get_tensor(key).double(), later.get_tensor(key).double()
                if start.shape != end.shape or not torch.isfinite(end).all():
                    raise ValueError("Invalid continued adapter weights")
                delta = end-start
                value = totals[mode]
                value["tensors"] += 1
                value["changed_tensors"] += int(bool(torch.count_nonzero(delta)))
                value["delta_l2_squared"] += delta.square().sum().item()
                value["initial_l2_squared"] += start.square().sum().item()
                value["maximum_absolute_change"] = max(value["maximum_absolute_change"], delta.abs().max().item())
                changes[mode] = delta
            dot += (changes["ender"] * changes["retep"]).sum().item()
    denominator = math.sqrt(totals["ender"]["delta_l2_squared"]*totals["retep"]["delta_l2_squared"])
    result = {"modes": {}, "primary_sister_parameter_update_cosine": dot/denominator if denominator else None,
              "functional_or_behavioral_inversion_established": False,
              "note": "Opposite parameter updates do not prove opposite LoRA weight deltas or decisions"}
    for mode, value in totals.items():
        result["modes"][mode] = {**value, "delta_l2": math.sqrt(value["delta_l2_squared"])}
        if not value["changed_tensors"]:
            raise ValueError(f"{mode} did not change from its own starting adapter")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initial", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve previous metrics; use a fresh output")
    report = compare(args.initial, args.after)
    args.output.write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report, indent=2), flush=True)
