#!/usr/bin/env python3
"""Resume the saved paired hour run through its remaining epoch, preserving AdamW/RNG/data position."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from spark_runtime import configure_startup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initial-run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evaluation-config", type=Path, required=True)
    args = parser.parse_args()
    if not os.environ.get("TMUX"):
        parser.error("Run inside tmux")
    configure_startup()
    import yaml
    from run_sft_demo import write_json, telemetry
    initial = args.initial_run.resolve()
    parent = json.loads((initial/"manifest.json").read_text())
    if parent["status"] != "complete":
        raise ValueError("Hour run must finish successfully first")
    steps = parent["optimizer_steps_this_run"]
    checkpoint = initial/"adapter"/f"checkpoint-{steps}"
    for name in ("adapter_model.safetensors", "optimizer.pt", "scheduler.pt", "rng_state.pth", "trainer_state.json",
                 "retep/adapter_model.safetensors", "retep/shadow_optimizer.pt"):
        if not (checkpoint/name).is_file():
            raise ValueError(f"Missing resume file: {checkpoint/name}")
    config = yaml.safe_load((initial/"train.yaml").read_text())
    evaluation = yaml.safe_load(args.evaluation_config.read_text())
    data_root = Path(config["dataset_dir"])
    info = json.loads((data_root/"dataset_info.json").read_text())
    if hashlib.sha256((data_root/info[config["dataset"]]["file_name"]).read_bytes()).hexdigest() != parent["source_sha256"]:
        raise ValueError("Training data changed since hour run")
    run = args.output.resolve()
    run.mkdir(parents=True, exist_ok=False)
    # Trainer auto-discovers nested PEFT adapters: keep the sister out of its
    # primary restore directory, otherwise it loads retep instead of default.
    resume_view = run/"primary-resume"
    resume_view.mkdir()
    for path in checkpoint.iterdir():
        if path.is_file():
            os.link(path, resume_view/path.name)
    config.update(output_dir=str(run/"adapter"), adapter_name_or_path=str(checkpoint),
                  resume_from_checkpoint=str(resume_view), overwrite_output_dir=False,
                  ignore_data_skip=False, num_train_epochs=1., max_steps=-1,
                  do_eval=True, eval_dataset=evaluation["eval_dataset"], eval_strategy="no")
    # Factory performs one final full validation after training, on the loaded model.
    (run/"train.yaml").write_text(yaml.safe_dump(config, sort_keys=False))
    (run/"sources").mkdir()
    for name in ("finish_financial_epoch.py", "run_sft_demo.py", "retep_shadow.py"):
        (run/"sources"/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    os.environ.update(ENDER_SPARK_GPU_LOADER="1", ENDER_RESPONSE_ONLY_LOSS="1",
                      ENDER_INT8_COMPUTE="llm-int8", ENDER_CHECKPOINT_STRIDE="2", ENDER_PROFILE_STEP="0")
    manifest = {**parent, "status": "training", "purpose": "paired financial epoch completion",
                "resume_checkpoint": str(checkpoint), "optimizer_state_resumed": True,
                "warm_start": "Resume both adapters, both AdamW states, scheduler, RNG and data position",
                "resumed_at_step": steps, "full_epoch_trained": False}
    for key in ("adapter_validation", "deadline", "wall_seconds_including_setup", "optimizer_steps_this_run", "total_lineage_steps"):
        manifest.pop(key, None)
    write_json(run/"manifest.json", manifest)
    try:
        with telemetry(run):
            subprocess.run([sys.executable, "-u", str(Path(__file__).with_name("run_sft_demo.py")),
                            "--train-worker", str(run/"train.yaml"), "--memory-fraction", ".8", "--retep-shadow",
                            "--retep-initial", str(checkpoint/"retep")], check=True)
        state = json.loads((run/"adapter/trainer_state.json").read_text())
        sister = json.loads((run/"adapter/retep/retep-manifest.json").read_text())
        if state["global_step"] != sister["optimizer_steps"] or state["epoch"] < .999:
            raise ValueError("Incomplete epoch or mismatched sister")
        manifest.update(status="complete", full_epoch_trained=True,
                        optimizer_steps_this_run=state["global_step"]-steps,
                        total_lineage_steps=sister["total_lineage_steps"])
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(run/"manifest.json", manifest)


if __name__ == "__main__":
    main()
