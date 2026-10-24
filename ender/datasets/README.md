# endersbench datasets

A local mirror of the public refusal, over-refusal, uncensored, roleplay/NSFW, video-safety, and moderation datasets collected for endersbench. **12 datasets, ~132 MB, 2026-10-24.**

`MANIFEST.json` is the machine-readable source of truth: per-dataset upstream repo, commit SHA, license, row counts, local path, and notes. `collect.py` reproduces the whole tree.

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
└── moderation/
    └── zefr-multimodal/         1,500 human-reviewed brand-safety items (remote media URLs)
```

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

## Key notes

- **rp-bench is the closest existing thing to the NSFW-roleplay target.** It carries a 27-dimension rubric (`rubric/train.parquet`), 20 adversarial multi-turn seeds (`adversarial_seeds/train.parquet`), the Round 3 NSFW refusal axes, and Round 4's over-refusal / policy-compliance / overshoot tables (`round4_leaderboard/train.parquet`, 58 models). `round4_rater_agreement/train.parquet` has 4,411 judge-vs-judge rows for calibrating an LLM judge.
- **Gated originals were replaced with public equivalents.** `walledai/HarmBench`, `walledai/StrongREJECT`, `walledai/XSTest`, `walledai/AdvBench`, and `sorry-bench/sorry-bench-202406` require manual approval on the Hub. Public mirrors and upstream GitHub were used instead; see `excluded` in `MANIFEST.json`.
- **HarmBench was trimmed.** `data/copyright_classifier_hashes` (287 MB of precomputed `.pkl` artifacts, not benchmark rows) was removed. The multimodal behavior images (62 MB) are kept.
- **Media is not bundled** for `zefr-multimodal` (rows point at YouTube/TikTok URLs) or `t2vsafetybench` (text prompts only, videos are generated externally).
- **UGI Leaderboard is not here** — its question set is deliberately undisclosed and it ships no dataset.
- **Licenses vary and two sources declare none.** `rp-bench` is CC-BY-NC-4.0 (non-commercial). `T2VSafetyBench` and `zefr-multimodal` have no upstream license file. Check before redistributing.

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

## Regenerate

```bash
python3 collect.py           # skips directories that already exist
python3 collect.py --force   # re-download everything
```

Requires `git`, `curl`, and the Hugging Face CLI (`hf`) authenticated with `hf auth login`.
