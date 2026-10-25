#!/usr/bin/env python3
"""Run frontier models on the exact frozen demo-showcase suite via OpenRouter.

Each model receives the same single user message the local models received
(instruction + newline + input, no system prompt). Only the final message
content is scored, with the same strict scorer used for base and Ender.
The API key is read from OPENROUTER_API_KEY and is never written to disk.
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

API = "https://openrouter.ai/api/v1/chat/completions"
MODELS = {
    "x-ai/grok-4.7": "Grok 4.7",
    "openai/gpt-6-astra": "GPT-6 Astra",
    "anthropic/claude-opus-5.5": "Claude Opus 5.5",
    "openai/gpt-6-luna": "GPT-6 Luna",
    "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
}
MAX_TOKENS = 4096


def user_message(row):
    text = row["instruction"]
    if row.get("input"):
        text += "\n" + row["input"]
    return text


def call(model, message, key, attempts=4):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": message}],
                       "max_tokens": MAX_TOKENS, "temperature": 0}).encode()
    last = None
    for attempt in range(attempts):
        request = urllib.request.Request(API, data=body, headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json",
            "X-Title": "Ender demo showcase"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                data = json.load(response)
            if "error" in data:
                last = json.dumps(data["error"])[:500]
            else:
                choice = data["choices"][0]
                return {"content": choice["message"].get("content") or "",
                        "finish_reason": choice.get("finish_reason"),
                        "provider": data.get("provider"), "usage": data.get("usage"), "error": None}
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:500]}"
            if exc.code not in (408, 429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(2 ** attempt * 3)
    return {"content": "", "finish_reason": None, "provider": None, "usage": None, "error": last}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="Completed demo-showcase run with suite.json")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        parser.error("Set OPENROUTER_API_KEY")
    output = args.run/"frontier.jsonl"
    if output.exists():
        parser.error("Frontier results already exist; preserve them")
    suite = json.loads((args.run/"suite.json").read_text())
    jobs = [(index, model, row) for index, row in enumerate(suite) for model in MODELS]

    def run(job):
        index, model, row = job
        message = user_message(row)
        started = time.perf_counter()
        result = call(model, message, key)
        record = {"case_index": index, "scenario_id": row["scenario_id"], "domain": row["domain"],
                  "task": row["task"], "model": model, "label": MODELS[model],
                  "message_sha256": hashlib.sha256(message.encode()).hexdigest(),
                  "max_tokens": MAX_TOKENS, "temperature": 0,
                  "response": result["content"], "finish_reason": result["finish_reason"],
                  "provider": result["provider"], "usage": result["usage"], "error": result["error"],
                  "seconds": time.perf_counter()-started, **score_row(row, result["content"])}
        print(json.dumps({k: record[k] for k in ("label", "case_index", "domain", "task", "valid", "correct", "error")}), flush=True)
        return record

    with ThreadPoolExecutor(args.workers) as pool:
        records = sorted(pool.map(run, jobs), key=lambda r: (r["case_index"], r["model"]))
    output.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in records))
    totals = {}
    for record in records:
        entry = totals.setdefault(record["label"], {"correct": 0, "valid": 0, "errors": 0, "total": 0})
        entry["correct"] += record["correct"]
        entry["valid"] += record["valid"]
        entry["errors"] += record["error"] is not None
        entry["total"] += 1
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
