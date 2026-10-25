#!/usr/bin/env python3
"""Validate the built alignment-finance dataset.

Usage:
  python3 validate_dataset.py --data ender/finetuning/data/alignment-finance
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HELD_OUT = {"P02", "P05", "P07", "P13", "P14", "P17", "P18", "P20"}
CANARY = "ENDERSBENCH-FINANCE-HOLDOUT"
SEVERITIES = {"none", "tier_1", "tier_2", "tier_4"}
TOOL_CALL = re.compile(r"^<tool_call>\n(\{.*\})\n</tool_call>$", re.S)


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def tool_names(instruction: str) -> set[str]:
    match = re.search(r"<tools>\n(.*?)\n</tools>", instruction, re.S)
    if not match:
        return set()
    names = set()
    for line in match.group(1).splitlines():
        try:
            names.add(json.loads(line)["function"]["name"])
        except (json.JSONDecodeError, KeyError):
            pass
    return names


def parse_call(text: str) -> dict | None:
    match = TOOL_CALL.match(text)
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    if set(value) != {"name", "arguments"} or not isinstance(value["arguments"], dict):
        return None
    return {"tool": value["name"], "args": value["arguments"]}


def observation_of(row: dict) -> dict:
    text = row.get("input", "")
    if "Observation (JSON):" in text:
        text = text.split("Observation (JSON):", 1)[1]
    text = text.split("\n\nProposed action:", 1)[0]
    text = text.split("\n\nChoose your next action", 1)[0]
    text = text.split("\n\nReturn the label", 1)[0]
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return {}


def ngrams(text: str, n: int = 8) -> set[tuple[str, ...]]:
    words = re.findall(r"[a-z0-9]+", text.casefold())
    return {tuple(words[i:i + n]) for i in range(max(0, len(words) - n + 1))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--probes", type=Path,
                        default=Path("ender/finetuning/data/unseen_action_probes_v1.json"))
    args = parser.parse_args()
    data = args.data
    act = load(data / "sft_act.jsonl")
    audit = load(data / "sft_audit.jsonl")
    pairs = load(data / "pairs.jsonl")
    scenarios = load(data / "scenarios.jsonl")
    manifest = json.loads((data / "manifest.json").read_text())
    errors: list[str] = []
    warnings: list[str] = []
    labels = Counter()
    severities = Counter()
    families = Counter()
    actions = Counter()
    for i, row in enumerate(act, 1):
        where = f"sft_act:{i}:{row.get('scenario_id')}"
        call = parse_call(row.get("output", ""))
        if not call:
            errors.append(f"{where}: output is not one tool call")
            continue
        names = tool_names(row.get("instruction", ""))
        if names and call["tool"] not in names:
            errors.append(f"{where}: tool {call['tool']!r} not in instruction tools")
        if row.get("reviewed") is not False:
            errors.append(f"{where}: reviewed must be false")
        actions[call["tool"]] += 1
        families[row.get("family", "?")] += 1
        obs = observation_of(row)
        for value in (obs.get("people") or {}).values():
            if value in HELD_OUT:
                errors.append(f"{where}: held-out persona {value}")
        if CANARY in json.dumps(obs):
            errors.append(f"{where}: canary in observation")
    seen_prompts = set()
    for i, row in enumerate(audit, 1):
        where = f"sft_audit:{i}:{row.get('scenario_id')}"
        key = row.get("instruction", "") + "\u0000" + row.get("input", "")
        if key in seen_prompts:
            errors.append(f"{where}: duplicate audit prompt")
        seen_prompts.add(key)
        label = row.get("label")
        if not isinstance(label, dict):
            errors.append(f"{where}: label is not an object")
            continue
        for field in ("misaligned", "severity", "violations", "wrong_calls",
                      "missed_requirements", "policy_basis", "evidence",
                      "correct_action", "explanation"):
            if field not in label:
                errors.append(f"{where}: label missing {field}")
        if not isinstance(label.get("misaligned"), bool):
            errors.append(f"{where}: misaligned must be bool")
        if label.get("severity") not in SEVERITIES:
            errors.append(f"{where}: bad severity {label.get('severity')!r}")
        for field in ("violations", "wrong_calls", "missed_requirements", "evidence"):
            if not isinstance(label.get(field), list):
                errors.append(f"{where}: {field} must be a list")
        if label.get("misaligned") and not (
            label.get("violations") or label.get("wrong_calls") or label.get("missed_requirements")
        ):
            errors.append(f"{where}: misaligned without a code")
        if not label.get("misaligned") and (
            label.get("violations") or label.get("wrong_calls") or label.get("missed_requirements")
        ):
            errors.append(f"{where}: aligned with codes")
        correct = label.get("correct_action")
        if correct is not None:
            if not isinstance(correct, dict) or set(correct) != {"tool", "args"}:
                errors.append(f"{where}: correct_action shape")
            else:
                names = tool_names(row.get("instruction", ""))
                if names and correct["tool"] not in names:
                    errors.append(f"{where}: correct_action tool not in tools")
        labels["misaligned" if label.get("misaligned") else "aligned"] += 1
        severities[label.get("severity")] += 1
        families[row.get("family", "?")] += 1
        obs = observation_of(row)
        for value in (obs.get("people") or {}).values():
            if value in HELD_OUT:
                errors.append(f"{where}: held-out persona {value}")
        if CANARY in json.dumps(obs):
            errors.append(f"{where}: canary in observation")
        try:
            json.loads(row.get("output", ""))
        except json.JSONDecodeError:
            errors.append(f"{where}: output is not JSON")
    for i, row in enumerate(pairs, 1):
        where = f"pairs:{i}:{row.get('scenario_id')}"
        chosen, rejected = parse_call(row.get("chosen", "")), parse_call(row.get("rejected", ""))
        if not chosen or not rejected:
            errors.append(f"{where}: chosen/rejected are not tool calls")
            continue
        if chosen == rejected:
            errors.append(f"{where}: chosen equals rejected")
        if row.get("reviewed") is not False:
            errors.append(f"{where}: reviewed must be false")
    if manifest["counts"]["act"] != len(act):
        errors.append("manifest act count mismatch")
    if manifest["counts"]["audit"] != len(audit):
        errors.append("manifest audit count mismatch")
    if manifest["counts"]["pairs"] != len(pairs):
        errors.append("manifest pairs count mismatch")
    if manifest["counts"]["scenarios"] != len(scenarios):
        errors.append("manifest scenario count mismatch")
    # Overlap screen against the frozen unseen-action probes. These probes were
    # written after the finance split; the screen is a warning, not a hard gate,
    # because the finance-derived rows come from the same source by design.
    overlap = {"probes": 0, "max_8gram_containment": 0.0}
    if args.probes.exists():
        probe_text = args.probes.read_text()
        probes = ngrams(probe_text)
        overlap["probes"] = len(probes)
        if probes:
            hits = 0
            for row in act:
                hits = max(hits, len(probes & ngrams(row.get("input", ""))) / len(probes))
            overlap["max_8gram_containment"] = round(hits, 4)
            if hits > 0.35:
                warnings.append(f"unseen-probe 8-gram containment is {hits:.2%}; inspect before training")
    else:
        warnings.append(f"probe file not found: {args.probes}")
    report = {
        "files": {name: len(rows) for name, rows in (
            ("sft_act", act), ("sft_audit", audit), ("pairs", pairs), ("scenarios", scenarios))},
        "audit_labels": dict(labels),
        "audit_severity": dict(severities),
        "families": dict(sorted(families.items())),
        "act_actions": dict(actions.most_common()),
        "overlap": overlap,
        "warnings": warnings,
        "errors": errors,
    }
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
