#!/usr/bin/env python3
"""Build a paired, evidence-linked Markdown report without changing raw results."""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


MODES = ("base", "ender", "retep")


def paired_rows(cases, rows):
    expected = {(case["id"], mode) for case in cases for mode in MODES}
    indexed = {}
    for row in rows:
        key = row["id"], row["mode"]
        if key not in expected or key in indexed:
            raise ValueError("Unexpected/duplicate scenario-mode response")
        indexed[key] = row
    if set(indexed) != expected:
        raise ValueError("Incomplete matched comparison")
    for case in cases:
        hashes = {indexed[case["id"], mode]["prompt_sha256"] for mode in MODES}
        if len(hashes) != 1:
            raise ValueError("Cannot compare differing prompts")
    return indexed


def decision(row):
    action = row.get("action")
    if not isinstance(action, dict) or not isinstance(action.get("args"), dict):
        return None
    return {"tool": action.get("tool"), "args": {key: value for key, value in action["args"].items() if key != "reason"}}


def build_report(run):
    manifest = json.loads((run/"manifest.json").read_text())
    if manifest["status"] != "complete":
        raise ValueError("Do not publish incomplete inference as a completed comparison")
    cases = json.loads((run/"cases.json").read_text())["cases"]
    rows = [json.loads(line) for line in (run/"responses.jsonl").read_text().splitlines()]
    audit = json.loads((run/"overlap-audit.json").read_text())
    if not audit["passed"]:
        raise ValueError("Overlap screen did not pass")
    pairs = paired_rows(cases, rows)
    counts = {mode: Counter(pairs[case["id"], mode]["outcome"] for case in cases) for mode in MODES}
    changed = [case["id"] for case in cases if decision(pairs[case["id"], "base"]) != decision(pairs[case["id"], "ender"])]
    wins = [case["id"] for case in cases if pairs[case["id"], "base"]["outcome"] != "rubric_match"
            and pairs[case["id"], "ender"]["outcome"] == "rubric_match"]
    regressions = [case["id"] for case in cases if pairs[case["id"], "base"]["outcome"] == "rubric_match"
                   and pairs[case["id"], "ender"]["outcome"] != "rubric_match"]
    lines = ["# Fresh scenario action probes — base versus Ender and `retep`", "",
             f"Run: `{run.name}`. **Only the {manifest['adapter_training_steps']}-update financial probe adapters are evaluated; no full epoch was trained.**", "",
             "These are eight assistant-authored, unreviewed one-turn diagnostic probes. All outputs are proposed calls, **not executed tools or completed tasks**. The scorer uses exact predeclared actions/arguments, not a human or external safety judge.", "",
             "## Matched results", "", "| Mode | Rubric matches | Different actions | Unresolved |",
             "|---|---:|---:|---:|"]
    if manifest.get("evaluation_role") == "development_recheck":
        lines[0] = "# Development scenario recheck — base versus Ender and `retep`"
        lines.insert(4, "**Development monitoring:** these prompts were inspected before learning-rate tuning. This is not a new independent held-out evaluation.\n")
    for mode in MODES:
        count = counts[mode]
        lines.append(f"| {mode} | {count['rubric_match']}/{len(cases)} | {count['different_action']} | {count['unresolved']} |")
    lines += ["", f"Ender changed substantive proposed actions relative to base on **{len(changed)}/{len(cases)}** cases (optional reason wording ignored).",
              f"Rubric improvements: **{len(wins)}**; rubric regressions/unresolved after a base match: **{len(regressions)}**.",
              "A different action is not automatically unsafe. Matching an obvious policy prompt does not establish independent alignment or adversarial capability.",
              "", "## Per-scenario actions", "", "| Scenario | Base | Ender | `retep` |", "|---|---|---|---|"]
    for case in cases:
        cells = []
        for mode in MODES:
            row = pairs[case["id"], mode]
            action = decision(row)
            text = json.dumps(action, separators=(",", ":")) if action is not None else "invalid/incomplete response"
            cells.append(f"**{row['outcome']}**: `{text.replace('|', '&#124;')}`")
        lines.append("| " + case["id"].removeprefix("fresh.").replace("_", " ") + " | " + " | ".join(cells) + " |")
    max_overlap = max(row["maximum_fivegram_fraction"] for row in audit["by_case"].values())
    lines += ["", "## Conditions and limitations", "",
              f"- Same pinned checkpoint revision `{manifest['revision']}`, native LLM.int8 base and BF16 autocast in all modes. Base disables the adapter; Ender/retep select their respective saved adapters.",
              f"- Greedy decoding, thinking off, seed {manifest['generation']['seed']}, at most {manifest['generation']['max_new_tokens']} output tokens. Generation stops at complete JSON or the normal token/EOS boundary. No repair, resampling, real tools, host commands, network actions or external judge.",
              "- Prompt hashes match across all three modes for every case. Tool specifications are deterministically shuffled identically across modes. Expected answers and rubric metadata are withheld from model messages.",
              f"- Overlap screen passed against {len(audit['sources'])} saved data files: no normalized context containment; maximum query five-gram overlap {max_overlap:.4%}. This does **not** certify semantic independence or absence from base-model pretraining.",
              "- Six pressure/instruction-boundary probes and two benign controls; one response per mode/case. Tiny, policy-explicit examples may have ceiling effects. No statistical or generalization claim is supported.",
              "- `retep` uses negative primary gradients, not gradients evaluated on itself. It is not a validated adversary, regardless of these scores.",
              "", "## Evidence", "",
              "- [Exact cases and rubrics](cases.json)", "- [Raw prompts and responses](responses.jsonl)",
              "- [Run manifest and adapter hashes](manifest.json)", "- [Overlap audit and data hashes](overlap-audit.json)",
              "- [Machine-readable counts](summary.json)", "", "## Raw evidence by scenario", ""]
    lines.insert(lines.index("## Raw evidence by scenario"),
                 "Raw response SHA256: `" + hashlib.sha256((run/"responses.jsonl").read_bytes()).hexdigest() + "`.\n")
    for case in cases:
        lines += [f"### {case['id']}", "", case["context"], "", "**Predeclared rubric:** " + case["rubric"], ""]
        for mode in MODES:
            row = pairs[case["id"], mode]
            lines += [f"**{mode} — {row['outcome']}**", "", "```json", row["response"], "```", ""]
    return "\n".join(lines)+"\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new report path; preserve existing reports")
    args.output.write_text(build_report(args.run))
