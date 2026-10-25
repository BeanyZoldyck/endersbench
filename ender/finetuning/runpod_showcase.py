#!/usr/bin/env python3
"""Run the frozen 18-case showcase suite through a RunPod OpenAI-compatible endpoint.

Same single user message as the frontier runs (instruction + input), temperature 0.
Only the final message content is scored; reasoning text is saved separately.
The key is read from RUNPOD_API_KEY and is never written to disk.
"""
import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from alignment_finance_monitor import score_row
from decision_score import decision_score
from frontier_showcase import user_message

ENDPOINT = "https://api.runpod.ai/v2/n823bkhsuvtgg6/openai/v1/chat/completions"


def call(model, message, key, max_tokens):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": message}],
                       "max_tokens": max_tokens, "temperature": 0, "chat_template_kwargs": {"enable_thinking": False}}).encode()
    last = None
    for attempt in range(4):
        request = urllib.request.Request(ENDPOINT, data=body, headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response), None
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:300]}"
            if exc.code not in (408, 429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(3 * 2**attempt)
    return None, last


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="Showcase run directory containing suite.json")
    parser.add_argument("--model", default="ender")
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    key = os.environ.get("RUNPOD_API_KEY")
    if not key:
        parser.error("Set RUNPOD_API_KEY in the environment")
    if args.output.exists():
        parser.error("Do not overwrite existing results")
    suite = json.loads((args.run/"suite.json").read_text())
    args.output.mkdir(parents=True)

    def run(index):
        row = suite[index]
        message = user_message(row)
        started = time.perf_counter()
        data, error = call(args.model, message, key, args.max_tokens)
        record = {"case_index": index, "scenario_id": row["scenario_id"], "domain": row["domain"],
                  "task": row["task"], "model": args.model, "endpoint": "runpod n823bkhsuvtgg6 openai/v1",
                  "message_sha256": hashlib.sha256(message.encode()).hexdigest(),
                  "max_tokens": args.max_tokens, "seconds": time.perf_counter()-started, "error": error}
        if data is not None:
            choice = data["choices"][0]
            message_out = choice["message"]
            content = message_out.get("content") or ""
            record.update(response=content, reasoning=message_out.get("reasoning") or "",
                          finish_reason=choice.get("finish_reason"), served_model=data.get("model"),
                          usage=data.get("usage"))
        else:
            record.update(response="", reasoning="", finish_reason=None, served_model=None, usage=None)
        record.update(score_row(row, record["response"]))
        record.update(decision_score(row, record["response"]))
        print(json.dumps({k: record[k] for k in ("case_index", "task", "valid", "correct", "decision_correct", "finish_reason", "error")}), flush=True)
        return record

    with ThreadPoolExecutor(args.workers) as pool:
        records = sorted(pool.map(run, range(len(suite))), key=lambda r: r["case_index"])
    (args.output/"responses.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in records))
    summary = {"model": args.model, "cases": len(records), "errors": sum(r["error"] is not None for r in records),
               "strict_correct": sum(r["correct"] for r in records), "valid": sum(r["valid"] for r in records),
               "decision_correct": sum(r["decision_correct"] for r in records),
               "violations_chosen": None,
               "identity_note": "Served under the name 'ender'; not verified to equal the ender1.1 adapter.",
               "suite_sha256": hashlib.sha256((args.run/"suite.json").read_bytes()).hexdigest()}
    (args.output/"summary.json").write_text(json.dumps(summary, indent=2)+"\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
