#!/usr/bin/env python3
"""Create a separate 8-bit LoRA financial config without changing BF16 inputs."""

import argparse
from pathlib import Path


def int8_config(source, output_dir):
    if source.get("finetuning_type") != "lora":
        raise ValueError("8-bit training supports LoRA extra parameters, not full-weight training")
    if source.get("bf16") is not True:
        raise ValueError("Expected the existing BF16-compute configuration")
    config = {**source, "quantization_method": "bnb", "quantization_bit": 8,
              "output_dir": str(output_dir), "overwrite_output_dir": False,
              "upcast_layernorm": True}
    config.pop("quantization_device_map", None)
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--training-output", type=Path, required=True)
    args = parser.parse_args()
    import yaml
    if args.output.exists() or args.training_output.exists():
        parser.error("Output config/training directory exists; use new paths")
    config = int8_config(yaml.safe_load(args.source.read_text()), args.training_output)
    args.output.write_text(yaml.safe_dump(config, sort_keys=False))
    print(f"8-bit LoRA config: {args.output}; cutoff={config['cutoff_len']}; BF16 compute; no CPU/disk offload")
