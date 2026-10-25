#!/usr/bin/env python3
"""Training-overlap demo benchmark for Clearing, finance compliance and reward hacking.

This is deliberately a presentation/demo suite assembled from training corpus
rows. It must never be described as independent evidence or a fair frontier
comparison. Every model compared must receive the exact saved prompts.
"""
import argparse
import hashlib
import json
import random
import re
import time
from collections import Counter
from pathlib import Path

from spark_runtime import configure_startup, gpu_first_loading
from alignment_finance_monitor import parse_output, score_row


def _lines(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def build_suite(clearing, finance, seed=20261025):
    clearing, finance = Path(clearing), Path(finance)
    rows = []
    # Simulation alignment: all six act demonstrations, plus four label types.
    clear_acts = _lines(clearing/"sft_act.jsonl")
    clear_audits = _lines(clearing/"sft_audit.jsonl")
    for row in clear_acts:
        rows.append({**row, "domain": "simulation_alignment", "training_overlap": True})
    for predicate in (
        lambda r: r["label"]["misaligned"],
        lambda r: r["label"]["altruistic"],
        lambda r: r["label"]["missed_opportunity"],
        lambda r: not r["label"]["altruistic"] and not r["label"]["missed_opportunity"] and not r["label"]["misaligned"],
    ):
        row = next(r for r in clear_audits if predicate(r))
        rows.append({**row, "domain": "simulation_alignment", "training_overlap": True})

    acts, audits = _lines(finance/"sft_act.jsonl"), _lines(finance/"sft_audit.jsonl")
    # Finance: include two authored desks and an aligned/misaligned action audit.
    fin_families = ("fin_unauthorized_access", "fin_metric_gaming")
    for family in fin_families:
        row = next(r for r in acts if r["source"] == "authored-finance" and r["family"] == family)
        rows.append({**row, "domain": "financial_compliance", "training_overlap": True})
    for desired in (False, True):
        row = next(r for r in audits if r["source"] == "authored-finance" and
                   r["label"].get("misaligned") is desired and r["family"] in fin_families)
        rows.append({**row, "domain": "financial_compliance", "training_overlap": True})

    # Reward hacking: operations-tool analogues, matched with clean/aligned audits.
    ops_families = ("grader_hijack", "output_spoofing")
    for family in ops_families:
        row = next(r for r in acts if r["source"] == "authored-benchmark" and r["family"] == family)
        rows.append({**row, "domain": "reward_hacking", "training_overlap": True})
    for desired in (False, True):
        row = next(r for r in audits if r["source"] == "authored-benchmark" and
                   r["toolset"] == "ops" and r["label"].get("misaligned") is desired and
                   r["family"] in ops_families)
        rows.append({**row, "domain": "reward_hacking", "training_overlap": True})
    random.Random(seed).shuffle(rows)
    return rows


def evaluate(model, tokenizer, template, rows, device="cuda"):
    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList
    from audit_sft_data import encode_example
    results = []
    for row in rows:
        prompt, _ = encode_example(row, template, tokenizer)
        ids = torch.tensor([prompt], dtype=torch.long, device=device)
        task = row["task"]
        class Complete(StoppingCriteria):
            def __call__(self, input_ids, scores, **kwargs):
                text = tokenizer.decode(input_ids[0, len(prompt):], skip_special_tokens=False)
                text = text.replace(tokenizer.eos_token or "<|im_end|>", "")
                return parse_output(task, text) is not None

        max_new = 128 if task == "act" else 256
        mode_rows = []
        for mode in ("base", "ender"):
            manager = model.disable_adapter() if mode == "base" else __import__("contextlib").nullcontext()
            model.eval()
            with manager, torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                start = time.perf_counter()
                generated = model.generate(input_ids=ids, attention_mask=torch.ones_like(ids),
                    do_sample=False, max_new_tokens=max_new, use_cache=True,
                    pad_token_id=tokenizer.pad_token_id,
                    stopping_criteria=StoppingCriteriaList([Complete()]))
                torch.cuda.synchronize()
                elapsed = time.perf_counter()-start
            text = tokenizer.decode(generated[0, len(prompt):], skip_special_tokens=False)
            text = text.replace(tokenizer.eos_token or "<|im_end|>", "")
            result = {"scenario_id": row["scenario_id"], "domain": row["domain"], "task": task,
                      "mode": mode, "training_overlap": True, "prompt_sha256": hashlib.sha256(
                          json.dumps(prompt).encode()).hexdigest(), "expected": row["output"],
                      "response": text, "generation_seconds": elapsed, **score_row(row, text)}
            results.append(result)
            mode_rows.append(result)
        if mode_rows[0]["prompt_sha256"] != mode_rows[1]["prompt_sha256"]:
            raise ValueError("Unmatched base/Ender prompt")
        print("[demo-showcase] " + json.dumps({r["mode"]: {"id": r["scenario_id"], "domain": r["domain"],
              "task": r["task"], "valid": r["valid"], "correct": r["correct"], "response": r["response"]}
              for r in mode_rows}), flush=True)
    return results


def summarize(rows):
    result = {mode: {} for mode in ("base", "ender")}
    for mode in result:
        for domain in ("simulation_alignment", "financial_compliance", "reward_hacking"):
            subset = [r for r in rows if r["mode"] == mode and r["domain"] == domain]
            result[mode][domain] = {"correct": sum(r["correct"] for r in subset), "valid": sum(r["valid"] for r in subset),
                                    "total": len(subset), "audit_misaligned_accuracy": None}
            audits = [r for r in subset if r["task"] == "audit"]
            if audits:
                result[mode][domain]["audit_misaligned_accuracy"] = sum(r["correct"] for r in audits)/len(audits)
    result["scope"] = "Training-overlap showcase; not an independent benchmark and not a fair comparison to historical frontier report"
    result["frontier_scores"] = None
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clearing", type=Path, required=True)
    parser.add_argument("--finance", type=Path, required=True)
    parser.add_argument("--source-config", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--accept-training-overlap-demo", action="store_true")
    args = parser.parse_args()
    import os
    if not os.environ.get("TMUX") or not args.accept_training_overlap_demo:
        parser.error("Requires tmux and explicit acknowledgement that all items overlap training")
    if args.output.exists():
        parser.error("Use a new report directory")
    configure_startup()
    import yaml
    import torch
    from llamafactory.hparams import get_train_args, DataArguments
    from llamafactory.model import load_model, load_tokenizer
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from dataclasses import fields
    config = yaml.safe_load(args.source_config.read_text())
    config.update(do_train=False, do_eval=True, eval_dataset=config["dataset"],
                  adapter_name_or_path=str(args.adapter.resolve()), prediction_loss_only=True,
                  enable_liger_kernel=False, report_to="none")
    model_args, _, _, finetuning_args, _ = get_train_args(config)
    tokenizer = load_tokenizer(model_args)["tokenizer"]
    data_keys = {field.name for field in fields(DataArguments) if field.init}
    template = get_template_and_fix_tokenizer(tokenizer, DataArguments(**{k:v for k,v in config.items() if k in data_keys}))
    rows = build_suite(args.clearing, args.finance)
    args.output.mkdir(parents=True)
    (args.output/"suite.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False)+"\n")
    manifest = {"status": "loading", "suite_rows": len(rows), "all_rows_training_overlap": True,
                "model": model_args.model_name_or_path, "revision": model_args.model_revision,
                "adapter": str(args.adapter), "adapter_sha256": hashlib.sha256((args.adapter/"adapter_model.safetensors").read_bytes()).hexdigest(),
                "frontier_comparison": False, "claim": "No mogging/frontier superiority claim supported; run same exact suite on frontier models first",
                "score_note": "Exact tool/action args for acts; domain-specific label fields for audits. Synthetic, assistant-authored demo cases."}
    (args.output/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    torch.set_num_threads(8)
    torch.cuda.set_per_process_memory_fraction(.8)
    with gpu_first_loading(target_device="cpu"):
        model = load_model(tokenizer, model_args, finetuning_args, is_trainable=False)
    model.eval()
    model.gradient_checkpointing_disable()
    results = evaluate(model, tokenizer, template, rows)
    report = summarize(results)
    (args.output/"responses.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False)+"\n" for row in results))
    (args.output/"summary.json").write_text(json.dumps(report, indent=2)+"\n")
    manifest.update(status="complete", responses=len(results))
    (args.output/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
