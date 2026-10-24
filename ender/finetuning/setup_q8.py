#!/usr/bin/env python3
"""Build Q8_0 from the pinned BF16 GGUF, then replace the local inference service.

Keeps BF16 GGUF and training safetensors. Never changes another model service.
"""

import argparse
import hashlib
import json
import os
import select
import signal
import subprocess
import time
from pathlib import Path

from baseline import MODEL, REVISION, utcnow, write_json
from llamacpp_backend import LlamaClient, provenance


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def stop_owned(pid_file, required_text):
    if not pid_file.exists():
        return
    pid = int(pid_file.read_text())
    process = Path("/proc") / str(pid)
    if not process.exists():
        return
    command = (process / "cmdline").read_bytes().replace(b"\0", b" ").decode()
    if required_text not in command:
        raise ValueError(f"PID {pid} does not match the expected service; refusing to stop it")
    fd = os.pidfd_open(pid)
    try:
        print(f"Stopping prior inference service PID {pid}...", flush=True)
        os.kill(pid, signal.SIGTERM)
        if not select.select([fd], [], [], 90)[0]:
            raise TimeoutError(f"PID {pid} did not exit; no forced kill attempted")
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--parallel", type=int, default=4)
    args = parser.parse_args()
    if min(args.threads, args.parallel) < 1:
        parser.error("Thread and slot counts must be positive")
    root = args.root.resolve()
    source = root / "models/Qwen3.8-27B-BF16.gguf"
    output = root / "models/Qwen3.8-27B-Q8_0.gguf"
    original = provenance(source, MODEL, REVISION)
    client = LlamaClient()
    try:
        slots = client.json("/slots")
        if any(slot["is_processing"] for slot in slots):
            raise ValueError("Inference service is busy; pause its clients before replacement")
    except OSError:
        pass
    # Release the old model's allocations before quantization. The API-backed
    # continuation uses no local inference endpoint.
    stop_owned(root / "prompt-cache-proxy.pid", "finetuning/prompt_cache_proxy.py")
    stop_owned(root / "llama-server.pid", str(root / "llama.cpp/build/bin/llama-server"))
    print("Building the quantizer from the existing llama.cpp checkout...", flush=True)
    subprocess.run(["cmake", "--build", str(root / "llama.cpp/build"), "--target", "llama-quantize",
                    "--parallel", str(args.threads)], check=True)
    quantizer = root / "llama.cpp/build/bin/llama-quantize"
    commit = subprocess.check_output(["git", "-C", str(root / "llama.cpp"), "rev-parse", "HEAD"], text=True).strip()
    if output.exists():
        metadata = json.loads(output.with_suffix(".gguf.json").read_text())
        if (metadata.get("source_revision") != REVISION or metadata.get("outtype") != "q8_0"
                or metadata.get("gguf_bytes") != output.stat().st_size):
            raise ValueError("Existing Q8 output has different or missing provenance; refusing to overwrite")
    else:
        temporary = output.with_name(output.stem + ".partial.gguf")
        if temporary.exists():
            raise ValueError(f"Partial output already exists; inspect it before retrying: {temporary}")
        print(f"Quantizing {source.name} -> Q8_0. BF16 and training files remain untouched.", flush=True)
        command = [str(quantizer), str(source), str(temporary), "Q8_0", str(args.threads)]
        subprocess.run(command, check=True)
        print("Hashing Q8 output for provenance...", flush=True)
        metadata = {"source_model": MODEL, "source_revision": REVISION, "outtype": "q8_0",
                    "quantization": "Q8_0", "llamacpp_commit": commit,
                    "source_gguf": str(source), "source_gguf_sha256": original["gguf_sha256"],
                    "gguf_bytes": temporary.stat().st_size, "gguf_sha256": digest(temporary),
                    "quantized_at": utcnow(), "quantizer_command": command,
                    "note": "8-bit block quantization with scale overhead; not identical to the BF16 checkpoint."}
        temporary.rename(output)
        write_json(output.with_suffix(".gguf.json"), metadata)
    active = {"model": str(output), "alias": "qwen38-27b-q8-0", "quantization": "Q8_0",
              "parallel": args.parallel, "context_per_slot": 8192, "cache_prompt": True,
              "activated_at": utcnow(), "bf16_source_retained": str(source)}
    write_json(root / "models/active-model.json", active)
    env = dict(os.environ, LLAMA_SERVER_PORT="8080", LLAMA_CACHE_PROMPT="1",
               LLAMA_PARALLEL=str(args.parallel), LLAMA_CONTEXT_PER_SLOT="8192")
    with (root / "llama-server-q8-console.log").open("ab") as console:
        process = subprocess.Popen(["bash", "finetuning/serve_llamacpp.sh"], cwd=root, env=env,
                                   stdin=subprocess.DEVNULL, stdout=console, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    deadline = time.monotonic() + 150
    client = LlamaClient(timeout=10, cache_prompt=True, slot_id=0)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Q8 server exited; inspect llama-server-q8-console.log")
        try:
            if client.json("/health").get("status") == "ok":
                break
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    else:
        raise TimeoutError("Q8 server did not become ready")
    props = client.check(output)
    slots = client.json("/slots")
    if len(slots) != args.parallel or any(slot["n_ctx"] < 8192 for slot in slots):
        raise ValueError("Server did not retain the requested 8K context per parallel slot")
    _, tokens = client.prepare([{"role": "user", "content": "Count from 1 to 50, separated by commas."}])
    events = list(client.complete(tokens, 64, 42))
    timings = events[-1].get("timings", {})
    report = {"status": "ready", "model": str(output), "alias": active["alias"], "quantization": "Q8_0",
              "bf16_bytes": source.stat().st_size, "q8_bytes": output.stat().st_size,
              "parallel_slots": len(slots), "context_per_slot": slots[0]["n_ctx"],
              "server_pid": process.pid, "server_properties": props,
              "smoke_timings": timings, "verified_at": utcnow()}
    write_json(root / "models/q8-validation.json", report)
    print(json.dumps({k: report[k] for k in report if k != "server_properties"}, indent=2), flush=True)
    print("Q8 INFERENCE READY at http://127.0.0.1:8080. BF16 files retained as source only.\a", flush=True)


if __name__ == "__main__":
    main()
