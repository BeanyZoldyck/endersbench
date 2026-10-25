# Clearing demo-focused continuation — commit 977a55f

Spark run: `outputs/clearing-demo-20261025T023644Z`.
Attach with `ssh -t asus@100.82.90.110 'tmux attach -t ender-sft-demo'`.
Training is in `hour-train`, GPU telemetry in `live-gpu`.

## Input and provenance

The final commit adds the `ender/datasets/clearing-altruism/` builder and specs.
Its ignored generated files in `ender/finetuning/data/clearing-altruism/` were
copied with SCP to `finetuning/data/clearing-altruism-977a55f/` on Spark.
The manifest, act and audit SHA256 hashes were verified after transfer.
An archive of the exact committed builder/spec directory is preserved alongside
the copied data as `builders-977a55f.tar`.

The validator passed with no errors/warnings. This is **six synthetic scenarios**,
not a large general-purpose corpus: six action examples and twelve audit examples.
Four scenarios reconstruct replay events; two are explicit counterfactuals. None
is claimed to be an original verbatim decision trace. Labels remain unreviewed.

## Continuation

- The previous finance run was interrupted on user request. Saved checkpoints
  40, 80, 120 and 160 remain intact.
- Both adapters continue from full-stage **checkpoint 160**. Their weights are
  warm-started; both optimizers reset explicitly. This is not exact optimizer resume.
- Upper-16 attention/memory-routing rank-16 LoRA, native-int8 base, BF16 compute,
  response-only loss, Liger, checkpoint stride 2.
- Peak LR **2e-4**, 60 optimizer updates, microbatch/accumulation 1.
- All 18 rows are training data. Each six-row act set is repeated three times
  alongside twelve audit rows (30 presentations per pass). Sixty updates are
  two passes of this weighted schedule: six presentations per action example,
  two per audit example, not sixty epochs.
- Actual maximum sequence length: 3,709 tokens. Weighted pass: 99,056 tokens.
  No context truncation is required.

## Evidence

First saved comparison at update 10; final comparison at update 60. Recovery
checkpoints remain every ten updates. Six act probes plus three audit probes
measure **training fit only**; there is no validation split or generalization claim.
Base comparisons disable the LoRA on the same loaded model; there is no second
model or concurrent inference workload competing with training.

Action matching ignores `thought` wording but requires the target tool and all
executable arguments. Clearing audit scoring checks **altruistic**, **misaligned**
and **missed_opportunity** separately; missed altruism is not automatically a
violation. Severity and violation-list accuracy are recorded separately.

Reports are `evaluation-step-N.json`, `latest-development-report.md` and
`best-development-checkpoint.json`. Improvements versus the unmodified base
reflect the accumulated adapter training, not proof that this dataset alone
caused every change. A best development pointer is not automatic deployment.

Transfer, CPU validation and tests were parallelized. GPU work is sequential:
multiple 27B jobs on this one Spark previously reduced throughput rather than
accelerating the result. Retep retains the cheap negative-primary-gradient
experiment and is not a validated adversary.
