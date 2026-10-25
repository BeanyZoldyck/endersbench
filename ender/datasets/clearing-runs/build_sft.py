#!/usr/bin/env python3
"""Convert recorded Clearing decisions into Ender's harness tool-call format.

Same filter as world/harness/dataset.ts (decision succeeded, no detector flag,
agent survived the run), restricted to rules version >= 8 so the tool schemas
match the current world. The prompt is the run's exact system prompt plus the
current tool schemas, the user turn is the harness's userMessage(), and the
target is a Qwen <tool_call> with the thought passed as a tool argument, as
the openai-chat brain sends it. Whole runs are held out, never single decisions.
"""

import argparse
import gzip
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SNAPSHOT = REPO / "ender/datasets/clearing-altruism/prompt_snapshot.json"
PROSOCIAL = {"give", "heal", "help", "feed_fire", "build", "fire_flare", "store"}


def tools_block(tools):
    lines = [json.dumps({"type": "function", "function": tool}, ensure_ascii=False) for tool in tools]
    return "\n\n# Tools\n\nYou may call one of these functions:\n<tools>\n" + "\n".join(lines) + "\n</tools>"


def valid_action(action, specs):
    spec = specs.get(action.get("name"))
    if spec is None or not isinstance(action.get("args"), dict):
        return False
    properties = spec["parameters"]["properties"]
    required = set(spec["parameters"].get("required", [])) - {"thought"}
    return set(action["args"]) <= set(properties) - {"thought"} and required <= set(action["args"])


def build(out, min_rules=8, routine_per_run=12, heldout_runs=3, seed=20261025):
    tools = json.loads(SNAPSHOT.read_text())["tools"]
    specs = {tool["name"]: tool for tool in tools}
    index = json.loads((HERE / "manifest.json").read_text())["runIndex"]
    runs = [r for r in index if (r.get("rulesVersion") or 0) >= min_rules]
    rng = random.Random(seed)
    by_variant = {}
    for run in sorted(runs, key=lambda r: r["id"]):
        by_variant.setdefault(run["promptVariant"], []).append(run)
    held = set()
    for variant in sorted(by_variant):
        if len(held) < heldout_runs:
            held.add(rng.choice(by_variant[variant])["id"])
    train, heldout, skipped = [], [], Counter()
    for run in sorted(runs, key=lambda r: r["id"]):
        folder = HERE / "runs" / run["id"]
        report = json.loads((folder / "report.json").read_text())
        system = report["run"]["config"]["systemPrompt"]
        survived = {a["name"] for a in report["agents"] if a.get("diedAtSeconds") is None}
        prosocial, routine = [], []
        with gzip.open(folder / "decisions.jsonl.gz", "rt") as handle:
            for line in handle:
                d = json.loads(line)
                if d["status"] != "done" or not d.get("action") or d.get("violated"):
                    skipped["failed_or_flagged"] += 1
                    continue
                if d["agent"] not in survived:
                    skipped["agent_died"] += 1
                    continue
                if not valid_action(d["action"], specs):
                    skipped["schema_mismatch"] += 1
                    continue
                arguments = {**d["action"]["args"], "thought": d.get("thought") or ""}
                row = {"scenario_id": f"{run['id']}:{d['decisionId']}", "split_group_id": "run:" + run["id"],
                       "source": "clearing-runs", "family": "clearing-runs:" + d["action"]["name"],
                       "task": "act", "toolset": "clearing", "prompt_variant": run["promptVariant"],
                       "rules_version": run["rulesVersion"], "model": d["model"], "reviewed": False,
                       "system": system + tools_block(tools), "instruction": "",
                       "input": (f"You are {d['agent']}. Current observation (JSON):\n" +
                                 json.dumps(d["observation"], ensure_ascii=False, separators=(",", ":")) +
                                 "\n\nChoose your next action by calling exactly one tool."),
                       "output": "<tool_call>\n" + json.dumps({"name": d["action"]["name"], "arguments": arguments},
                                                              ensure_ascii=False, separators=(",", ":")) + "\n</tool_call>",
                       "label_basis": "recorded frontier decision; not flagged; agent survived (dataset.ts filter)"}
                (prosocial if d["action"]["name"] in PROSOCIAL else routine).append(row)
        rng.shuffle(routine)
        rows = prosocial + routine[:routine_per_run]
        (heldout if run["id"] in held else train).extend(rows)
    if {r["split_group_id"] for r in train} & {r["split_group_id"] for r in heldout}:
        raise ValueError("Run leaked across split")
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train", train), ("heldout", heldout)):
        (out / f"{name}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    manifest = {"name": "endersbench-clearing-runs-sft", "min_rules_version": min_rules, "runs": len(runs),
                "heldout_runs": sorted(held), "train_rows": len(train), "heldout_rows": len(heldout),
                "train_actions": dict(Counter(r["family"].split(":")[1] for r in train)),
                "train_variants": dict(Counter(r["prompt_variant"] for r in train)),
                "skipped": dict(skipped), "routine_per_run": routine_per_run, "seed": seed,
                "snapshot_sha256": hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
                "manifest_sha256": hashlib.sha256((HERE / "manifest.json").read_bytes()).hexdigest(),
                "reviewed": False,
                "limitations": ["Positive examples are unflagged decisions by agents who survived, not reviewed ideal actions.",
                                "Routine actions are subsampled per run; prosocial actions are all kept.",
                                "Tool schemas are the current snapshot; runs before rules v8 are excluded."]}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=REPO / "ender/finetuning/data/clearing-runs-sft")
    args = parser.parse_args()
    print(json.dumps(build(args.out), indent=2))
