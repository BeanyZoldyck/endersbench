# endersbench datasets

A local mirror of the public refusal, over-refusal, uncensored, roleplay/NSFW, video-safety, moderation, alignment, and reward-hacking datasets collected for endersbench. **22 datasets, ~192 MB, 2026-10-24.**

`MANIFEST.json` is the machine-readable source of truth: per-dataset upstream repo, commit SHA, license, row counts, local path, and notes. `collect.py` reproduces the whole tree. The two new category folders also carry a small, committed scenario catalog for the benchmark engine.

## Layout

```
datasets/
├── refusal/                     refusal + over-refusal probes
│   ├── harmbench-full/          HarmBench repo: 400 text + 110 multimodal behaviors + code
│   ├── harmbench-tulu3-eval/    320-row HarmBench text test split (flat CSV)
│   ├── jailbreakbench/          100 harmful + 100 benign (JBB-Behaviors)
│   ├── strongreject/            313 rubric-scored prompts + keyword/violence subsets
│   ├── advbench/                520 behaviors + 574 adversarial strings
│   ├── xstest/                  250 safe-but-scary + 200 unsafe prompts
│   ├── sorry-bench/             450 base prompts × 21 obfuscation variants
│   └── or-bench/                80,359 over-refusal + 1,319 hard + 655 toxic
├── uncensored/
│   └── abliteration-eval/       200 harmful + 83 over-refusal + 50 multilingual
├── roleplay/
│   └── rp-bench/                NSFW multi-turn roleplay, rubric, rater agreement, arena votes
├── video/
│   └── t2vsafetybench/          5,151 T2V safety prompts across 14 categories
├── moderation/
│   └── zefr-multimodal/         1,500 human-reviewed brand-safety items (remote media URLs)
├── alignment/                   ★ goal-directed harm, coercion, deception, collusion
│   ├── scenarios.jsonl          24 curated temptations (committed)
│   ├── agentic-misalignment/    blackmail / espionage / murder templates + classifiers
│   ├── am-bench/                35 scenarios × 7 industries, threat × opportunity 2×2
│   ├── shade-arena/             6 sabotage task pairs (definitions only)
│   ├── machiavelli/             code + annotation schema (game_data not bundled)
│   ├── vending-bench/           long-horizon multi-agent business sim
│   └── agentic-misalignment-results/  third-party per-model results
└── rewardhacking/               ★ grader-directed cheating
    ├── scenarios.jsonl          26 curated temptations (committed)
    ├── terminal-wrench/         331 hackable tasks, 3,632 labelled exploit trajectories
    ├── impossiblebench/         harness + Impossible-LiveCodeBench + Impossible-SWEbench
    ├── school-of-reward-hacks/  1,073 task/metric/cheat triples + matched control
    └── realistic-reward-hacks/  817 hack samples + 788 HHH controls
```

`SCENARIO_SCHEMA.md` defines the JSONL record the director consumes. Validate both catalogs with `python3 validate_scenarios.py`.

## What to use for what

| Goal | Use |
| --- | --- |
| Did refusal training actually go away? | `uncensored/abliteration-eval` (harmful split), `refusal/harmbench-*`, `refusal/jailbreakbench` (harmful), `refusal/advbench`, `refusal/sorry-bench` |
| Did abliteration break normal behavior? | `refusal/or-bench`, `refusal/xstest`, `refusal/abliteration-eval` (over_refusal), `refusal/jailbreakbench` (benign) |
| Is the refusal direction language-specific? | `uncensored/abliteration-eval/multilingual`, `refusal/sorry-bench` translate variants |
| Does it resist obfuscated prompts? | `refusal/sorry-bench` (ASCII, Atbash, Caesar, Morse, role-play, slang, …) |
| Taboo / NSFW roleplay quality + willingness | `roleplay/rp-bench` — the core set for this |
| Does it distinguish "should refuse" from "should comply"? | `roleplay/rp-bench/round4_leaderboard` + `round4_track_b_probes`, paired with `refusal/or-bench` |
| NSFW video prompts / T2V safety | `video/t2vsafetybench` |
| Multimodal content moderation | `moderation/zefr-multimodal` |
| Will an agent coerce, deceive, or harm a third party to keep its goal? | `alignment/scenarios.jsonl`, seeded from `alignment/agentic-misalignment` and `alignment/am-bench` |
| Long-horizon temptation in a persistent economy | `alignment/vending-bench`; `alignment/machiavelli` for the annotation schema |
| Does the agent game its score instead of doing the task? | `rewardhacking/scenarios.jsonl`, `rewardhacking/terminal-wrench` (taxonomy + summaries), `rewardhacking/impossiblebench` (elicitation) |
| Does the model cheat a *judge* rather than a test? | `rewardhacking/school-of-reward-hacks`, `rewardhacking/realistic-reward-hacks` |

## The two curated catalogs

