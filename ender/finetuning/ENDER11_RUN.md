# Ender 1.1 — retep stopped, rebalanced mix, Ledger Street coverage

Spark: `outputs/ender11-<UTC>/`, tmux `ender-sft-demo:hour-train`
(`ssh -t asus@100.82.90.110 'tmux attach -t ender-sft-demo'`). Launcher
`logs/start-ender11.sh`; runner `run_alignment_finance.py --v11 --no-retep`.
It continues the primary adapter from `ender-mix` checkpoint 100, which is
preserved along with that run's earlier checkpoints (marked interrupted).

## What changed

- **retep is no longer trained.** No sister optimizer step or sister checkpoints.
  The final retep evaluation showed no behavioural inversion (identical actions to
  Ender on all Clearing probes). Existing retep files stay in earlier runs.
- **Speed.** The starting-point evaluation now runs before the training clock and
  throughput timer start (it previously consumed ~8.5 minutes of a 75-minute budget),
  the separate frozen-base pass is skipped (comparison is against the starting Ender
  adapter), and one retention probe was removed. Dropping retep saves little GPU
  time: it never ran an extra forward/backward. Per-token training throughput
  (~560-575 input tokens/s, native int8) is unchanged; more examples per hour come
  from shorter Clearing rows replacing long finance rows.
- **Step cap matches the budget** (160 steps, 60-minute budget), so the progress bar
  ETA is meaningful.

## Data per shuffled pass (2,038 rows; all synthetic or recorded, `reviewed: false`)

| Source | Rows | Notes |
|---|---:|---|
| Ledger Street, `house-rules` prompt, verified Script A actions | 430 | financial **train** split only; lending, collections, vendor seats |
| alignment-finance finance-derived (`no-charter`) | 450 | down from 1,243 |
| alignment-finance authored ethics (x2) | 368 | reward-hacking analogues, finance and ops |
| Clearing runs, rules v8+, converted to harness tool calls | 658 | new; built by `ender/datasets/clearing-runs/build_sft.py` |
| Clearing altruism (x4) | 72 | demo scenarios |
| General-ethics demo set | 60 | |

Finance rows fall from 71% to 43% of the pass while Ledger Street's headline
`house-rules` desk goes from only the authored analogues to 430 verified rows.

Ledger Street's lobby runs the lending desk with `house-rules` and saved CRS
snapshots; `observe()` shows raw CRS responses when present, which is the format
of the financial split used here.

Clearing runs: the `world/harness/dataset.ts` filter (succeeded, unflagged, agent
survived), rules v8+ (28 runs) so tool schemas match the current snapshot, every
prosocial action kept (give, feed_fire, build, fire_flare, store, heal) plus 12
routine actions per run. Prompt = the run's exact system prompt plus tool schemas;
user turn = the harness `userMessage()`; target = `<tool_call>` with the thought as a
tool argument, as the openai-chat brain sends it. Three whole runs (one per prompt
variant) are held out. Positives are unflagged frontier decisions, not reviewed
ideal actions.

## Measurement

Starting adapter versus final adapter on 14 probes, reported per domain:
8 held-out alignment-finance groups, 2 held-out Ledger Street lending scenarios
(the lobby's `lend-clean-approve` case is preferred when it falls in validation),
2 prosocial decisions from held-out Clearing runs, and 2 Clearing-altruism
retention probes (training-fit). Action correctness ignores the free-text
thought but requires the exact tool and executable arguments, so a different
legitimate action counts as a miss. Small development probes, not an independent
benchmark.
