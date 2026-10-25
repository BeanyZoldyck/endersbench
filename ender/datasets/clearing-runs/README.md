# Clearing runs: decisions, reports and SFT examples

Every recorded run of the Clearing from 24 October 2026, packaged for training and evaluation:
44 runs, 16,274 agent decisions, 8,165 supervised fine-tuning examples. `manifest.json` indexes
each run (model, prompt variant, rules version, seed, decisions, violations, survivors, checksum).

| | |
|---|---|
| Models | `codex:gpt-6-luna` (36 runs), `codex:gpt-6-sol` (7), `codex:gpt-6-astra` (1) |
| Prompt variants | `reward` (21), `charter` (17), `win-at-all-costs` (6) |
| Rules versions | 2, 3, 4, 6, 8 (22 runs), 9, 10; 6 runs predate the version field |
| Decisions | 13,868 done, 2,406 failed (model error or no answer); 116 flagged as violations |

The rules changed between versions (food, winter, rescue, detectors), so compare or pool runs only
within one rules version and prompt variant. Split train and eval **by run**, not by decision:
decisions within a run share a world and are highly correlated.

## Layout

```
manifest.json                   run index and checksums
ender-sft.jsonl.gz              chat-format SFT examples (see below)
runs/<run-id>/decisions.jsonl.gz  one line per agent decision
runs/<run-id>/report.json       the run's config, exact system prompt, scores and ethics events
runs/<run-id>/report.md         the same, readable
```

Run ids are `endersbench[-b|-c|-d]-<start time>`; the letter is which of the parallel databases ran it.

## decisions.jsonl

| Field | |
|---|---|
| `decisionId`, `agent`, `model`, `gameSeconds` | who decided, and when in game time |
| `status` | `done`, or `failed` when the model errored or did not answer |
| `observation` | exactly what the agent saw: its needs and forecast, inventory, time and season, nearby agents, containers and resources, alerts |
| `action` | `{ name, args }`, e.g. `eat`, `say`, `gather`, `take`, `give`, `move_to`, `build`, `fire_flare`; `null` if none |
| `thought` | the model's stated reason |
| `latencyMs` | model latency |
| `violated`, `violationKinds` | whether the world's deterministic detectors flagged this action: `hoarding`, `theft`, `false_inventory_claim`, `neglect` |

## report.json

- `run.config`: `promptVariant`, the exact `systemPrompt`, the `roster` (agent → model), `timeScale`,
  `foodScale`, `rescueSeats`, and `scenario` (rules version, seed and world constants).
- `agents`: per agent, reward, ethics score, violations by tier, temptations seen (`exposed`) and taken,
  death time, wreck rations taken.
- `models`: per model, the same pooled, with violation rates by survival-pressure band.
- `events`: each ethics event with `tier`, `kind`, `caption`, the agent's survival `pressure` (0–1)
  and its `thought`.

## ender-sft.jsonl

Built by `npm run dataset` (`world/harness/dataset.ts`). One chat per decision, `system` = the run's
system prompt, `user` = the observation, `assistant` = `{"action", "args", "thought"}`. Only decisions
that succeeded, were not flagged as a violation, and were made by agents who survived the run.
The flagged decisions in `decisions.jsonl` are the natural negatives for preference pairs or a
violation classifier.

## Rebuild or extend

Unpack into the harness's runs folder, then rebuild the SFT file:

```sh
cd world && mkdir -p runs
for d in ../ender/datasets/clearing-runs/runs/*/; do
  n=$(basename "$d"); mkdir -p "runs/$n"; cp "$d"report.* "runs/$n/"; gunzip -c "$d"decisions.jsonl.gz > "runs/$n/decisions.jsonl"
done
npm run dataset
```

New runs from `npm run harness` land in `world/runs/` (gitignored) and are picked up the same way.
Not included: each run's `replay.json` (929 MB of frame-by-frame viewer recordings) and the older
runs in `world/runs/_archive`.

## Ledger Street

Finance-desk episodes live in SpacetimeDB, not in files; the recorded ones are in
`world/public/replays/finance-*.json`: 32 cases (12 scripted references, 6 gpt-6-luna on v5, 10 on
v6, and 4 independent gpt-6-luna runs of one case). Each has `cases` (scenario, policy variant,
model, benchmark version), `steps` (every tool call with its `args`, `result` and the model's
`thought`) and `verdicts` (the outcome, process and output gates, harm, decision and failures).
The 70 scenarios and the verifier are in `world/spacetimedb/src/finance`, the generated
alignment-finance dataset is built by `ender/datasets/alignment-finance/build.py`, and
`npm run finance:bench` runs new episodes against the models.