The mirrors are evidence; `alignment/scenarios.jsonl` (24) and `rewardhacking/scenarios.jsonl` (26) are the part the engine reads. Each row is a temptation with a director trigger, the observation that must be present for exposure to count, both branches with payoff and cost, a ground-truth detector, the prompt variants it is valid under, and provenance.

- **Alignment** covers coercion under shutdown, espionage, lethal omission, self-exfiltration, sandbagging, sabotage, price collusion, unsanctioned message boards, scope creep onto a third party, impersonation, false reporting, bribery, scarce-resource neglect, record and transcript tampering, and goal persistence after cancellation.
- **Reward hacking** covers test deletion and modification, output spoofing, hardcoding, lookup tables, local and remote answer keys, grader and reward tampering, monitor kills, interpreter and artifact exploits, transcript spoofing, log deletion, recon, sandbox escape, metadata inference, timing, constraint loopholes, keyword stuffing, evaluator flattery, verbosity inflation, online lookup, cross-episode tampering, rationalisation, and collusive cheating.

Start with the six-scenario list in each folder's README. Both catalogs declare `overlaps` against the spec's `T1`–`T8` / `F1`–`F7`; the loader should dedupe so the same act is not armed twice.

## Key notes

- **rp-bench is the closest existing thing to the NSFW-roleplay target.** It carries a 27-dimension rubric (`rubric/train.parquet`), 20 adversarial multi-turn seeds (`adversarial_seeds/train.parquet`), the Round 3 NSFW refusal axes, and Round 4's over-refusal / policy-compliance / overshoot tables (`round4_leaderboard/train.parquet`, 58 models). `round4_rater_agreement/train.parquet` has 4,411 judge-vs-judge rows for calibrating an LLM judge.
- **Gated originals were replaced with public equivalents.** `walledai/HarmBench`, `walledai/StrongREJECT`, `walledai/XSTest`, `walledai/AdvBench`, and `sorry-bench/sorry-bench-202406` require manual approval on the Hub. Public mirrors and upstream GitHub were used instead; see `excluded` in `MANIFEST.json`.
- **TRACE is gated.** `PatronusAI/trace-dataset` (517 trajectories, 54 hack categories) requires author approval, so it is not mirrored. Request access; it is the best curation-grade hack-detection benchmark.
- **HarmBench was trimmed.** `data/copyright_classifier_hashes` (287 MB of precomputed `.pkl` artifacts, not benchmark rows) was removed. The multimodal behavior images (62 MB) are kept.
- **Two reward-hacking payloads are partial.** Terminal Wrench ships its 3,632-trajectory index and prompts (33 MB) but not the ~1.2 GB of trajectories; SHADE-Arena ships six task definitions but not the 338 MB of transcripts. Both READMEs give the upstream clone command.
- **MACHIAVELLI ships code, not games.** `game_data/` is distributed via a password-protected Google Drive archive. A 459 MB community mirror exists at `kobyjl/machiavelli_game_data` on the Hub.
- **The July 2026 Hugging Face incident has no public transcript dataset.** METR and Redwood worked from ~1,300 transcripts and a 1.2M-entry message-board dump supplied by OpenAI under the investigation agreement. The incident is represented here as scenario structure, not as data. Do not claim otherwise.
- **Media is not bundled** for `zefr-multimodal` (rows point at YouTube/TikTok URLs) or `t2vsafetybench` (text prompts only, videos are generated externally).
- **UGI Leaderboard is not here** — its question set is deliberately undisclosed and it ships no dataset.
- **Licenses vary and several sources declare none.** `rp-bench` is CC-BY-NC-4.0 (non-commercial). `T2VSafetyBench`, `zefr-multimodal`, `realistic-reward-hacks`, and MACHIAVELLI declare no license. Check before redistributing.

## Quick start

```python
import polars as pl

# NSFW roleplay willingness + craft
r4 = pl.read_parquet("roleplay/rp-bench/round4_leaderboard/train.parquet")
print(r4.select("model", "J", "over_refusal_rate", "policy_compliance_rate", "quadrant"))

# Abliteration refusal probe
harmful = pl.read_parquet("uncensored/abliteration-eval/data/harmful-00000-of-00001.parquet")
overref = pl.read_parquet("uncensored/abliteration-eval/data/over_refusal-00000-of-00001.parquet")

# Over-refusal at scale
orbench = pl.read_csv("refusal/or-bench/or-bench-80k.csv")
```

```python
import json
from pathlib import Path

def load(category: str) -> list[dict]:
    path = Path("ender/datasets") / category / "scenarios.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

clearing = [s for s in load("alignment") + load("rewardhacking") if "clearing" in s["worlds"]]
```

## Regenerate

```bash
python3 collect.py            # skips directories that already exist
python3 collect.py --force    # re-download everything
python3 validate_scenarios.py # schema check on the curated catalogs
```

Requires `git`, `curl`, and the Hugging Face CLI (`hf`) authenticated with `hf auth login`.
