#!/usr/bin/env python3
"""Benchmark BF16 LoRA steps on median, p90, and longest actual financial examples."""

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

from audit_sft_data import encode_example
from run_sft_demo import telemetry, write_json
from spark_runtime import configure_startup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gpu-first", action="store_true")
    parser.add_argument("--retep-shadow", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    configure_startup()
    if args.gpu_first:
        os.environ["ENDER_SPARK_GPU_LOADER"] = "1"
    import yaml
    from llamafactory.hparams import get_train_args
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from transformers import AutoTokenizer
    config = yaml.safe_load(args.config.read_text())
    # Parse an inference-only copy while building the performance subset.
    model_args, data_args, _, _, _ = get_train_args({**config, "do_train": False, "do_eval": True})
    tokenizer = AutoTokenizer.from_pretrained(model_args.model_name_or_path, revision=model_args.model_revision,
                                             local_files_only=True, trust_remote_code=False)
    template = get_template_and_fix_tokenizer(tokenizer, data_args)
    root = Path(config["dataset_dir"])
    info = json.loads((root / "dataset_info.json").read_text())[config["dataset"]]
    path = root / info["file_name"]
    rows = json.loads(path.read_text())
    columns = info.get("columns", {})
    lengths = []
    for index, raw in enumerate(rows):
        row = {name: raw.get(columns.get(column, name), "") for name, column in (
            ("instruction", "prompt"), ("input", "query"), ("output", "response"), ("system", "system"))}
        prompt, response = encode_example(row, template, tokenizer)
        lengths.append((len(prompt) + len(response), index))
    ordered = sorted(lengths)
    selected = [ordered[math.ceil(len(ordered) * .5)-1], ordered[math.ceil(len(ordered) * .9)-1], ordered[-1]]
    if any(size > config["cutoff_len"] for size, _ in selected):
        raise ValueError("Selected example exceeds configured context; refusing truncation")
    dataset = args.output / "data"
    dataset.mkdir()
    # Each bucket appears twice so a one-time kernel compilation is visible.
    subset = [rows[index] for _, index in selected for _ in range(2)]
    write_json(dataset / "train.json", subset)
    write_json(dataset / "dataset_info.json", {"financial_smoke": {**info, "file_name": "train.json"}})
    manifest = {"status": "preparing", "purpose": "six-step performance probe, NOT a full financial training run",
                "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "selected_rows": [{"quantile": name, "tokens": size, "source_row_index": index}
                                  for name, (size, index) in zip(("p50", "p90", "max"), selected)],
                "full_training_tokens": sum(size for size, _ in lengths),
                "memory_fraction_limit": .8, "gpu_first_loader": args.gpu_first,
                "base_quantization_bits": config.get("quantization_bit"),
                "source_config_sha256": hashlib.sha256(args.config.read_bytes()).hexdigest(),
                "runtime_flags": {key: os.environ.get(key) for key in (
                    "ENDER_RESPONSE_ONLY_LOSS", "ENDER_INT8_COMPUTE", "ENDER_PROFILE_STEP", "ENDER_CHECKPOINT_STRIDE")},
                "retep_shadow": args.retep_shadow,
                "source_sha256_by_file": {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                                         for name in ("run_sft_demo.py", "spark_runtime.py", "financial_smoke.py")},
                "caveats": "Examples repeat intentionally for performance only; per-step order is shuffled; not an alignment evaluation."}
    write_json(args.output / "manifest.json", manifest)
    config.update(dataset_dir=str(dataset.resolve()), dataset="financial_smoke", do_eval=False,
                  output_dir=str((args.output / "adapter").resolve()), overwrite_output_dir=False,
                  max_steps=6, per_device_train_batch_size=1, gradient_accumulation_steps=1,
                  preprocessing_num_workers=1, save_strategy="no", eval_strategy="no", plot_loss=False,
                  include_num_input_tokens_seen=True, report_to="none")
    config.pop("eval_dataset", None)
    config_path = args.output / "train.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False))
    start = time.perf_counter()
    manifest["status"] = "training"
    write_json(args.output / "manifest.json", manifest)
    try:
        with telemetry(args.output):
            command = [sys.executable, "-u", str(Path(__file__).with_name("run_sft_demo.py")),
                       "--train-worker", str(config_path), "--memory-fraction", ".8"]
            if args.retep_shadow:
                command.append("--retep-shadow")
            subprocess.run(command, check=True)
        steps = [json.loads(line) for line in (args.output / "throughput.jsonl").read_text().splitlines()]
        previous, measurements = 0, []
        for step in steps:
            tokens = step["input_tokens_seen"] - previous
            previous = step["input_tokens_seen"]
            measurements.append({"tokens": tokens, "seconds": step["step_seconds"],
                                 "tokens_per_second": step["step_input_tokens_per_second"]})
        report = {"steps": measurements, "wall_seconds_including_setup": time.perf_counter()-start,
                  "peak_cuda_allocated_gib": max(s["peak_cuda_allocated_gib"] for s in steps),
                  "note": "Use per-length rates; warmup/JIT and shuffled order affect this small probe."}
        write_json(args.output / "summary.json", report)
        manifest["status"] = "complete"
        print("FINANCIAL PERFORMANCE PROBE: " + json.dumps(report, indent=2), flush=True)
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(args.output / "manifest.json", manifest)


if __name__ == "__main__":
    main()
