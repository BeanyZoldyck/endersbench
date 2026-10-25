#!/usr/bin/env python3
"""Sequentially retry frontier calls that failed with API errors or empty content.

The first attempt is preserved as frontier-attempt1.jsonl. Retried records keep
the identical user message and record the full returned message (content,
native tool calls, refusal) so a later decision parser can score it.
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from alignment_finance_monitor import score_row
from frontier_showcase import API, MODELS, user_message

MAX_TOKENS = 1536


def call(model, message, key):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": message}],
                       "max_tokens": MAX_TOKENS, "temperature": 0}).encode()
    request = urllib.request.Request(API, data=body, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:400]}"
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return None, f"{type(exc).__name__}: {exc}"
    if "error" in data:
        return None, json.dumps(data["error"])[:400]
    return data, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    key = os.environ["OPENROUTER_API_KEY"]
    path = args.run/"frontier.jsonl"
    original = args.run/"frontier-attempt1.jsonl"
    if not original.exists():
        original.write_bytes(path.read_bytes())
    suite = json.loads((args.run/"suite.json").read_text())
    records = [json.loads(line) for line in path.read_text().splitlines()]
    pending = [r for r in records if r["error"] or not r["response"].strip()]
    print(f"Retrying {len(pending)} calls sequentially", flush=True)
    halted = None
    for record in pending:
        if halted:
            record["error"] = f"not attempted: {halted}"
            continue
        row = suite[record["case_index"]]
        data, error = call(record["model"], user_message(row), key)
        record["retry"] = True
        record["max_tokens"] = MAX_TOKENS
        if error:
            record["error"] = error
            if "402" in error:
                halted = "OpenRouter credits exhausted"
        else:
            message = data["choices"][0]["message"]
            record.update(response=message.get("content") or "", error=None,
                          native_tool_calls=message.get("tool_calls"), refusal=message.get("refusal"),
                          finish_reason=data["choices"][0].get("finish_reason"),
                          provider=data.get("provider"), usage=data.get("usage"))
            record.update(score_row(row, record["response"]))
        print(json.dumps({k: record.get(k) for k in ("label", "case_index", "task", "valid", "correct", "error")})[:300], flush=True)
        path.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in records))
        time.sleep(0.5)
    path.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in records))


if __name__ == "__main__":
    main()
