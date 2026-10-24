#!/usr/bin/env python3
"""Convert the pinned, already-downloaded base checkpoint to BF16 GGUF."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from baseline import MODEL, REVISION, utcnow, write_json
from llamacpp_backend import default_gguf, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path, default=default_gguf())
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    if output.exists():
        provenance(output, MODEL, REVISION)
        print(f"Existing BF16 conversion matches the pinned source: {output}")
        return
    hf_home = Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface"))
    cache = Path(os.environ.get("HF_HUB_CACHE", hf_home / "hub"))
    source = cache / "models--Qwen--Qwen3.8-27B/snapshots" / REVISION
    index = json.loads((source / "model.safetensors.index.json").read_text())
    shards = sorted(set(index["weight_map"].values()))
    if any(not (source / name).is_file() for name in shards):
        raise ValueError("Checkpoint download is incomplete; no conversion started")
    converter = root / "llama.cpp/convert_hf_to_gguf.py"
    commit = subprocess.check_output(["git", "-C", str(converter.parent), "rev-parse", "HEAD"], text=True).strip()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".partial.gguf")
    if temporary.exists():
        raise ValueError(f"Previous partial conversion exists: {temporary}. Inspect it before retrying.")
    command = [sys.executable, str(converter), str(source), "--outtype", "bf16",
               "--no-mtp", "--outfile", str(temporary)]
    print("Converting exact pinned checkpoint, BF16, text-only, no quantization.", flush=True)
    print("Training safetensors remain unchanged. Log:", root / "gguf-conversion.log", flush=True)
    with (root / "gguf-conversion.log").open("a", buffering=1) as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, bufsize=1, env=dict(os.environ, OMP_NUM_THREADS="4"))
        for line in process.stdout:
            print(line, end="", flush=True)
            log.write(line)
        if process.wait():
            raise ValueError(f"Conversion failed with exit code {process.returncode}; inspect gguf-conversion.log")
    print("Hashing completed GGUF for provenance...", flush=True)
    digest = hashlib.sha256()
    with temporary.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    metadata = {"source_model": MODEL, "source_revision": REVISION, "outtype": "bf16",
                "llamacpp_commit": commit, "gguf_bytes": temporary.stat().st_size,
                "gguf_sha256": digest.hexdigest(), "converted_at": utcnow(),
                "text_only": True, "mtp_excluded": True, "quantization": None,
                "note": "Native converter tensor reordering and FP32 norms apply; compare all checkpoints with the same backend settings."}
    temporary.rename(output)
    write_json(output.with_suffix(output.suffix + ".json"), metadata)
    print(f"BF16 GGUF ready: {output}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"GGUF preparation failed: {exc}") from exc
