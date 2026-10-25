#!/usr/bin/env python3
"""Render honest comparison report from raw demo-showcase outputs."""
import argparse
import json
from pathlib import Path


def render(run):
    summary = json.loads((run/"summary.json").read_text())
    rows = [json.loads(line) for line in (run/"responses.jsonl").read_text().splitlines()]
    lines = ["# Ender Demo Showcase", "",
        "**Training-overlap showcase only. Not an independent benchmark and not a fair frontier comparison.**",
        "Historical frontier results used another benchmark, prompts, tools and scoring. No frontier scores are inferred here.", "",
        "## Same-prompt base vs Ender", "",
        "| Domain | Base matches | Ender matches | Base valid | Ender valid |",
        "|---|---:|---:|---:|---:|"]
    for domain, title in (("simulation_alignment", "Simulation alignment"),
                          ("financial_compliance", "Financial compliance"),
                          ("reward_hacking", "Reward hacking")):
        b, e = summary["base"][domain], summary["ender"][domain]
        lines.append(f"| {title} | {b['correct']}/{b['total']} | {e['correct']}/{e['total']} | {b['valid']}/{b['total']} | {e['valid']}/{e['total']} |")
    lines += ["", "These are exact predeclared training targets. An action target mismatch is not automatically an unsafe action; audit score fields and raw outputs before interpreting a miss.", "",
              "## Item-level results", "", "| Domain | Scenario | Task | Base | Ender |", "|---|---|---|---|---|"]
    indexed = {(row["scenario_id"], row["mode"]): row for row in rows}
    suite = json.loads((run/"suite.json").read_text())
    for source in suite:
        base, ender = indexed[source["scenario_id"], "base"], indexed[source["scenario_id"], "ender"]
        lines.append(f"| {source['domain']} | {source['scenario_id']} | {source['task']} | valid={base['valid']}, match={base['correct']} | valid={ender['valid']}, match={ender['correct']} |")
    lines += ["", "## Limitations", "",
        "- All 18 examples are drawn from Ender's current training corpora. This measures curriculum fit by design.",
        "- Synthetic scenarios and labels are unreviewed; replay-derived Clearing observations are reconstructions, not original model requests.",
        "- Outputs are proposed tool calls, never executed tool trajectories. Audit scores are narrow field checks, not human alignment judgments.",
        "- To claim frontier superiority, frontier models must run on this exact saved suite with the same prompts, tools, token budget and scorer. That run has not been performed.", "",
        "## Raw evidence", "", "- [Frozen suite](suite.json)", "- [Base/Ender responses](responses.jsonl)",
        "- [Run manifest and adapter hash](manifest.json)", "- [Machine-readable summary](summary.json)", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Do not overwrite an existing report")
    args.output.write_text(render(args.run))
