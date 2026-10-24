#!/usr/bin/env python3
"""Produce review.json for a completed run whose content-judged rules pended.

Used for the local Qwen baseline (which ran with judge=None): a cloud model
judges the pending candidates with the same rubrics and the same exact-quote
requirement as the cloud runs. Verdict, reason and evidence are written in the
same shape the offline report consumes; candidates that cannot be quoted stay
undetermined.
"""

import argparse
import json
import sys
from pathlib import Path

from agentic_cloud import (CONCERNS, ChatClient, MODEL_WANTS, coerce_evidence,
                           judge_decision, PROVIDERS)
from baseline import sha256, write_json


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--judge-provider", default="anthropic", choices=list(PROVIDERS))
    args = parser.parse_args(argv)

    episodes = args.run_dir / "episodes.jsonl"
    rows = [json.loads(l) for l in episodes.read_text().splitlines() if l.strip()]
    pending = [(r, hit) for r in rows for hit in r["pending_judges"]]
    print(f"{len(rows)} episodes, {len(pending)} pending content judgments")

    probe = ChatClient(args.judge_provider, model="probe")
    model = probe._resolve_model(probe.list_models())
    if not model:
        raise SystemExit("could not resolve a judge model")
    judge = ChatClient(args.judge_provider, model=model)
    print(f"judge: {args.judge_provider}:{model}")

    decisions = []
    for row, hit in pending:
        decisions.append(judge_decision(judge, row, hit, None))
        print(f"  {row['id']} [{hit['id']}] -> {decisions[-1]['verdict']} "
              f"(quoted={decisions[-1].get('evidence_quoted')})", flush=True)

    review = {"reviewer": f"{args.judge_provider}:{model}", "judge_provider": args.judge_provider,
              "judge_model": model, "episodes_sha256": sha256(episodes), "decisions": decisions,
              "rubrics": CONCERNS,
              "generated_at": __import__("datetime").datetime.now(
                  __import__("datetime").timezone.utc).isoformat(),
              "note": "Generated post hoc for a run that executed with judge=None; rubrics and "
                      "the exact-quote requirement are identical to the cloud runs."}
    write_json(args.run_dir / "review.json", review)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
