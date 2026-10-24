#!/usr/bin/env python3
"""Finish a paused local run through concurrent OpenRouter Qwen3.8-27B calls.

Completed local episodes are retained; committed active-episode calls are replayed
only inside the in-memory simulator. API credentials never enter result records.
"""

import argparse
import contextlib
import copy
import hashlib
import json
import multiprocessing
import os
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from agentic_baseline import load_records, load_runtime, parse_action, run_episode, summarize
from baseline import LiveProgress, sha256, utcnow, write_json


MODEL = "qwen/qwen3.8-27b"
API = "https://openrouter.ai/api/v1/chat/completions"


def unavailable_memory():
    return dict(server_rss_bytes=None, gpu_process_bytes=None, system_available_bytes=None)


class OpenRouterClient:
    def __init__(self, key):
        self.key = key

    def generate(self, messages, args, output, example, index, total, budget):
        payload = {"model": MODEL, "messages": messages, "temperature": 0, "seed": args.seed,
                   "max_tokens": budget, "stream": True, "stream_options": {"include_usage": True},
                   "reasoning": {"enabled": False}, "response_format": {"type": "json_object"}}
        request = urllib.request.Request(API, data=json.dumps(payload).encode(), headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        started = time.perf_counter()
        parts, usage, request_id, returned_model, finish, provider = [], {}, None, None, None, None
        for attempt in range(4):
            try:
                response = urllib.request.urlopen(request, timeout=120)
                break
            except urllib.error.HTTPError as exc:
                if exc.code in (429, 502, 503, 504) and attempt < 3:
                    delay = min(20, 2 ** (attempt + 1))
                    print(f"[OpenRouter] HTTP {exc.code}; retrying in {delay}s", flush=True)
                    time.sleep(delay)
                    continue
                detail = exc.read(2048).decode(errors="replace").replace(self.key, "[redacted]")
                raise RuntimeError(f"OpenRouter HTTP {exc.code}: {detail}") from None
        with response, LiveProgress(output, example, index, total, None, unavailable_memory,
                                    args.progress_interval) as progress:
            progress.started = started  # Include network wait, not just buffered SSE consumption.
            for raw in response:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                value = line[5:].strip()
                if value == "[DONE]":
                    break
                event = json.loads(value)
                if event.get("error"):
                    raise RuntimeError("OpenRouter stream error: " + json.dumps(event["error"]).replace(self.key, "[redacted]"))
                request_id = event.get("id", request_id)
                returned_model = event.get("model", returned_model)
                provider = event.get("provider", provider)
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices", []):
                    content = choice.get("delta", {}).get("content") or ""
                    if content:
                        if progress.first_token_seconds is None:
                            progress.first_token_seconds = time.perf_counter() - started
                        parts.append(content)
                        progress.text(content)
                    finish = choice.get("finish_reason") or finish
            if usage.get("completion_tokens") is not None:
                progress.add_tokens(usage["completion_tokens"])
            progress.text("", stream_end=True)
        if not finish:
            raise ValueError("OpenRouter stream ended without a finish reason")
        text = "".join(parts)
        try:
            action = parse_action(text)
        except ValueError:
            action = None
        seconds = time.perf_counter() - started
        print(f"[OpenRouter] {usage.get('completion_tokens', 'unknown')} output tokens | {seconds:.2f}s | "
              f"request={request_id}", flush=True)
        return {"response": text, "action": action, "input_tokens": usage.get("prompt_tokens"),
                "output_tokens": usage.get("completion_tokens", 0), "generation_seconds": seconds,
                "stop_reason": finish, "provider": provider, "provider_model": returned_model,
                "request_id": request_id, "usage": usage, "backend": "openrouter",
                "stream_cancelled_at_json": False, "sampled_peak_server_rss_bytes": None,
                "sampled_peak_gpu_process_bytes": None,
                "messages_sha256": hashlib.sha256(json.dumps(messages).encode()).hexdigest()}


def run_case(record, source, output, data_root, settings, index, total):
    output, source = Path(output), Path(source)
    output.mkdir()
    args = SimpleNamespace(**settings)
    args.resume_from = source
    args.compact_context = False  # Hosted model has a much larger context; retain restored history verbatim.
    args.max_input_tokens = 1000000
    runtime_class = load_runtime(Path(data_root))
    client = OpenRouterClient(os.environ["OPENROUTER_API_KEY"])
    with (output / "console.log").open("w", buffering=1) as console, \
            contextlib.redirect_stdout(console), contextlib.redirect_stderr(console), \
            (output / "turns.jsonl").open("x", buffering=1) as turns, \
            (output / "tool-calls.jsonl").open("x", buffering=1) as calls:
        row = run_episode(record, runtime_class, client, args, output, index, total, 1000000, turns, calls)
        row["execution_backend"] = "OpenRouter continuation; earlier turns may be inherited from local llama.cpp"
        row["hosted_model"] = MODEL
        (output / "episode.json").write_text(json.dumps(row, ensure_ascii=False) + "\n")
        write_json(output / "progress.json", {"status": row["status"], "outcome": row["outcome"],
                                              "turns": len(row["turns"]), "updated_at": utcnow()})
    return row


def build_results(source, output, original, records, inherited, new_rows, case_dirs):
    by_id = {r["id"]: r for r in inherited + new_rows}
    rows = [by_id[r["id"]] for r in records]
    if len(rows) != len(by_id) or len(rows) != original["selected_examples"]:
        raise ValueError("Combined result IDs are incomplete or duplicated")
    manifest = copy.deepcopy(original)
    manifest.update(status="completed_with_errors" if any(r["status"] == "error" for r in rows) else "completed",
                    completed_examples=len(rows), backend="mixed local llama.cpp / OpenRouter continuation",
                    dtype="local BF16; hosted precision unspecified", hosted_model=MODEL,
                    hosted_revision="not pinned or independently verified", thinking=False,
                    source_run=source.name, source_episodes_sha256=sha256(source / "episodes.jsonl"),
                    inherited_episodes=len(inherited), continued_episodes=len(new_rows),
                    backend_label="local BF16 + OpenRouter continuation (hosted precision unspecified)",
                    hosted_context_length=1000000, continuation_workers=4,
                    finished_at=utcnow(), continuation_script_sha256=sha256(Path(__file__)))
    write_json(output / "manifest.json", manifest)
    (output / "episodes.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    write_json(output / "summary.json", summarize(rows, len(rows)))
    inherited_ids = {r["id"] for r in inherited}
    for filename in ("turns.jsonl", "tool-calls.jsonl"):
        with (output / filename).open("x") as handle:
            for line in (source / filename).read_text().splitlines():
                if json.loads(line)["scenario_id"] in inherited_ids:
                    handle.write(line + "\n")
            for directory in case_dirs:
                handle.write((directory / filename).read_text())
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--smoke-only", action="store_true")
    parser.add_argument("--tmux-session", help="Add live per-case log windows to this existing session")
    args = parser.parse_args()
    os.environ["OPENROUTER_API_KEY"] = args.key_file.read_text().strip()
    if not 1 <= args.workers <= 8:
        parser.error("Use between one and eight workers")
    if args.smoke_only:
        fake = SimpleNamespace(seed=42, progress_interval=2)
        args.output_dir.mkdir()
        result = OpenRouterClient(os.environ["OPENROUTER_API_KEY"]).generate(
            [{"role": "user", "content": 'Return exactly {"final":"ready"}.'}], fake,
            args.output_dir, {"id": "provider-smoke"}, 1, 1, 32)
        assert result["action"] == {"final": "ready"}
        print("OPENROUTER MODEL SMOKE PASSED: " + MODEL)
        return 0
    source, output = args.source_run.resolve(), args.output_dir.resolve()
    original = json.loads((source / "manifest.json").read_text())
    records = [json.loads(s) for s in (source / "scenarios.jsonl").read_text().splitlines() if s.strip()]
    inherited = [json.loads(s) for s in (source / "episodes.jsonl").read_text().splitlines() if s.strip()]
    done = {r["id"] for r in inherited}
    remaining = [r for r in records if r["id"] not in done]
    if not remaining:
        raise ValueError("No remaining episodes")
    data_root = Path(original["data_root"])
    _, hashes = load_records(data_root, [r["id"] for r in records])
    if hashes != original["sources"]:
        raise ValueError("Source simulator/catalog hashes changed")
    output.mkdir(parents=True, exist_ok=False)
    shutil.copy2(source / "scenarios.jsonl", output / "scenarios.jsonl")
    if (source / "runtime-interventions.jsonl").exists():
        shutil.copy2(source / "runtime-interventions.jsonl", output / "runtime-interventions.jsonl")
    intervention = {"at": utcnow(), "kind": "openrouter_parallel_continuation", "source_run": source.name,
                    "model": MODEL, "workers": min(args.workers, len(remaining)),
                    "inherited_ids": sorted(done), "remaining_ids": [r["id"] for r in remaining],
                    "reasoning_requested": "disabled", "hosted_precision_and_revision": "unspecified",
                    "active_episode": "restored from committed simulator calls; an uncommitted response may be regenerated"}
    with (output / "runtime-interventions.jsonl").open("a") as handle:
        handle.write(json.dumps(intervention) + "\n")
    manifest = {**original, "status": "running", "backend": "mixed local llama.cpp / OpenRouter continuation",
                "continuation_started_at": utcnow(), "hosted_model": MODEL, "workers": args.workers,
                "source_run": source.name, "inherited_episodes": len(inherited)}
    write_json(output / "manifest.json", manifest)
    settings = {name: original[name] for name in ("seed", "max_turns", "max_tokens_per_turn", "max_episode_tokens",
                "max_input_tokens", "max_protocol_errors", "early_stop_rule_hit", "expose_seed_brief",
                "long_horizon", "allow_recovered_protocol_errors")}
    settings["progress_interval"] = 2
    case_dirs = [output / f"case-{index:02d}-{record['id']}" for index, record in enumerate(remaining, 1)]
    print(f"OPENROUTER: {MODEL} | {len(inherited)} episodes preserved | {len(remaining)} remaining | "
          f"{args.workers} simultaneous workers\nRun: {output}", flush=True)
    new_rows = []
    log_windows = set()
    with ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context("spawn")) as pool:
        futures = {pool.submit(run_case, record, str(source), str(directory), str(data_root), settings,
                               len(inherited) + i, len(records)): record["id"]
                   for i, (record, directory) in enumerate(zip(remaining, case_dirs), 1)}
        pending = set(futures)
        while pending:
            finished, pending = wait(pending, timeout=3, return_when=FIRST_COMPLETED)
            for future in finished:
                row = future.result()
                new_rows.append(row)
                print(f"DONE {row['id']}: {row['status']} | {row['outcome']} | {len(row['turns'])} total turns", flush=True)
            progress = []
            for directory in case_dirs:
                path = directory / "progress.json"
                if path.exists():
                    if args.tmux_session and directory.name not in log_windows:
                        subprocess.run(["tmux", "new-window", "-d", "-t", args.tmux_session,
                                        "-n", directory.name.split("-", 2)[1],
                                        "tail -n +1 -F " + shlex.quote(str(directory / "console.log"))], check=True)
                        log_windows.add(directory.name)
                    value = json.loads(path.read_text())
                    progress.append({"case": directory.name, "status": value.get("status"),
                                     "tokens": value.get("output_tokens_so_far"), "turns": value.get("turns")})
            write_json(output / "progress.json", {"status": "running", "completed": len(inherited) + len(new_rows),
                "total": len(records), "workers": progress, "updated_at": utcnow()})
            print(f"[progress {len(inherited) + len(new_rows)}/{len(records)}] " +
                  " | ".join(f"{p['case'].split('-',2)[-1]}: {p['status']}" for p in progress), flush=True)
    rows = build_results(source, output, original, records, inherited, new_rows, case_dirs)
    write_json(output / "progress.json", {"status": "completed", "completed": len(rows), "total": len(rows), "updated_at": utcnow()})
    args.key_file.unlink()
    print(f"COMPLETE: {len(rows)} episodes accounted for; temporary key file removed.\a", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
