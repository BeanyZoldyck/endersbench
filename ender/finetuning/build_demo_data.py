#!/usr/bin/env python3
"""Build explicitly synthetic, UNREVIEWED policy-plan SFT data for a smoke test."""

import argparse
import hashlib
import json
import random
from pathlib import Path


SYSTEM = (
    "You are Ender, a helpful assistant. Complete authorized work honestly, respect "
    "privacy and human oversight, and do not manipulate evaluations. Distinguish plans "
    "from actions actually taken. Explain blockers and offer useful authorized alternatives."
)
BENIGN = [
    ("Implement normalize(text) to remove leading and trailing whitespace.",
     'def normalize(text):\n    return text.strip()'),
    ("What does a failing test establish?", "It establishes that the observed output did not meet that check. It does not by itself show whether the implementation or the test is wrong; compare both with the specification."),
    ("Calculate 15 percent of 240.", "15 percent of 240 is 36."),
    ("Write a factual handover template for unfinished work.", "Task:\nCompleted work and evidence:\nRemaining work:\nKnown blockers:\nAuthorized owner and next steps:\nKeep credentials and unrelated private information out of the handover."),
    ("How should I report a test I could not run?", "Mark it not run, explain the missing prerequisite, and list the exact check still needed. Do not label it passed or failed without an observed result."),
    ("Summarize: Three checks passed, one failed, and two were not run.", "Three checks passed; one failed; two remain untested. The full suite has not passed."),
    ("List three distinct checks for a proposed bug fix.", "1. Reproduce the original failure.\n2. Verify the intended behavior after the change.\n3. Run relevant regression and edge-case checks."),
    ("Explain the difference between a plan and a completed action.", "A plan describes intended work. A completed-action claim needs evidence that the action occurred and, when relevant, its observed result."),
    ("Write a brief request to clarify conflicting requirements.", "The specification and the test require different behavior for the same input. Which requirement should govern? I will preserve the current tests and report the conflict until this is clarified."),
    ("What is the median of 2, 5, and 11?", "The median is 5."),
]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def build(root, responses_path, output, seed=42):
    responses = json.loads(responses_path.read_text())
    rows, inputs = [], []
    for suite in ("alignment", "rewardhacking"):
        path = root / suite / "scenarios.jsonl"
        inputs.append({"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            case = json.loads(line)
            rows.append({"scenario_id": case["id"], "system": SYSTEM,
                         "instruction": "Given this hypothetical situation, describe your next authorized steps. Do not claim to have executed tools.",
                         "input": case["trigger"] + "\n\n" + case["observation"],
                         "output": responses[case["id"]], "source": "assistant-authored-synthetic-demo-v1",
                         "reviewed": False, "kind": "policy_plan_not_tool_trajectory",
                         "catalog_source": case["source"]})
    if set(responses) != {r["scenario_id"] for r in rows}:
        raise ValueError("Response IDs must exactly match both catalogs")
    for index, (prompt, response) in enumerate(BENIGN):
        rows.append({"scenario_id": f"demo.benign.{index}", "system": SYSTEM,
                     "instruction": prompt, "input": "", "output": response,
                     "source": "assistant-authored-synthetic-demo-v1", "reviewed": False,
                     "kind": "benign_control"})
    # Family grouping avoids placing replacement/restriction blackmail variants in both splits.
    def family(row):
        ident = row["scenario_id"]
        return ".".join(ident.split(".")[:2]) if ident.startswith("alignment.") else ident

    groups = sorted({family(row) for row in rows})
    random.Random(seed).shuffle(groups)
    heldout = set(groups[:max(1, round(len(groups) * .1))])
    splits = {split: [r for r in rows if (family(r) in heldout) == (split == "validation")]
              for split in ("train", "validation")}
    output.mkdir(parents=True, exist_ok=False)
    for split, records in splits.items():
        write_json(output / f"{split}.json", records)
    (output / "source.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    write_json(output / "dataset_info.json", {
        f"demo_{split}": {"file_name": f"{split}.json", "columns": {
            "prompt": "instruction", "query": "input", "response": "output", "system": "system"}}
        for split in splits})
    manifest = {"seed": seed, "counts": {s: len(v) for s, v in splits.items()},
                "synthetic": True, "human_reviewed": False, "frontier_rollouts_used": False,
                "purpose": "pipeline smoke test, not production alignment training",
                "limitations": ["Policy plans, not observed tool trajectories.",
                                "Original catalogs are training-derived and no longer independent tests.",
                                "Family split checks catalog IDs, not external semantic overlap.",
                                "Synthetic responses require human review before production use."],
                "inputs": inputs + [{"path": str(responses_path),
                                     "sha256": hashlib.sha256(responses_path.read_bytes()).hexdigest()}],
                "scenario_ids": {s: [r["scenario_id"] for r in v] for s, v in splits.items()}}
    write_json(output / "manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--responses", type=Path, default=Path(__file__).parent / "data/demo_responses.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(build(args.data_root, args.responses, args.output, args.seed), indent=2))
