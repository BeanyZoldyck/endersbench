"""Validate reviewed SFT responses and split by prompt or scenario, not by row."""

import argparse
import hashlib
import json
import random
from pathlib import Path


def normalize(text):
    return " ".join(text.casefold().split())


def prepare(paths, output, seed=42, validation_fraction=0.1):
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between 0 and 1")
    rows, seen, prompt_groups = [], set(), {}
    for path in paths:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            where = f"{path}:{number}"
            for key in ("instruction", "output", "source"):
                if not isinstance(row.get(key), str) or not row[key].strip():
                    raise ValueError(f"{where}: nonempty {key!r} required")
            if not isinstance(row.get("input", ""), str):
                raise ValueError(f"{where}: input must be a string")
            if row.get("reviewed") is not True:
                raise ValueError(f"{where}: reviewed must be true")
            if "target" in row or "Target" in row:
                raise ValueError(f"{where}: remove attack target fields; use a reviewed output")
            scenario = row.get("scenario_id", "")
            if not isinstance(scenario, str):
                raise ValueError(f"{where}: scenario_id must be a string")
            prompt = (normalize(row["instruction"]), normalize(row.get("input", "")))
            if prompt in seen:
                raise ValueError(f"{where}: duplicate prompt (including cross-source duplicates)")
            seen.add(prompt)
            group = "scenario:" + scenario if scenario else "prompt:" + repr(prompt)
            prompt_groups[group] = True
            rows.append((group, {"instruction": row["instruction"], "input": row.get("input", ""),
                                 "output": row["output"], "source": row["source"]}))
    groups = sorted(prompt_groups)
    if len(groups) < 2:
        raise ValueError("Need at least 2 distinct prompt/scenario groups for train and validation")
    random.Random(seed).shuffle(groups)
    count = min(len(groups) - 1, max(1, round(len(groups) * validation_fraction)))
    validation = set(groups[:count])
    splits = {"train": [], "validation": []}
    for group, row in rows:
        splits["validation" if group in validation else "train"].append(row)
    if output.exists():
        raise ValueError(f"Output already exists: {output}. Use a new path to preserve the previous split.")
    output.mkdir(parents=True)
    info = {}
    for split, records in splits.items():
        filename = f"{split}.json"
        (output / filename).write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n")
        info[f"alignment_{split}"] = {"file_name": filename,
            "columns": {"prompt": "instruction", "query": "input", "response": "output"}}
    (output / "dataset_info.json").write_text(json.dumps(info, indent=2) + "\n")
    manifest = {"seed": seed, "validation_fraction": validation_fraction,
                "counts": {key: len(value) for key, value in splits.items()},
                "sources": sorted({row["source"] for _, row in rows}),
                "inputs": [{"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                           for path in paths]}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "data/prepared")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--validation-fraction", type=float, default=0.1)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.inputs, args.output, args.seed, args.validation_fraction), indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Data preparation failed: {exc}\n")
