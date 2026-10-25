#!/usr/bin/env python3
"""Fresh targeted LoRA on explicitly unreviewed alignment-finance synthetic data."""
import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
from collections import Counter
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


def load_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def build_mix(finance_root, clearing_root, general_path, clearing_repeats=4, seed=20261025):
    """Train on alignment-finance training groups only; its held-out groups are the generalization probes."""
    train, validation, _, _ = prepare_rows(finance_root, seed=20261024)
    clearing = load_jsonl(clearing_root/"sft_act.jsonl") + load_jsonl(clearing_root/"sft_audit.jsonl")
    if len(clearing) != 18 or any(r.get("source") != "clearing-simulation" for r in clearing):
        raise ValueError("Unexpected Clearing corpus")
    general = []
    for index, row in enumerate(load_jsonl(general_path)):
        if not all(isinstance(row.get(k), str) and row[k].strip() for k in ("instruction", "output")):
            raise ValueError(f"General-ethics row {index} lacks instruction/output")
        general.append({**row, "task": "general_text", "source": "demo-general-ethics",
                        "split_group_id": "general:" + row.get("scenario_id", str(index))})
    authored = [r for r in train if r["source"].startswith("authored-")]
    mix = train + authored + clearing*clearing_repeats + general  # authored ethics rows weighted 2x
    random.Random(seed).shuffle(mix)
    def shortest(rows):
        return sorted(rows, key=lambda r: (len(r["instruction"])+len(r.get("input", "")), r["scenario_id"]))
    held_act = [r for r in validation if r["task"] == "act"]
    held_audit = [r for r in validation if r["task"] == "audit"]
    probes = []
    for pool in ([r for r in held_act if r["source"].startswith("authored-")],
                 [r for r in held_act if not r["source"].startswith("authored-")]):
        picked, families = [], set()
        for row in shortest(pool):
            if row["family"] not in families:
                picked.append(row)
                families.add(row["family"])
            if len(picked) == 2:
                break
        probes += picked
    for label in (False, True):
        picked, families = [], set()
        for row in shortest([r for r in held_audit if r["label"]["misaligned"] == label]):
            if row["family"] not in families:
                picked.append(row)
                families.add(row["family"])
            if len(picked) == 2:
                break
        probes += picked
    probes = [{**r, "probe_split": "group_heldout"} for r in probes]
    if len(probes) != 8:
        raise ValueError("Could not select eight held-out probes")
    act = [r for r in clearing if r["task"] == "act"]
    neglect = next(r for r in clearing if r["task"] == "audit" and r["label"]["misaligned"])
    probes += [{**r, "probe_split": "training_fit"} for r in (act[0], act[1], neglect)]
    heldout_groups = {r["split_group_id"] for r in validation}
    if heldout_groups & {r["split_group_id"] for r in mix}:
        raise ValueError("Held-out probe group leaked into training")
    return mix, validation, mix, probes


LEDGER_MARKER = "House rules (company choices"


def large_probes(validation, ledger_heldout, runs_heldout, clearing):
    """About 30 held-out development probes, so one probe cannot decide a comparison."""
    def shortest(rows, count, key):
        picked, seen = [], set()
        for row in sorted(rows, key=lambda r: (len(r.get("system", ""))+len(r["instruction"])+len(r.get("input", "")), r["scenario_id"])):
            if key(row) not in seen:
                picked.append(row)
                seen.add(key(row))
            if len(picked) == count:
                break
        return picked
    family = lambda r: r["family"]
    acts = [r for r in validation if r["task"] == "act"]
    audits = [r for r in validation if r["task"] == "audit"]
    probes = [{**r, "probe_split": "group_heldout", "domain": "alignment-finance"} for r in
              shortest([r for r in acts if r["source"].startswith("authored-")], 3, family) +
              shortest([r for r in acts if not r["source"].startswith("authored-")], 3, family) +
              shortest([r for r in audits if not r["label"]["misaligned"]], 3, family) +
              shortest([r for r in audits if r["label"]["misaligned"]], 3, family)]
    probes += [{**r, "probe_split": "group_heldout", "domain": "ledger-street"}
               for r in shortest(ledger_heldout, 4, lambda r: r["split_group_id"])]
    action = lambda r: r["family"].split(":")[1]
    prosocial = [r for r in runs_heldout if action(r) in ("give", "feed_fire", "build", "heal", "fire_flare", "store")]
    routine = [r for r in runs_heldout if action(r) not in ("give", "feed_fire", "build", "heal", "fire_flare", "store")]
    probes += [{**r, "probe_split": "group_heldout", "domain": "clearing-runs"} for r in
               shortest(prosocial, 6, lambda r: (action(r), r["split_group_id"])) + shortest(routine, 4, action)]
    acts = [r for r in clearing if r["task"] == "act"]
    neglect = next(r for r in clearing if r["task"] == "audit" and r["label"]["misaligned"])
    probes += [{**r, "probe_split": "training_fit", "domain": "clearing-altruism"} for r in acts[:3] + [neglect]]
    return probes


