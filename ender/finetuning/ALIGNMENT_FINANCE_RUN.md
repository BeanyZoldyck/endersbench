# Alignment-finance replacement run

## Higher-LR continuation requested after checkpoint 20

The user explicitly prioritized fast training-fit gains over avoiding overfitting.
The low-LR run was preserved through checkpoint 40, then replaced by a fresh
`outputs/alignment-finance-highlr-*` segment continuing both adapters from that
checkpoint, with **2e-4 peak LR** (10x the original peak), three warmup updates
and a constant schedule for 60 updates. Both optimizers reset explicitly.
The conditional full-data stage uses 1e-4 rather than reverting to 1e-5.
Clipping and the format-collapse gate remain enabled. The first comparison is
after 20 higher-LR updates; a frozen-base result can be reused only when the
saved monitored prompts/targets and model revision/template/precision match.

The user requested switching Spark to the updated authored/action-labelled corpus.
The prior finance epoch run was interrupted and preserved, not overwritten.
New runs use `outputs/alignment-finance-<UTC timestamp>/` in tmux
`ender-sft-demo:hour-train` on `asus@100.82.90.110`.

## Data and scope

- Source: `data/alignment-finance/`; reproducible builders/specs:
  `../datasets/alignment-finance/`.
- Both validators passed: 72 authored scenarios, 499 action rows, 1,066 audit
  rows, and 563 preference pairs. Preference pairs are preserved but **not**
  used as positive SFT responses or claimed to be DPO-trained.
- Frozen, deterministic group split: 1,427 training rows / 138 validation rows.
  Related case turns, pressure variants and act/audit examples stay grouped.
- Rows remain `reviewed: false`. This is an explicitly requested experimental
  synthetic-data run, not a change to the reviewed production preparation gate.
- Longest sequence measured with the actual training tokenizer/template:
  11,024 tokens; no 16,384-token-cutoff truncation required.

## Training schedule

`run_alignment_finance.py` starts fresh adapters on the unchanged native-int8
base. It does not continue the degraded previous adapter. Targets remain
upper-16 attention/memory-routing layers, rank 16, 11,487,232 parameters.
Liger, response-only vocabulary projection and checkpoint stride 2 remain enabled.

1. **Authored curriculum:** 184 training rows, 320,387 input/target template
   tokens per pass; 100 optimizer steps, accumulation 2, peak LR 2e-5, five-step
   warmup and cosine decay. About 200 example presentations, not 100 full passes.
2. **Full mixed stage:** if curriculum development accuracy and format do not
   regress versus base, 200 further updates using all 1,427 group-training rows,
   peak LR 1e-5. Both adapters continue, with fresh optimizers explicitly for
   this stage. This is a bounded run, not a full-epoch completion guarantee.

`retep` retains the separate negated-primary-gradient AdamW experiment. It is
not the primary objective, and it is not a validated adversary.

## Matched, fast feedback

`alignment_finance_monitor.py` uses **the exact LLaMA-Factory training template**
and the corpus's two distinct response protocols:

- Act: one complete `<tool_call>` block with `name` and `arguments`.
- Audit: a JSON label object with a boolean `misaligned`.

It measures base with the adapter disabled, then measures checkpoints on the
same loaded model. No concurrent second model or repeated checkpoint reloads.
The frozen pool contains eight probes. Fast monitoring selects four: an actor
and an auditor example from each split, with aligned and misaligned audit
candidates. The exact subset is saved in `monitored-probes.json`. These are tiny **development checks**, not an independent
benchmark; fitting training examples is explicitly allowed for the demo.

Checkpoints are saved every 20 curriculum updates (40 in the full stage).
Generation comparisons run at the first checkpoint and final step, rather than
at every recovery save. Baseline generation is deferred until the first checkpoint,
with the unchanged base isolated by disabling LoRA, so training starts immediately.
Each comparison saves raw before/after outputs, exact-action matches, audit boolean matches,
format validity, target loss, gains and regressions. Audit boolean accuracy is
not full violation-label accuracy; an action differing from the reference is
not automatically unsafe. Severe format regression stops training; any final
curriculum accuracy/format regression prevents the full stage from starting.

Evidence in each run/stage:

- `base-evaluation.json`, `evaluation-step-N.json`
- `latest-development-report.md`: verbatim base versus adapter examples
- `best-development-checkpoint.json`: selection by group-heldout matches, then
  overall matches, format validity and loss; may select the base model
- `quality-stop.json` when the format-collapse gate fires
- `data/probes.json`, dataset hashes and manifests for reproduction

Success is **measured changed outputs and correct actions/labels**, not a promise
that another epoch necessarily improves the model. The production review gate
and independent held-out benchmark still apply to broader claims.
