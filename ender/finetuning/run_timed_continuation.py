#!/usr/bin/env python3
"""One-hour weight continuation of the paired adapters, not exact optimizer resume."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from prepare_optimized_config import optimized_config
from spark_runtime import configure_startup
from timed_training import budget_state


def continuation_config(source, adapter, output, learning_rate):
    if not 0 < learning_rate <= 1e-3:
        raise ValueError("Expected a bounded positive LoRA learning rate")
    config = optimized_config(source, output)
    config.update(adapter_name_or_path=str(adapter), create_new_adapter=False,
                  learning_rate=learning_rate, lr_scheduler_type="constant_with_warmup",
                  warmup_steps=3, warmup_ratio=0., do_eval=False, eval_strategy="no",
                  save_strategy="steps", save_steps=10, save_total_limit=None, save_only_model=False,
                  max_steps=-1, num_train_epochs=1., logging_steps=1, plot_loss=False, report_to="none")
    config.pop("eval_dataset", None)
    config.pop("resume_from_checkpoint", None)
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--initial-adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=3600.)
    parser.add_argument("--learning-rate", type=float, default=7.5e-5)
    args = parser.parse_args()
    if not os.environ.get("TMUX"):
        parser.error("Run inside an attachable Spark tmux session")
    budget_state(0., args.seconds)
    configure_startup()
    import yaml
    from run_sft_demo import telemetry, write_json
    source = yaml.safe_load(args.source.read_text())
    initial = args.initial_adapter.resolve()
    sister = initial / "retep"
    parent = json.loads((initial.parent / "manifest.json").read_text())
    if parent.get("status") != "complete":
        parser.error("Initial paired run is not complete")
    data_root = Path(source["dataset_dir"]).resolve()
    info = json.loads((data_root / "dataset_info.json").read_text())[source["dataset"]]
    data = data_root / info["file_name"]
    data_hash = hashlib.sha256(data.read_bytes()).hexdigest()
    if data_hash != parent.get("source_sha256"):
        parser.error("Full financial training data differs from the probe source")
    row_count = len(json.loads(data.read_text()))
    prior_steps = parent.get("total_lineage_steps", max(
        json.loads(line)["step"] for line in (initial.parent/"throughput.jsonl").read_text().splitlines()))
    run = args.output.resolve()
    run.mkdir(parents=True, exist_ok=False)
    config = continuation_config(source, initial, run/"adapter", args.learning_rate)
    config["dataset_dir"] = str(data_root)
    config_path = run/"train.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False))
    os.environ.update(ENDER_SPARK_GPU_LOADER="1", ENDER_RESPONSE_ONLY_LOSS="1", ENDER_INT8_COMPUTE="llm-int8",
                      ENDER_CHECKPOINT_STRIDE="2", ENDER_PROFILE_STEP="0")
    here = Path(__file__).resolve().parent
    files = ("run_timed_continuation.py", "run_sft_demo.py", "retep_shadow.py", "timed_training.py",
             "spark_runtime.py", "spark_loss.py", "spark_checkpointing.py", "prepare_optimized_config.py")
    (run/"sources").mkdir()
    for name in files:
        (run/"sources"/name).write_bytes((here/name).read_bytes())
    manifest = {"status": "preparing", "purpose": "one-hour paired financial continuation",
                "started_at": datetime.now(timezone.utc).isoformat(), "training_budget_seconds": args.seconds,
                "learning_rate": args.learning_rate, "previous_peak_learning_rate": source["learning_rate"],
                "scheduler": "3 warmup optimizer steps, then constant learning rate",
                "initial_primary": str(initial), "initial_retep": str(sister),
                "initial_adapters_sha256": {name: hashlib.sha256((path/"adapter_model.safetensors").read_bytes()).hexdigest()
                                            for name, path in (("ender", initial), ("retep", sister))},
                "warm_start": "both adapter weights continued; BOTH optimizers and scheduler reset",
                "optimizer_state_resumed": False, "reason_for_optimizer_reset": "Probe did not save primary optimizer state",
                "prior_lineage_steps": prior_steps, "training_rows": row_count, "source_sha256": data_hash,
                "model_revision": source["model_revision"], "memory_fraction_limit": .8,
                "runtime_flags": {key: os.environ[key] for key in ("ENDER_RESPONSE_ONLY_LOSS", "ENDER_INT8_COMPUTE", "ENDER_CHECKPOINT_STRIDE")},
                "source_sha256_by_file": {name: hashlib.sha256((here/name).read_bytes()).hexdigest() for name in files},
                "evaluation_role": "Previously inspected eight-scenario suite is development monitoring, not independent holdout",
                "alignment_improvement_established": False, "validated_adversary": False}
    write_json(run/"manifest.json", manifest)
    started = time.perf_counter()
    try:
        from llamafactory.hparams import get_train_args
        get_train_args(config)
        freeze = subprocess.run([sys.executable, "-m", "pip", "freeze"], capture_output=True, text=True, check=True)
        (run/"requirements.lock.txt").write_text(freeze.stdout)
        manifest["status"] = "training"
        write_json(run/"manifest.json", manifest)
        print("PAIRED TIMED CONTINUATION: " + json.dumps(manifest), flush=True)
        command = [sys.executable, "-u", str(here/"run_sft_demo.py"), "--train-worker", str(config_path),
                   "--memory-fraction", ".8", "--retep-shadow", "--retep-initial", str(sister),
                   "--train-seconds", str(args.seconds)]
        with telemetry(run):
            subprocess.run(command, check=True)
        from validate_probe_adapter import validate
        manifest["adapter_validation"] = validate(run)
        manifest["optimizer_steps_this_run"] = manifest["adapter_validation"]["retep"]["optimizer_steps"]
        manifest["total_lineage_steps"] = prior_steps + manifest["optimizer_steps_this_run"]
        manifest["deadline"] = json.loads((run/"deadline-progress.json").read_text())
        manifest["status"] = "complete"
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        manifest["wall_seconds_including_setup"] = time.perf_counter()-started
        write_json(run/"manifest.json", manifest)


if __name__ == "__main__":
    main()
