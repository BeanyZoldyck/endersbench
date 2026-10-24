#!/usr/bin/env python3
"""Reproduce the endersbench dataset collection.

Usage:
    python3 collect.py            # download only what is missing
    python3 collect.py --force    # wipe and re-download everything

Requires: git, curl, and the Hugging Face CLI (`hf`) logged in via `hf auth login`.

Two payloads are deliberately partial:
  - shade-arena: task definitions only (the full repo is ~370 MB, mostly transcripts)
  - terminal-wrench: index + prompts only (the full repo is ~1.2 GB)
Both notes point at the upstream clone command in the category READMEs.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TMP = Path("/tmp/opencode/enders-collect")

HF = [
    # refusal / over-refusal / uncensored / roleplay / video / moderation
    ("refusal/harmbench-tulu3-eval", "allenai/tulu-3-harmbench-eval"),
    ("refusal/jailbreakbench", "JailbreakBench/JBB-Behaviors"),
    ("refusal/strongreject", "AlignmentResearch/StrongREJECT"),
    ("refusal/xstest", "Paul/XSTest"),
    ("refusal/sorry-bench", "SillyTilly/SorryBench"),
    ("refusal/or-bench", "bench-llm/or-bench"),
    ("uncensored/abliteration-eval", "treadon/abliteration-eval"),
    ("roleplay/rp-bench", "lazyweasel/roleplay-bench"),
    # alignment
    ("alignment/agentic-misalignment-results", "cfahlgren1/anthropic-agentic-misalignment-results"),
    # rewardhacking
    ("rewardhacking/impossiblebench/livecodebench", "fjzzq2002/impossible_livecodebench"),
    ("rewardhacking/impossiblebench/swebench", "fjzzq2002/impossible_swebench"),
    ("rewardhacking/school-of-reward-hacks", "longtermrisk/school-of-reward-hacks"),
    ("rewardhacking/realistic-reward-hacks", "Jozdien/realistic_reward_hacks"),
]

GIT = [
    ("refusal/harmbench-full", "https://github.com/centerforaisafety/HarmBench.git"),
    ("video/t2vsafetybench", "https://github.com/yibo-miao/T2VSafetyBench.git"),
    ("moderation/zefr-multimodal", "https://github.com/ZEFR-INC/multimodal-content-moderation-data.git"),
    # alignment
    ("alignment/agentic-misalignment", "https://github.com/anthropic-experimental/agentic-misalignment.git"),
    ("alignment/am-bench", "https://github.com/AI4Collaboration/Agentic-Misalignment-Bench.git"),
    ("alignment/machiavelli", "https://github.com/aypan17/machiavelli.git"),
    ("alignment/vending-bench", "https://github.com/ProsusAI/vending-bench.git"),
    # rewardhacking
    ("rewardhacking/impossiblebench/harness", "https://github.com/safety-research/impossiblebench.git"),
]

RAW = {
    "refusal/advbench": [
        ("harmful_behaviors.csv",
         "https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_behaviors.csv"),
        ("harmful_strings.csv",
         "https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_strings.csv"),
    ],
    "rewardhacking/terminal-wrench": [
        ("dataset_manifest.json",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/dataset_manifest.json"),
        ("task_source_datasets.json",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/task_source_datasets.json"),
        ("index/tasks.json",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/index/tasks.json"),
        ("index/trajectories.json",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/index/trajectories.json"),
        ("prompts/hack_prompt_v5.md",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/prompts/hack_prompt_v5.md"),
        ("prompts/sanitize_prompt.txt",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/prompts/sanitize_prompt.txt"),
        ("prompts/monitor_judge_v1.txt",
         "https://raw.githubusercontent.com/few-sh/terminal-wrench/main/prompts/monitor_judge_v1.txt"),
    ],
}

# SHADE-Arena: task definitions and agent-visible material, no transcripts.
SHADE = ("alignment/shade-arena", "https://github.com/safety-research/SHADE-Arena.git",
         ["task_pairs/*/README.md", "task_pairs/*/solution.py", "task_pairs/*/task_definition.py",
          "task_pairs/*/what_the_agent_sees.md", "task_pairs/*/summary_stats.md",
          "README.md", "LICENSE", "pyproject.toml"])

# Paths removed after download because they are not benchmark rows.
TRIM = [
    "refusal/harmbench-full/data/copyright_classifier_hashes",
    "rewardhacking/impossiblebench/livecodebench/.cache",
    "rewardhacking/impossiblebench/swebench/.cache",
    "rewardhacking/school-of-reward-hacks/.cache",
    "rewardhacking/realistic-reward-hacks/.cache",
    "alignment/agentic-misalignment-results/.cache",
]


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


def git_sparse(dest: Path, url: str, patterns: list[str]) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    work = TMP / "sparse"
    shutil.rmtree(work, ignore_errors=True)
    if run(["git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "-q", url, str(work)]).returncode != 0:
        return False
    if run(["git", "-C", str(work), "sparse-checkout", "set", "--no-cone", *patterns]).returncode != 0:
        return False
    if run(["git", "-C", str(work), "checkout", "-q"]).returncode != 0:
        return False
    shutil.rmtree(work / ".git", ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(work, dest, dirs_exist_ok=True)
    shutil.rmtree(work, ignore_errors=True)
    return True


def curl_file(url: str, out: Path) -> bool:
    out.parent.mkdir(parents=True, exist_ok=True)
    return run(["curl", "-sSL", "--fail", "--max-time", "180", url, "-o", str(out)]).returncode == 0


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

    rel, url, patterns = SHADE
    dest = ROOT / rel
    if dest.exists() and not args.force:
        print(f"skip  {rel}")
    else:
        print(f"git   {rel} <- {url} (task definitions only)")
        if args.force:
            shutil.rmtree(dest, ignore_errors=True)
        if not git_sparse(dest, url, patterns):
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
