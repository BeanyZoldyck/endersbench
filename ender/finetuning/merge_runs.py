#!/usr/bin/env python3
"""Merge several completed run dirs of the same model into one run dir.

Policy (--policy):
  budget          - prefer the episode from the run with the largest
                    max_episode_tokens (higher-budget rerun wins)
  prefer_resolved - prefer a rerun whose recomputed outcome is resolved
                    (rule_hit / no_rule_hit); otherwise fall back to the
                    original episode

Every merged episode has events, pending_judges and outcome RECOMPUTED from
its observed call_log against the current catalogs and simulator, so merged
rows are directly comparable across runs made at different times.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "datasets"))

from baseline import sha256, utcnow, write_json  # noqa: E402
from agentic_baseline import DATASETS, classify, load_records, load_runtime  # noqa: E402


def rescore(record, row, runtime_class):
    runtime = runtime_class(record, judge=None)
    runtime.call_log = row.get("call_log", [])
    result = runtime.score()
    row["events"] = result.events
    row["pending_judges"] = result.pending_judges
    row["outcome"] = classify(row)
    return row


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, nargs="+", required=True)
    parser.add_argument("--data-root", type=Path, default=Path(__file__).resolve().parent.parent / "datasets")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--policy", choices=("budget", "prefer_resolved"), default="prefer_resolved")
    args = parser.parse_args(argv)

    records, _ = load_records(args.data_root)
    runtime_class = load_runtime(args.data_root)
    record_by_id = {r["id"]: r for r in records}

    runs = []
    for run in args.run_dir:
        manifest = json.loads((run / "manifest.json").read_text())
        rows = {json.loads(l)["id"]: json.loads(l) for l in (run / "episodes.jsonl").read_text().splitlines() if l.strip()}
        runs.append((run, manifest, rows))

    model = runs[0][1]["model"]
    for run, manifest, _ in runs:
        if manifest["model"] != model:
            raise SystemExit(f"model mismatch: {run} is {manifest['model']}, expected {model}")

    def budget(manifest):
        return (manifest.get("max_episode_tokens") or 0, manifest.get("max_turns") or 0)

    merged = {}
    picks = {"salvage": 0, "fallback": 0}
    for record in records:
        sid = record["id"]
        candidates = [(run, manifest, rows[sid]) for run, manifest, rows in runs if sid in rows]
        if not candidates:
            continue
        if args.policy == "budget":
            chosen = max(candidates, key=lambda c: budget(c[1]))
        else:
            rescored = [(run, manifest, rescore(record_by_id[sid], dict(row), runtime_class))
                        for run, manifest, row in candidates]
            resolved = [c for c in rescored if c[2]["outcome"] in ("rule_hit", "no_rule_hit")]
            if resolved:
                chosen = max(resolved, key=lambda c: budget(c[1]))
                if len(resolved) > 1 or resolved[0][0] != candidates[0][0]:
                    picks["salvage"] += 1
            else:
                chosen = max(candidates, key=lambda c: budget(c[1]))
                picks["fallback"] += 1
        run, manifest, row = chosen
        row = dict(row)
        row["episode_source"] = run.name
        row["episode_budget"] = {"max_turns": manifest.get("max_turns"),
                                 "max_tokens_per_turn": manifest.get("max_tokens_per_turn"),
                                 "max_episode_tokens": manifest.get("max_episode_tokens")}
        rescore(record_by_id[sid], row, runtime_class)
        merged[sid] = row

    rows = [merged[r["id"]] for r in records if r["id"] in merged]
    args.output_dir.mkdir(parents=True, exist_ok=False)
    (args.output_dir / "scenarios.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records))
    (args.output_dir / "episodes.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    manifest = {"evaluation_mode": "simulated_tool_calls", "model": model,
                "provider": runs[0][1].get("provider", "local llama.cpp"),
                "judge_model": runs[0][1].get("judge_model"),
                "merged_from": [run.name for run, _, _ in runs],
                "merge_policy": args.policy,
                "merge_picks": picks,
                "max_turns": min(m.get("max_turns") or 0 for _, m, _ in runs) or None,
                "max_tokens_per_turn": min(m.get("max_tokens_per_turn") or 0 for _, m, _ in runs) or None,
                "max_episode_tokens": min(m.get("max_episode_tokens") or 0 for _, m, _ in runs) or None,
                "budget_note": "Merged runs used different budgets; per-episode budgets are in "
                               "episode_budget. The values above are the binding minimum.",
                "retry": None,
                "status": "completed_with_errors" if any(r["status"] == "error" for r in rows) else "completed",
                "selected_examples": len(records),
                "snapshot_sha256": sha256(args.output_dir / "scenarios.jsonl"),
                "started_at": utcnow(),
                "limitation": runs[0][1].get("limitation", "") +
                              " Merged run: each episode keeps the run that produced it (see episode_source); "
                              "events and outcomes were recomputed from the observed call log against the "
                              "current catalogs."}
    write_json(args.output_dir / "manifest.json", manifest)
    print(json.dumps({"model": model, "episodes": len(rows), "picks": picks,
                      "output": str(args.output_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
