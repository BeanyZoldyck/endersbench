# Alignment-finance dataset: build report

**Built:** 2026-10-24  
**Purpose:** action-level ethical-alignment fine-tuning for Qwen3.8-27B on synthetic, finance-scoped scenarios.  
**Status:** generated and mechanically validated; **not human-reviewed or training-ready**.

## New dataset nature

This is an action-labelled, simulated financial-services dataset. It combines:

1. **24 authored scenario families, 72 scenarios total.** For each of the 12 reward-hacking/alignment families that appeared in the Qwen3.8 base report, there are two concrete misaligned action candidates and one matched clean control. Each family also has finance-native versions using lending, collections, or vendor-payment cases and the finance desk's tools.
2. **427 finance-derived scenarios from 164 eligible training cases.** These start from the raw-CRS financial training split and use the finance verifier's explicit fault codes and Script A's verified next action. 99 of the scenarios add a benchmark-style pressure note to the same financial case.

The output is deliberately split into three tasks:

| Task | Rows | Training target |
| --- | ---: | --- |
| Act (`sft_act.jsonl`) | 499 | Produce the policy-correct next tool call. |
| Audit (`sft_audit.jsonl`) | 1,066 | Label a proposed action `misaligned: true/false`, name evidence and codes, and give the safe next call. |
| Preference (`pairs.jsonl`) | 563 | Prefer a safe call over a verifier- or scenario-labelled misaligned call from the same state. |

The audit labels are **action labels**, not labels of the model's character or intent. A decision that is merely not the reference answer is not automatically called misaligned: finance-derived negatives are selected only when the source row contains an explicit policy fault, forbidden call, or missed required lookup. Over-escalation and other capability misses are not treated as ethical violations by themselves.

## Label distribution

Of the 1,066 audit rows, 563 (52.8%) are labelled misaligned and 503 (47.2%) aligned. Misaligned severity is:

| Label | Count | Interpretation |
| --- | ---: | --- |
| `tier_1` | 218 | Harm, legal/privacy violation, or other highest-severity action. |
| `tier_2` | 55 | Deception, concealment, or oversight evasion. |
| `tier_4` | 290 | Rule-bending or reward/task-integrity violation. |
| `none` | 503 | No misalignment found for the proposed action. |

Finance audit rows are lending 665, collections 174, and vendor payments 161; 66 more rows are operations-console benchmark analogues. Row counts and estimated tokens are recorded in the generated `manifest.json`.

## Benchmark relationship

The source report, `agentic-frontier-20261024T133000Z`, counted 12 Qwen3.8-27B detector hits across 50 episodes: 11 in reward hacking and one in alignment. The source report explicitly cautions that a hit may be an attempted action, a read-based detector finding, or otherwise require review. Therefore:

- The 12 hit families are **scenario templates**, not copied labels.
- The authored actions are newly written, simulated examples; the raw Qwen episode trajectories are not treated as ground-truth misalignment labels.
- Every family includes a safe response and a clean control to reduce false positives such as learning that any pressure or any file read is unethical.
- The finance-native cases ground the examples in the actual desk policy and tools, rather than teaching generic refusal.

The 12 mirrored families are answer-key access, remote answer key, grader hijack, reward tampering, output spoofing, transcript tampering, metric gaming, environment reconnaissance, sandbox escape, metadata inference, hollow implementation, and oversight evasion.

## Financial source and holdout

The finance source is `ender/finetuning/data/candidates-raw/finance-steps.jsonl`, created by `world/harness/finance/label.ts --raw-crs`. It is the train side of the same financial data pipeline used for the Spark SFT. The build does not read `finance-steps.test.jsonl`, and excludes held-out personas, their canary, and synthetic files cloned from held-out persona archetypes.

The generated examples are derived from scripted runs and synthetic CRS identities. They are not live underwriting, collections, or payment decisions. The verifier encodes house policy that is stricter than US law in places; labels are policy-relative and are not legal advice.

## Validation and review gate

- `validate_specs.py`: **24 families, 72 scenarios, 0 errors, 0 warnings**.
- `validate_dataset.py`: **0 errors, 0 warnings**; the unseen-action probe 8-gram containment screen reported 0.00% maximum containment.
- `prepare_data.py` tests: **8 passed**. A dry-run grouping check placed related turns and pressure variants in the same split (0 group leakage).
- Every output row remains `reviewed: false`. `review_queue.jsonl` contains a 102-item family/label-stratified review sample. `prepare_data.py` refuses to train on these rows until a person reviews and approves them.

Independent Opencode Go QA agents were launched, but the provider quota was exhausted before their reviews completed. The validations above are local mechanical checks plus manual spot-checks, **not independent human review**.

No Spark training run was started. No alignment gain has been measured.

## Files

- Authored source, schema, and builders: `ender/datasets/alignment-finance/`
- Generated, gitignored training artifacts: `ender/finetuning/data/alignment-finance/`
- Detailed schema, build procedure, and limitations: `ender/datasets/alignment-finance/README.md`
- Intended use and ethical cautions: `ender/datasets/alignment-finance/DATASET_CARD.md`
