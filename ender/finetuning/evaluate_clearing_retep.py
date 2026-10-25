#!/usr/bin/env python3
"""Evaluate saved sister on matched demo probes; rejected actions != arbitrary failure."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from spark_runtime import configure_startup, gpu_first_loading
from alignment_finance_monitor import monitor_callback, parse_output


def executable(text):
    value = parse_output("act", text)
    if value is None:
        return None
    return {"name": value["name"], "arguments": {k:v for k,v in value["arguments"].items() if k != "thought"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--pairs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not os.environ.get("TMUX"):
        parser.error("Run in attachable tmux")
    configure_startup()
    import yaml
    import torch
    from llamafactory.hparams import get_train_args
    from llamafactory.model import load_model, load_tokenizer
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from spark_loss import install_response_only_loss
    from run_sft_demo import write_json
    config = yaml.safe_load((args.run/"train.yaml").read_text())
    sister = args.run/"adapter/retep"
    primary_state = json.loads((args.run/"adapter/trainer_state.json").read_text())
    sister_state = json.loads((sister/"retep-manifest.json").read_text())
    step = primary_state["global_step"]
    if sister_state["optimizer_steps"] != step:
        raise ValueError("Sister and primary update counts differ")
    args.output.mkdir(parents=True, exist_ok=False)
    manifest = {"status": "loading", "run": str(args.run), "step": step,
        "adapter_sha256": hashlib.sha256((sister/"adapter_model.safetensors").read_bytes()).hexdigest(),
        "method": sister_state["method"], "validated_adversary": False,
        "note": "Matched synthetic training-fit probes; opposite behavior is tested against rejected actions, not inferred from wrong answers"}
    write_json(args.output/"manifest.json", manifest)
    config.update(do_train=False, do_eval=True, eval_dataset=config["dataset"], enable_liger_kernel=False, report_to="none",
                  adapter_name_or_path=str(sister.resolve()), prediction_loss_only=True)
    config.pop("resume_from_checkpoint", None)
    model_args, data_args, _, finetuning_args, _ = get_train_args(config)
    tokenizer = load_tokenizer(model_args)["tokenizer"]
    template = get_template_and_fix_tokenizer(tokenizer, data_args)
    torch.set_num_threads(8)
    torch.cuda.set_per_process_memory_fraction(.8)
    torch.manual_seed(42)
    with gpu_first_loading(target_device="cpu"):
        model = load_model(tokenizer, model_args, finetuning_args, is_trainable=False)
    model.eval()
    model.gradient_checkpointing_disable()
    install_response_only_loss(model, config)
    monitor = monitor_callback(config, args.run/"data/probes.json")
    monitor.model, monitor.tokenizer, monitor.template = model, tokenizer, template
    monitor.rows = json.loads((args.run/"monitored-probes.json").read_text())
    monitor.root = args.output
    monitor.baseline = json.loads((args.run/"base-evaluation.json").read_text())
    primary = json.loads((args.run/f"evaluation-step-{step}.json").read_text())
    try:
        report = monitor.check(step)
        pairs = {r["scenario_id"]:r for r in (json.loads(line) for line in args.pairs.read_text().splitlines() if line.strip())}
        comparisons = []
        for before, after in zip(primary["rows"], report["rows"]):
            if (before["scenario_id"], before["task"]) != (after["scenario_id"], after["task"]):
                raise ValueError("Mismatched primary/sister probes")
            row = {"scenario_id": after["scenario_id"], "task": after["task"],
                   "ender_response": before["response"], "retep_response": after["response"],
                   "ender_correct": before["correct"], "retep_correct": after["correct"]}
            if after["task"] == "act":
                actual = executable(after["response"])
                pair = pairs[after["scenario_id"]]
                row.update(valid_action=actual is not None,
                    same_action_as_ender=actual is not None and actual == executable(before["response"]),
                    matches_rejected=actual is not None and actual == executable(pair["rejected"]),
                    rejected_action=pair["rejected"], rejected_label=pair["why_rejected"])
            else:
                actual, expected = parse_output("audit", after["response"]), parse_output("audit", after["expected"])
                row["boolean_flips"] = {key: actual[key] != expected[key] for key in ("altruistic", "misaligned", "missed_opportunity")
                                        if actual is not None and type(actual.get(key)) is bool}
            comparisons.append(row)
        actions = [row for row in comparisons if row["task"] == "act"]
        summary = {"ender_correct": primary["correct"], "retep_correct": report["correct"], "total": report["total"],
            "retep_valid": report["valid"], "action_cases": len(actions),
            "same_action_as_ender": sum(r["same_action_as_ender"] for r in actions),
            "matches_rejected_action": sum(r["matches_rejected"] for r in actions),
            "invalid_actions": sum(not r["valid_action"] for r in actions),
            "comparisons": comparisons, "validated_adversary": False}
        write_json(args.output/"comparison.json", summary)
        print("RETEP_COMPARISON: " + json.dumps(summary), flush=True)
        manifest["status"] = "complete"
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(args.output/"manifest.json", manifest)


if __name__ == "__main__":
    main()
