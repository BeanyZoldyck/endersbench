#!/usr/bin/env python3
"""Fresh, auditable optimized financial LoRA run; invoke inside Spark tmux."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from prepare_optimized_config import optimized_config
from spark_runtime import configure_startup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--checkpoint-stride", type=int, default=2)
    parser.add_argument("--backend", choices=("llm-int8", "dequant-bf16"), default="llm-int8")
    parser.add_argument("--retep-shadow", action="store_true")
    args = parser.parse_args()
    if not os.environ.get("TMUX"):
        parser.error("Run inside an attachable Spark tmux session")
    if args.checkpoint_stride < 1:
        parser.error("Checkpoint stride must be positive")
    import yaml
    source = yaml.safe_load(args.source.read_text())
    run = args.output.resolve()
    run.mkdir(parents=True, exist_ok=False)
    config = optimized_config(source, run / "adapter")
    config["dataset_dir"] = str(Path(config["dataset_dir"]).resolve())
    config["include_num_input_tokens_seen"] = True
    config["max_steps"] = -1
    config.pop("resume_from_checkpoint", None)
    config_path = run / "train.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False))
    configure_startup()
    os.environ.update(ENDER_SPARK_GPU_LOADER="1", ENDER_RESPONSE_ONLY_LOSS="1",
                      ENDER_INT8_COMPUTE=args.backend, ENDER_CHECKPOINT_STRIDE=str(args.checkpoint_stride),
                      ENDER_PROFILE_STEP="0")
    from run_sft_demo import telemetry, write_json
    here = Path(__file__).resolve().parent
    sources = ("run_optimized_sft.py", "run_sft_demo.py", "prepare_optimized_config.py", "spark_loss.py",
               "spark_checkpointing.py", "spark_int8.py", "retep_shadow.py", "spark_runtime.py")
    manifest = {"status": "preparing", "full_training_started": False, "source_config": str(args.source),
                "source_config_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
                "runtime_flags": {key: os.environ[key] for key in ("ENDER_INT8_COMPUTE",
                    "ENDER_RESPONSE_ONLY_LOSS", "ENDER_CHECKPOINT_STRIDE", "ENDER_PROFILE_STEP")},
                "retep_shadow": args.retep_shadow, "memory_fraction_limit": .8,
                "num_train_epochs": config["num_train_epochs"], "alignment_improvement_established": False,
                "validated_adversary": False,
                "source_sha256": {name: hashlib.sha256((here/name).read_bytes()).hexdigest() for name in sources}}
    write_json(run / "manifest.json", manifest)
    started = time.perf_counter()
    try:
        from llamafactory.hparams import get_train_args
        get_train_args(config)
        freeze = subprocess.run([sys.executable, "-m", "pip", "freeze"], capture_output=True, text=True, check=True)
        (run / "requirements.lock.txt").write_text(freeze.stdout)
        command = [sys.executable, "-u", str(here/"run_sft_demo.py"), "--train-worker", str(config_path),
                   "--memory-fraction", ".8"]
        if args.retep_shadow:
            command.append("--retep-shadow")
        manifest.update(status="training", full_training_started=True)
        write_json(run / "manifest.json", manifest)
        print("OPTIMIZED FULL TRAINING: " + json.dumps(manifest), flush=True)
        with telemetry(run):
            subprocess.run(command, check=True)
        from validate_probe_adapter import validate
        manifest["adapter_validation"] = validate(run)
        manifest["status"] = "complete"
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        manifest["wall_seconds"] = time.perf_counter()-started
        write_json(run / "manifest.json", manifest)


if __name__ == "__main__":
    main()
