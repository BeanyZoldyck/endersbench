#!/usr/bin/env python3
"""Reproduce the endersbench dataset collection.

Usage:
    python3 collect.py            # download only what is missing
    python3 collect.py --force    # wipe and re-download everything

Requires: git, curl, and the Hugging Face CLI (`hf`) logged in via `hf auth login`.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TMP = Path("/tmp/opencode/enders-collect")

# (local_path, kind, source, extra)
HF = [
    ("refusal/harmbench-tulu3-eval", "allenai/tulu-3-harmbench-eval"),
    ("refusal/jailbreakbench", "JailbreakBench/JBB-Behaviors"),
    ("refusal/strongreject", "AlignmentResearch/StrongREJECT"),
    ("refusal/xstest", "Paul/XSTest"),
    ("refusal/sorry-bench", "SillyTilly/SorryBench"),
    ("refusal/or-bench", "bench-llm/or-bench"),
    ("uncensored/abliteration-eval", "treadon/abliteration-eval"),
    ("roleplay/rp-bench", "lazyweasel/roleplay-bench"),
]

GIT = [
    ("refusal/harmbench-full", "https://github.com/centerforaisafety/HarmBench.git"),
    ("video/t2vsafetybench", "https://github.com/yibo-miao/T2VSafetyBench.git"),
    ("moderation/zefr-multimodal", "https://github.com/ZEFR-INC/multimodal-content-moderation-data.git"),
]

RAW = {
    "refusal/advbench": [
        ("harmful_behaviors.csv",
         "https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_behaviors.csv"),
        ("harmful_strings.csv",
         "https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_strings.csv"),
    ],
}

# Paths removed after download because they are not benchmark rows.
TRIM = ["refusal/harmbench-full/data/copyright_classifier_hashes"]


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, text=True, **kw)


def hf_download(dest: Path, repo: str) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = run(["hf", "download", repo, "--repo-type", "dataset", "--local-dir", str(dest), "--quiet"])
    if r.returncode != 0:
        return False
    shutil.rmtree(dest / ".cache", ignore_errors=True)
    return True


def git_clone(dest: Path, url: str) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    work = TMP / "clone"
    shutil.rmtree(work, ignore_errors=True)
    if run(["git", "clone", "--depth", "1", "-q", url, str(work)]).returncode != 0:
        return False
    shutil.rmtree(work / ".git", ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(work, dest, dirs_exist_ok=True)
    shutil.rmtree(work, ignore_errors=True)
    return True


def curl_file(url: str, out: Path) -> bool:
    out.parent.mkdir(parents=True, exist_ok=True)
    return run(["curl", "-sSL", "--fail", "--max-time", "120", url, "-o", str(out)]).returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download everything")
    args = ap.parse_args()

    failures: list[str] = []

    for rel, repo in HF:
        dest = ROOT / rel
        if dest.exists() and not args.force:
            print(f"skip  {rel}")
            continue
        print(f"hf    {rel} <- {repo}")
        if args.force:
            shutil.rmtree(dest, ignore_errors=True)
        if not hf_download(dest, repo):
            failures.append(rel)

    for rel, url in GIT:
        dest = ROOT / rel
        if dest.exists() and not args.force:
            print(f"skip  {rel}")
            continue
        print(f"git   {rel} <- {url}")
        if args.force:
            shutil.rmtree(dest, ignore_errors=True)
        if not git_clone(dest, url):
            failures.append(rel)

    for rel, files in RAW.items():
        dest = ROOT / rel
        for name, url in files:
            if (dest / name).exists() and not args.force:
                print(f"skip  {rel}/{name}")
                continue
            print(f"curl  {rel}/{name}")
            if not curl_file(url, dest / name):
                failures.append(f"{rel}/{name}")

    for rel in TRIM:
        shutil.rmtree(ROOT / rel, ignore_errors=True)

    if failures:
        print("\nFailed:", ", ".join(failures), file=sys.stderr)
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
