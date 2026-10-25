#!/usr/bin/env python3
"""Validate the generated Clearing altruism dataset."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

CALL = re.compile(r"^<tool_call>\n(\{.*\})\n</tool_call>$", re.S)
LABEL_FIELDS = {"altruistic", "misaligned", "missed_opportunity", "severity",
                "violations", "evidence", "correct_action", "explanation"}


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
    return rows


def tools_in(instruction: str) -> dict[str, dict]:
    match = re.search(r"<tools>\n(.*?)\n</tools>", instruction, re.S)
    if not match:
        return {}
    tools = {}
    for line in match.group(1).splitlines():
        data = json.loads(line)["function"]
        tools[data["name"]] = data["parameters"]
    return tools


def parse_call(text: str) -> dict:
    match = CALL.match(text)
    if not match:
        raise ValueError("output is not exactly one <tool_call>")
    value = json.loads(match.group(1))
    if set(value) != {"name", "arguments"} or not isinstance(value["arguments"], dict):
        raise ValueError("bad tool-call output shape")
    return {"tool": value["name"], "args": value["arguments"]}


def validate_tool(action: dict, tools: dict[str, dict], where: str, errors: list[str]):
    if action["tool"] not in tools:
        errors.append(f"{where}: tool {action['tool']!r} not in prompt")
        return
    params = tools[action["tool"]]
    args = dict(action.get("args", {}))
    # In normalized scenario records, `thought` is held beside `args`; the
    # Qwen tool-call renderer adds it back into the function arguments.
    if "thought" in params.get("required", []) and "thought" not in args:
        args["thought"] = action.get("thought", "validation placeholder")
    for key in params.get("required", []):
        if key not in args:
            errors.append(f"{where}: missing {action['tool']}.{key}")
    props = params.get("properties", {})
    for key, value in args.items():
        spec = props.get(key)
        if spec is None:
            errors.append(f"{where}: unknown {action['tool']} argument {key}")
            continue
        expected = spec.get("type")
        if expected == "string" and not isinstance(value, str):
            errors.append(f"{where}: {action['tool']}.{key} must be string")
        if expected == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
            errors.append(f"{where}: {action['tool']}.{key} must be integer")
        if expected == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
            errors.append(f"{where}: {action['tool']}.{key} must be number")
        if "enum" in spec and value not in spec["enum"]:
            errors.append(f"{where}: {action['tool']}.{key} is outside enum")
        if isinstance(value, list) and "items" in spec and "enum" in spec["items"]:
            if any(item not in spec["items"]["enum"] for item in value):
                errors.append(f"{where}: {action['tool']}.{key} contains enum-invalid value")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()
    root = args.data
    files = {name: read_jsonl(root / f"{name}.jsonl") for name in
             ("sft_act", "sft_audit", "pairs", "scenarios", "review_queue")}
    manifest = json.loads((root / "manifest.json").read_text())
    errors: list[str] = []
    labels = Counter()
    for i, row in enumerate(files["sft_act"], 1):
        where = f"sft_act:{i}:{row.get('scenario_id')}"
        try:
            action = parse_call(row.get("output", ""))
        except (ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{where}: {exc}")
            continue
        validate_tool(action, tools_in(row["instruction"]), where, errors)
        if row.get("reviewed") is not False:
            errors.append(f"{where}: reviewed must remain false")
        if not row.get("split_group_id"):
            errors.append(f"{where}: split_group_id required")

    for i, row in enumerate(files["sft_audit"], 1):
        where = f"sft_audit:{i}:{row.get('scenario_id')}"
        try:
            label = json.loads(row.get("output", ""))
        except json.JSONDecodeError as exc:
            errors.append(f"{where}: invalid label JSON: {exc}")
            continue
        if set(label) != LABEL_FIELDS:
            errors.append(f"{where}: label keys differ from contract")
        if not isinstance(label.get("altruistic"), bool) or not isinstance(label.get("misaligned"), bool):
            errors.append(f"{where}: altruistic and misaligned must be booleans")
        if not isinstance(label.get("missed_opportunity"), bool):
            errors.append(f"{where}: missed_opportunity must be boolean")
        if label.get("severity") not in {"none", "tier_1", "tier_2", "tier_3", "tier_4"}:
            errors.append(f"{where}: invalid severity")
        if label.get("misaligned") and not label.get("violations"):
            errors.append(f"{where}: misaligned label has no violation code")
        if not label.get("misaligned") and label.get("severity") != "none":
            errors.append(f"{where}: non-misaligned row has non-none severity")
        tools = tools_in(row["input"])
        validate_tool(row.get("proposed_action", {}), tools, where + ":proposed", errors)
        if label.get("correct_action"):
            validate_tool(label["correct_action"], tools, where + ":correct", errors)
        if row.get("reviewed") is not False:
            errors.append(f"{where}: reviewed must remain false")
        labels["misaligned" if label.get("misaligned") else
               "missed_opportunity" if label.get("missed_opportunity") else
               "altruistic" if label.get("altruistic") else "aligned_non_altruistic"] += 1

    for i, row in enumerate(files["pairs"], 1):
        where = f"pairs:{i}:{row.get('scenario_id')}"
        try:
            chosen = parse_call(row["chosen"])
            rejected = parse_call(row["rejected"])
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{where}: {exc}")
            continue
        if chosen == rejected:
            errors.append(f"{where}: chosen and rejected calls are identical")
        if row.get("reviewed") is not False:
            errors.append(f"{where}: reviewed must remain false")

    expected_counts = {"sft_act": "act", "sft_audit": "audit", "pairs": "pairs", "scenarios": "scenarios"}
    for file_key, manifest_key in expected_counts.items():
        if manifest.get("counts", {}).get(manifest_key) != len(files[file_key]):
            errors.append(f"manifest count mismatch for {file_key}")
    for row in files["scenarios"]:
        if row.get("provenance", {}).get("kind") == "recorded_replay_event":
            if not row["provenance"].get("replay") or not row["provenance"].get("event_row"):
                errors.append(f"{row['id']}: replay provenance incomplete")
        if row.get("origin") == "counterfactual_from_simulation_rules" and not row.get("provenance", {}).get("source_rule"):
            errors.append(f"{row['id']}: counterfactual lacks source rule")

    report = {
        "counts": {name: len(rows) for name, rows in files.items()},
        "audit_labels": dict(labels),
        "warnings": [],
        "errors": errors,
    }
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
