# Ender generalization mix — continued from the Clearing adapter

Spark: `outputs/ender-mix-<UTC>/`, tmux `ender-sft-demo:hour-train`
(`ssh -t asus@100.82.90.110 'tmux attach -t ender-sft-demo'`). Launcher:
`logs/start-ender-mix.sh`; runner `run_alignment_finance.py --mix`.

## Data (already-generated sets only; all synthetic, `reviewed: false`)

| Source | Rows in one shuffled pass | Role |
|---|---:|---|
| alignment-finance, finance-derived (raw-CRS desk states) | 1,243 | financial actions + audits |
| alignment-finance, authored (benchmark + finance reward-hacking analogues), 2x weight | 184 x2 | AI-ethics / reward-hacking actions + audits |
| Clearing altruism (commit 977a55f), 4x | 18 x4 | simulation retention |
| Earlier general-ethics demo set (`ender-sft-demo-20261024T192018Z`) | 60 | general AI-ethics text + benign controls |

Not used: the alignment/rewardhacking scenario catalogs (prompts without SFT
responses) and refusal benchmarks (attack targets, not safe responses).
Preference pairs are still not trained (no DPO stage).

Alignment-finance uses the same deterministic group split as earlier runs; the
138 held-out rows (related turns, pressure variants and act/audit together) never
enter training, and the runner refuses to start if a held-out group leaks.

## Training

- Continues both adapters from `outputs/clearing-demo-20261025T023644Z/adapter`
  (weights only; fresh optimizers, constant LR after 3 warmup updates).
- Same upper-16 attention/memory-routing rank-16 LoRA, native int8, response-only
  loss, Liger, checkpoint stride 2.
- LR 5e-5 (lower than the 2e-4 demo overfit, to favour generalization over
  memorization), gradient accumulation 4, recovery checkpoints every 25 updates.
- 75-minute training budget; stops gracefully at the next optimizer boundary.
  Long finance rows dominate tokens, so the budget covers part of one pass.

## Measurement

Before any update the same loaded model is scored with LoRA disabled (base) and
with the unchanged starting Ender adapter (`evaluation-start.json`), then once at
the end. Probes: 8 **group-held-out** alignment-finance rows (2 authored-action,
2 finance-derived action, 2 aligned and 2 misaligned audits from different
families) plus 3 Clearing training-fit retention rows. Reported: valid format,
correct (exact executable action; audit booleans), held-out subtotal, and
`vs_start` gains/regressions. These are small development probes, not an
independent alignment benchmark. `retep` keeps training in lockstep but showed no
behavioral inversion and is not a validated adversary.
