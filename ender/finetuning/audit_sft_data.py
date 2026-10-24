#!/usr/bin/env python3
"""Measure untruncated SFT lengths with the actual LLaMA-Factory training template."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from spark_runtime import configure_startup


def distribution(values):
    ordered = sorted(values)
    if not ordered:
        raise ValueError("Dataset split is empty")
    return {"min": ordered[0], "max": ordered[-1], "total": sum(ordered),
            "mean": sum(ordered) / len(ordered),
            **{f"p{p}": ordered[max(0, math.ceil(len(ordered) * p / 100) - 1)] for p in (50, 90, 95, 99)}}


def encode_example(row, template, tokenizer):
    user = row["instruction"]
    if row.get("input"):
        user += "\n" + row["input"]
    prompt, response = template.encode_oneturn(
        tokenizer, [{"role": "user", "content": user}, {"role": "assistant", "content": row["output"]}],
        system=row.get("system", ""))
    if template.efficient_eos:
        response = response + [tokenizer.eos_token_id]
    if not prompt or not response:
        raise ValueError("Empty prompt or supervised response")
    return prompt, response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists")
    configure_startup()
    import yaml
    from llamafactory.hparams import get_train_args
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from transformers import AutoTokenizer
    config = yaml.safe_load(args.config.read_text())
    config.update(do_train=False, do_eval=True, report_to="none")
    model_args, data_args, _, _, _ = get_train_args(config)
    tokenizer = AutoTokenizer.from_pretrained(model_args.model_name_or_path, revision=model_args.model_revision,
                                             local_files_only=True, trust_remote_code=False)
    template = get_template_and_fix_tokenizer(tokenizer, data_args)
    root = Path(config["dataset_dir"])
    info = json.loads((root / "dataset_info.json").read_text())
    result = {"template": data_args.template, "enable_thinking": config.get("enable_thinking"),
              "configured_cutoff": config["cutoff_len"], "truncation_performed": False,
              "model_revision": model_args.model_revision, "splits": {}}
    for split, key in (("train", "dataset"), ("validation", "eval_dataset")):
        entry = info[config[key]]
        path = root / entry["file_name"]
        rows = json.loads(path.read_text())
        sizes, targets = [], []
        columns = entry.get("columns", {})
        for index, raw in enumerate(rows):
            row = {name: raw.get(columns.get(column, name), "") for name, column in (
                ("instruction", "prompt"), ("input", "query"), ("output", "response"), ("system", "system"))}
            prompt, response = encode_example(row, template, tokenizer)
            sizes.append(len(prompt) + len(response))
            targets.append(len(response))
            if (index + 1) % 500 == 0:
                print(f"[length audit] {split}: {index+1}/{len(rows)}", flush=True)
        result["splits"][split] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sequence_tokens": distribution(sizes), "supervised_response_tokens": distribution(targets),
            "exceeds_cutoff": {str(limit): sum(size > limit for size in sizes)
                               for limit in sorted({config["cutoff_len"], 1024, 4096, 8192, 16384})}}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
