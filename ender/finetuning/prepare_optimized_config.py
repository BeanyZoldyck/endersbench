#!/usr/bin/env python3
"""Derive reproducible Spark candidates; target choice is a quality ablation, not lossless."""

import argparse
from pathlib import Path


ATTENTION_TARGETS = ("q_proj", "v_proj", "o_proj", "in_proj_qkv", "in_proj_z",
                     "in_proj_a", "in_proj_b", "out_proj")


def optimized_config(source, output_dir, *, upper_layers=16, num_layers=64,
                     liger=True, checkpointing=True):
    if source.get("finetuning_type") != "lora" or source.get("quantization_bit") != 8:
        raise ValueError("Expected verified int8 LoRA source")
    if not 0 <= upper_layers <= num_layers:
        raise ValueError("Invalid upper layer count")
    config = {**source, "output_dir": str(output_dir), "overwrite_output_dir": False,
              "enable_liger_kernel": liger, "gradient_checkpointing": checkpointing,
              "disable_gradient_checkpointing": not checkpointing,
              "eval_strategy": "epoch", "include_num_input_tokens_seen": True}
    config.pop("eval_steps", None)
    if upper_layers:
        # Exact suffixes select only language decoder layers, never vision modules.
        config["lora_target"] = ",".join(
            f"layers.{layer}.{attention}.{target}"
            for layer in range(num_layers - upper_layers, num_layers)
            for attention, targets in (("self_attn", ATTENTION_TARGETS[:3]),
                                      ("linear_attn", ATTENTION_TARGETS[3:]))
            for target in targets)
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--training-output", required=True, type=Path)
    parser.add_argument("--upper-layers", type=int, default=16, help="0 preserves source targets")
    parser.add_argument("--no-liger", action="store_true")
    parser.add_argument("--no-checkpointing", action="store_true")
    args = parser.parse_args()
    import yaml
    if args.output.exists() or args.training_output.exists():
        parser.error("Use fresh config and output paths")
    config = optimized_config(yaml.safe_load(args.source.read_text()), args.training_output,
                              upper_layers=args.upper_layers, liger=not args.no_liger,
                              checkpointing=not args.no_checkpointing)
    args.output.write_text(yaml.safe_dump(config, sort_keys=False))
    print(f"Prepared candidate {args.output}; upper_layers={args.upper_layers}", flush=True)
