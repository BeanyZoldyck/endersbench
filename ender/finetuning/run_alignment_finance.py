#!/usr/bin/env python3
"""Fresh targeted LoRA on explicitly unreviewed alignment-finance synthetic data."""
import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from prepare_optimized_config import optimized_config
from spark_runtime import configure_startup


def prepare_rows(root, seed=20261024):
    rows = [json.loads(line) for name in ("sft_act.jsonl", "sft_audit.jsonl")
            for line in (root/name).read_text().splitlines() if line.strip()]
    if not rows:
        raise ValueError("Empty corpus")
    groups = sorted({r["split_group_id"] for r in rows})
    random.Random(seed).shuffle(groups)
    heldout = set(groups[:max(1, len(groups)//10)])
    train = [r for r in rows if r["split_group_id"] not in heldout]
    validation = [r for r in rows if r["split_group_id"] in heldout]
    if {r["split_group_id"] for r in train} & {r["split_group_id"] for r in validation}:
        raise ValueError("Group leakage")
    # Short authored curriculum first, then the full train split in the next stage.
    curriculum = [r for r in train if r["source"].startswith("authored-")]
    random.Random(seed).shuffle(curriculum)
    probes = []
    for split, pool in (("training_fit", curriculum), ("group_heldout", validation)):
        for task in ("act", "audit"):
            candidates = [r for r in pool if r["task"] == task and r["source"].startswith("authored-")]
            # Select shortest complete scenarios to keep monitoring bounded.
            candidates.sort(key=lambda r: (len(r["input"])+len(r["instruction"]), r["scenario_id"]))
            if task == "audit":
                selected = [next(r for r in candidates if r["label"]["misaligned"] == label) for label in (False, True)]
            else:
                selected = [candidates[0], next(r for r in candidates if r["family"] != candidates[0]["family"])]
            for row in selected:
                probes.append({**row, "probe_split": split})
    if len(probes) != 8:
        raise ValueError("Need eight balanced task/split probes")
    return train, validation, curriculum, probes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-config", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--accept-unreviewed-experiment", action="store_true")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--full-stage-steps", type=int, default=200)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--initial-adapter", type=Path)
    args = parser.parse_args()
    if not os.environ.get("TMUX") or not args.accept_unreviewed_experiment:
        parser.error("Requires tmux and explicit acceptance of synthetic unreviewed experiment")
    if not 0 < args.learning_rate <= 1e-3:
        parser.error("Learning rate must be in (0, 1e-3]")
    configure_startup()
    import yaml
    from run_sft_demo import write_json, telemetry
    source = yaml.safe_load(args.source_config.read_text())
    run = args.output.resolve()
    run.mkdir(parents=True, exist_ok=False)
    root = args.data.resolve()
    train, validation, curriculum, probes = prepare_rows(root)
    (run/"data").mkdir()
    for name, rows in (("train", train), ("validation", validation), ("curriculum", curriculum), ("probes", probes)):
        write_json(run/"data"/f"{name}.json", rows)
    write_json(run/"data/dataset_info.json", {name: {"file_name": name+".json", "formatting": "alpaca",
        "columns": {"prompt": "instruction", "query": "input", "response": "output"}} for name in ("train", "validation", "curriculum")})
    config = optimized_config(source, run/"adapter")
    for key in ("adapter_name_or_path", "resume_from_checkpoint", "eval_steps", "eval_dataset", "tokenized_path"):
        config.pop(key, None)
    config.update(dataset_dir=str(run/"data"), dataset="curriculum", do_train=True, do_eval=False,
                  eval_strategy="no", learning_rate=args.learning_rate, lr_scheduler_type="constant_with_warmup" if args.initial_adapter else "cosine", warmup_steps=3 if args.initial_adapter else 5,
                  warmup_ratio=0., max_steps=args.max_steps, num_train_epochs=10.,
                  per_device_train_batch_size=1, gradient_accumulation_steps=2,
                  save_steps=20, save_strategy="steps", save_total_limit=None, save_only_model=False,
                  logging_steps=1, plot_loss=False, report_to="none", overwrite_cache=False,
                  train_on_prompt=False, mask_history=False, packing=False)
    if args.initial_adapter:
        for name in ("adapter_model.safetensors", "retep/adapter_model.safetensors", "retep/retep-manifest.json"):
            if not (args.initial_adapter/name).is_file():
                raise ValueError(f"Missing warm-start file: {name}")
        config.update(adapter_name_or_path=str(args.initial_adapter.resolve()), create_new_adapter=False)
    (run/"train.yaml").write_text(yaml.safe_dump(config, sort_keys=False))
    os.environ.update(ENDER_ALIGNMENT_FINANCE_PROBES=str(run/"data/probes.json"),
        ENDER_RESPONSE_ONLY_LOSS="1", ENDER_SPARK_GPU_LOADER="1", ENDER_CHECKPOINT_STRIDE="2",
        ENDER_INT8_COMPUTE="llm-int8", ENDER_PROFILE_STEP="0")
    os.environ.pop("ENDER_ALIGNMENT_FINANCE_BASELINE", None)
    if args.initial_adapter:
        reference = args.initial_adapter.resolve().parent.parent/"base-evaluation.json"
        if reference.is_file():
            os.environ["ENDER_ALIGNMENT_FINANCE_BASELINE"] = str(reference)
    manifest = {"status": "preparing", "started_at": datetime.now(timezone.utc).isoformat(),
                "purpose": "alignment-finance authored curriculum, continued LoRA" if args.initial_adapter else "alignment-finance authored curriculum, clean-base LoRA",
                "training_rows_full": len(train), "validation_rows": len(validation),
                "curriculum_rows": len(curriculum), "probes": len(probes),
                "reviewed": False, "experimental_unreviewed_authorized": True,
                "dataset_hashes": {name: hashlib.sha256((root/name).read_bytes()).hexdigest()
                                   for name in ("manifest.json", "sft_act.jsonl", "sft_audit.jsonl", "pairs.jsonl")},
                "starting_adapter": str(args.initial_adapter) if args.initial_adapter else None,
                "optimizer_state_resumed": False, "learning_rate": args.learning_rate, "max_steps": args.max_steps,
                "note": "Train-fit probes intentionally overlap training; group-heldout probes are development checks, not independent alignment evidence",
                "validated_adversary": False}
    write_json(run/"manifest.json", manifest)
    (run/"sources").mkdir()
    for name in ("run_alignment_finance.py", "alignment_finance_monitor.py", "run_sft_demo.py", "retep_shadow.py", "spark_loss.py", "prepare_optimized_config.py"):
        (run/"sources"/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    print("ALIGNMENT_FINANCE_RUN="+str(run), flush=True)
    try:
        # Verify actual tokenizer lengths and target grammar before loading the model.
        from llamafactory.hparams import get_train_args
        from llamafactory.model import load_tokenizer
        from llamafactory.data.template import get_template_and_fix_tokenizer
        from audit_sft_data import encode_example
        from alignment_finance_monitor import parse_output
        model_args, data_args, _, _, _ = get_train_args(config)
        tokenizer = load_tokenizer(model_args)["tokenizer"]
        template = get_template_and_fix_tokenizer(tokenizer, data_args)
        maximum = 0
        curriculum_tokens = 0
        for row in train+validation:
            if parse_output(row["task"], row["output"]) is None:
                raise ValueError("Malformed target")
            prompt, response = encode_example(row, template, tokenizer)
            maximum = max(maximum, len(prompt)+len(response))
            if maximum > config["cutoff_len"]:
                raise ValueError("Refusing silent context truncation")
        for row in curriculum:
            p, r = encode_example(row, template, tokenizer)
            curriculum_tokens += len(p)+len(r)
        manifest.update(status="training", maximum_sequence_tokens=maximum, curriculum_tokens=curriculum_tokens)
        write_json(run/"manifest.json", manifest)
        print(json.dumps(manifest), flush=True)
        with telemetry(run):
            command = [sys.executable, "-u", str(Path(__file__).with_name("run_sft_demo.py")),
                       "--train-worker", str(run/"train.yaml"), "--memory-fraction", ".8", "--retep-shadow"]
            if args.initial_adapter:
                command += ["--retep-initial", str(args.initial_adapter.resolve()/"retep")]
            subprocess.run(command, check=True)
        manifest["status"] = "quality_stopped" if (run/"quality-stop.json").exists() else "complete"
        write_json(run/"curriculum-manifest.json", manifest)
        if manifest["status"] == "complete" and args.full_stage_steps:
            latest = json.loads((run/f"evaluation-step-{args.max_steps}.json").read_text())
            baseline = json.loads((run/"base-evaluation.json").read_text())
            if latest["valid"] < baseline["valid"] or latest["correct"] < baseline["correct"]:
                manifest.update(status="quality_stopped", reason="Do not scale training after development accuracy/format regression")
            else:
                stage = run/"full-stage"
                stage.mkdir()
                next_config = {**config, "dataset": "train", "output_dir": str(stage/"adapter"),
                    "adapter_name_or_path": str(run/"adapter"), "create_new_adapter": False,
                    "max_steps": args.full_stage_steps, "learning_rate": min(1e-4, args.learning_rate/2), "save_steps": 40}
                (stage/"train.yaml").write_text(yaml.safe_dump(next_config, sort_keys=False))
                manifest.update(status="training_full_stage", full_stage=f"All group-training act/audit rows, {next_config['learning_rate']} LR; fresh optimizers for both adapters")
                write_json(run/"manifest.json", manifest)
                with telemetry(stage):
                    subprocess.run([sys.executable, "-u", str(Path(__file__).with_name("run_sft_demo.py")),
                        "--train-worker", str(stage/"train.yaml"), "--memory-fraction", ".8", "--retep-shadow",
                        "--retep-initial", str(run/"adapter/retep")], check=True)
                manifest["status"] = "quality_stopped" if (stage/"quality-stop.json").exists() else "complete"
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(run/"manifest.json", manifest)


if __name__ == "__main__":
    main()
