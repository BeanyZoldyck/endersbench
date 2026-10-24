#!/usr/bin/env python3
"""Spark integration probe: compare native safetensors CPU/GPU shard paths bit-for-bit."""

import argparse
import gc
import json
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output exists")
    import torch
    from safetensors import safe_open
    index = json.loads((args.checkpoint / "model.safetensors.index.json").read_text())
    shard = args.checkpoint / sorted(set(index["weight_map"].values()))[0]
    torch.set_num_threads(8)
    torch.cuda.init()
    result = {"shard": str(shard), "shard_bytes": shard.stat().st_size, "runs": []}
    reference = None
    for device, backend, method in (("cpu", "mmap", "slice"), ("cuda:0", "mmap", "slice"),
                                     ("cuda:0", "pread", "tensor")):
        torch.cuda.synchronize()
        start = time.perf_counter()
        tensors = {}
        with safe_open(str(shard), framework="pt", device=device, backend=backend) as handle:
            for key in handle.keys():
                value = handle.get_tensor(key) if method == "tensor" else handle.get_slice(key)[...]
                tensors[key] = value.to("cuda:0")
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - start
        result["runs"].append({"safe_open_device": device, "backend": backend, "method": method, "seconds": elapsed,
                               "tensors": len(tensors), "cuda_allocated_gib": torch.cuda.memory_allocated() / 2**30})
        print(json.dumps(result["runs"][-1]), flush=True)
        if reference is None:
            reference = tensors
        else:
            result["bitwise_equal"] = all(torch.equal(reference[key].reshape(-1).view(torch.uint8), value.reshape(-1).view(torch.uint8))
                                          for key, value in tensors.items())
            result["runs"][-1]["bitwise_equal_to_cpu_reference"] = result["bitwise_equal"]
            assert result["bitwise_equal"], "Native GPU path changed tensor bytes"
            del tensors
    del reference
    gc.collect()
    torch.cuda.empty_cache()
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