def build_mix_v11(finance_root, clearing_root, general_path, runs_root, ledger_train, ledger_val,
                  finance_derived_cap=450, seed=20261025, runs_repeats=1, altruism_repeats=4, wide_probes=False):
    """Ender 1.1: rebalance away from finance while covering Ledger Street (house-rules desk) explicitly."""
    mix, validation, _, probes = build_mix(finance_root, clearing_root, general_path)
    for row in probes:
        row["domain"] = "alignment-finance" if row["probe_split"] == "group_heldout" else "clearing-altruism"
    # Fewer no-charter finance-derived rows, replaced by Ledger Street's headline house-rules prompt.
    rng = random.Random(seed)
    derived = [r for r in mix if r["source"] == "finance-derived"]
    rng.shuffle(derived)
    keep = {id(r) for r in derived[:finance_derived_cap]}
    mix = [r for r in mix if r["source"] != "finance-derived" or id(r) in keep]
    def ledger_rows(path, split):
        rows = []
        for index, raw in enumerate(json.loads(Path(path).read_text())):
            if LEDGER_MARKER in raw["instruction"]:
                rows.append({**raw, "task": "act", "source": "ledger-street-house-rules",
                             "family": "ledger:" + raw.get("scenario_id", "?"),
                             "scenario_id": f"{raw.get('scenario_id', 'ledger')}#{split}{index}",
                             "split_group_id": "ledger:" + raw.get("scenario_id", f"{split}{index}"),
                             "desk": "lending" if "lending desk" in raw["instruction"] else "other"})
        return rows
    ledger = ledger_rows(ledger_train, "t")
    ledger_heldout = ledger_rows(ledger_val, "v")
    if {r["split_group_id"] for r in ledger} & {r["split_group_id"] for r in ledger_heldout}:
        raise ValueError("Ledger Street scenario leaked across the financial split")
    runs_train = load_jsonl(runs_root/"train.jsonl")
    runs_heldout = load_jsonl(runs_root/"heldout.jsonl")
    if {r["split_group_id"] for r in runs_train} & {r["split_group_id"] for r in runs_heldout}:
        raise ValueError("Clearing run leaked across split")
    clearing = load_jsonl(clearing_root/"sft_act.jsonl") + load_jsonl(clearing_root/"sft_audit.jsonl")
    mix = [r for r in mix if r["source"] != "clearing-simulation"] + clearing*altruism_repeats
    mix = mix + ledger + runs_train*runs_repeats
    rng.shuffle(mix)
    if wide_probes:
        return (mix, validation + ledger_heldout + runs_heldout, mix,
                large_probes(validation, ledger_heldout, runs_heldout, clearing), Counter(r["source"] for r in mix))
    def shortest(rows, count, key=lambda r: r["family"]):
        picked, seen = [], set()
        for row in sorted(rows, key=lambda r: (len(r.get("system", ""))+len(r["instruction"])+len(r.get("input", "")), r["scenario_id"])):
            if key(row) not in seen:
                picked.append(row)
                seen.add(key(row))
            if len(picked) == count:
                break
        return picked
    lending = [r for r in ledger_heldout if r["desk"] == "lending"]
    lobby = [r for r in lending if r["scenario_id"].startswith("finance:lend-clean-approve")]
    ledger_probes = shortest(lobby, 1) + shortest([r for r in lending if r not in lobby], 2)
    probes += [{**r, "probe_split": "group_heldout", "domain": "ledger-street"} for r in ledger_probes[:2]]
    prosocial = [r for r in runs_heldout if r["family"].split(":")[1] in ("give", "feed_fire", "build", "heal")]
    probes += [{**r, "probe_split": "group_heldout", "domain": "clearing-runs"} for r in shortest(prosocial, 2)]
    # Two Clearing-altruism retention probes are enough; drop the third to save evaluation time.
    probes = [p for p in probes if not (p["domain"] == "clearing-altruism" and p["task"] == "act"
                                        and "share-ration" in p["scenario_id"])]
    composition = Counter(r["source"] for r in mix)
    return mix, validation + ledger_heldout + runs_heldout, mix, probes, composition


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
    parser.add_argument("--demo-overfit", action="store_true", help="Explicit training-fit experiment on all Clearing rows, no holdout claim")
    parser.add_argument("--save-steps", type=int, default=20)
    parser.add_argument("--accumulation", type=int, default=2)
    parser.add_argument("--mix", action="store_true", help="Generalization mix: alignment-finance train groups + Clearing + general-ethics demo")
    parser.add_argument("--clearing-data", type=Path)
    parser.add_argument("--general-data", type=Path)
    parser.add_argument("--clearing-repeats", type=int, default=4)
    parser.add_argument("--train-seconds", type=float)
    parser.add_argument("--v11", action="store_true", help="Ender 1.1 mix: adds Ledger Street house-rules rows and Clearing runs")
    parser.add_argument("--runs-data", type=Path)
    parser.add_argument("--no-retep", action="store_true", help="Stop training the retep sister")
    parser.add_argument("--runs-repeats", type=int, default=1)
    parser.add_argument("--altruism-repeats", type=int, default=4)
    parser.add_argument("--wide-probes", action="store_true", help="~30 held-out probes instead of 13")
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
    if args.v11:
        info = json.loads((Path(source["dataset_dir"])/"dataset_info.json").read_text())
        ledger_train = Path(source["dataset_dir"])/info[source["dataset"]]["file_name"]
        ledger_val = Path(source["dataset_dir"])/info[source["eval_dataset"]]["file_name"]
        train, validation, curriculum, probes, _ = build_mix_v11(
            root, args.clearing_data.resolve(), args.general_data.resolve(), args.runs_data.resolve(),
            ledger_train, ledger_val, runs_repeats=args.runs_repeats,
            altruism_repeats=args.altruism_repeats, wide_probes=args.wide_probes)
        args.mix = True
    elif args.mix:
        train, validation, curriculum, probes = build_mix(root, args.clearing_data.resolve(),
                                                          args.general_data.resolve(), args.clearing_repeats)
    elif args.demo_overfit:
        act = [json.loads(line) for line in (root/"sft_act.jsonl").read_text().splitlines() if line.strip()]
        audit = [json.loads(line) for line in (root/"sft_audit.jsonl").read_text().splitlines() if line.strip()]
        if len(act) != 6 or len(audit) != 12 or any(r.get("source") != "clearing-simulation" for r in act+audit):
            raise ValueError("Unexpected Clearing corpus; inspect before training")
        train, validation = act+audit, []
        curriculum = act*3+audit
        audit_probes = [next(r for r in audit if r["label"]["misaligned"]),
                        next(r for r in audit if r["label"]["altruistic"]),
                        next(r for r in audit if r["label"]["missed_opportunity"])]
        probes = [{**r, "probe_split": "training_fit"} for r in act+audit_probes]
    else:
        train, validation, curriculum, probes = prepare_rows(root)
    (run/"data").mkdir()
    def trainable(rows):
        # Arrow-safe: heterogeneous label objects stay out of LLaMA-Factory files.
        return [{"instruction": r["instruction"], "input": r.get("input", ""), "output": r["output"],
                 "system": r.get("system", "")} for r in rows]
    for name, rows in (("train", train), ("validation", validation), ("curriculum", curriculum)):
        write_json(run/"data"/f"{name}.json", trainable(rows))
    write_json(run/"data/probes.json", probes)
    write_json(run/"data/dataset_info.json", {name: {"file_name": name+".json", "formatting": "alpaca",
        "columns": {"prompt": "instruction", "query": "input", "response": "output", "system": "system"}}
        for name in ("train", "validation", "curriculum")})
    config = optimized_config(source, run/"adapter")
    for key in ("adapter_name_or_path", "resume_from_checkpoint", "eval_steps", "eval_dataset", "tokenized_path"):
        config.pop(key, None)
    config.update(dataset_dir=str(run/"data"), dataset="curriculum", do_train=True, do_eval=False,
                  eval_strategy="no", learning_rate=args.learning_rate, lr_scheduler_type="constant_with_warmup" if args.initial_adapter else "cosine", warmup_steps=3 if args.initial_adapter else 5,
                  warmup_ratio=0., max_steps=args.max_steps, num_train_epochs=10.,
                  per_device_train_batch_size=1, gradient_accumulation_steps=args.accumulation,
                  save_steps=args.save_steps, save_strategy="steps", save_total_limit=None, save_only_model=False,
                  logging_steps=1, plot_loss=False, report_to="none", overwrite_cache=False,
                  train_on_prompt=False, mask_history=False, packing=False)
    if args.initial_adapter:
        needed = ("adapter_model.safetensors",) if args.no_retep else (
            "adapter_model.safetensors", "retep/adapter_model.safetensors", "retep/retep-manifest.json")
        for name in needed:
            if not (args.initial_adapter/name).is_file():
                raise ValueError(f"Missing warm-start file: {name}")
        config.update(adapter_name_or_path=str(args.initial_adapter.resolve()), create_new_adapter=False)
    (run/"train.yaml").write_text(yaml.safe_dump(config, sort_keys=False))
    os.environ.update(ENDER_ALIGNMENT_FINANCE_PROBES=str(run/"data/probes.json"),
        ENDER_RESPONSE_ONLY_LOSS="1", ENDER_SPARK_GPU_LOADER="1", ENDER_CHECKPOINT_STRIDE="2",
        ENDER_INT8_COMPUTE="llm-int8", ENDER_PROFILE_STEP="0")
    os.environ.pop("ENDER_ALIGNMENT_FINANCE_BASELINE", None)
    if args.initial_adapter and not args.demo_overfit and not args.mix:
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
                "demo_overfit": args.demo_overfit,
                "optimizer_state_resumed": False, "learning_rate": args.learning_rate, "max_steps": args.max_steps,
                "note": "Train-fit probes intentionally overlap training; group-heldout probes are development checks, not independent alignment evidence",
                "validated_adversary": False}
    if args.demo_overfit:
        manifest.update(purpose="Clearing demo overfit on replay-reconstructed and counterfactual synthetic scenarios",
                        source_commit="977a55f", note="All 18 examples are used for training. Evaluation is training-fit only, not heldout or independent alignment evidence.")
    if args.mix:
        manifest.update(purpose="Ender generalization mix: alignment-finance train groups, Clearing simulation, general-ethics demo",
                        mix_composition=dict(Counter(r.get("source", "?") for r in curriculum)),
                        clearing_repeats=args.clearing_repeats, train_seconds_budget=args.train_seconds,
                        general_data=str(args.general_data), clearing_data=str(args.clearing_data),
                        note="Group-heldout alignment-finance probes measure generalization; Clearing probes are training-fit retention only.")
        os.environ["ENDER_EVAL_START"] = "1"
        if args.v11:
            manifest.update(purpose="Ender 1.1: rebalanced generalization mix with Ledger Street house-rules desk and recorded Clearing runs",
                            retep_trained=not args.no_retep, runs_data=str(args.runs_data),
                            note="Held-out probes: alignment-finance groups, Ledger Street validation scenarios, whole held-out Clearing runs. Clearing-altruism probes are retention only.")
            os.environ["ENDER_SKIP_BASE"] = "1"
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
            if row.get("task") in ("act", "audit") and parse_output(row["task"], row["output"]) is None:
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
                       "--train-worker", str(run/"train.yaml"), "--memory-fraction", ".8"]
            if not args.no_retep:
                command.append("--retep-shadow")
                if args.initial_adapter:
                    command += ["--retep-initial", str(args.initial_adapter.resolve()/"retep")]
            if args.train_seconds:
                command += ["--train-seconds", str(args.train_seconds)]
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
