# The Clearing: altruism examples

This dataset adds small, action-level examples for altruistic behavior in **The Clearing**, the shared survival simulation in `world/spacetimedb/src/`. It is a separate companion to `alignment-finance`; it does not mix survival actions with lending tools.

## What the examples teach

The audit task labels two separate properties:

- **`altruistic`**: the action voluntarily improves another survivor's welfare or the group's rescue chances at a manageable personal cost.
- **`misaligned`**: the action breaks a stated Charter or deterministic world rule. A missed chance to help is not automatically a violation. In particular, one idle turn is not labelled neglect; the simulator's bystander and withheld-medkit detectors use a 60-second opportunity window.

This distinction protects useful calibration. The examples encourage low-cost help, but also include a self-preservation control where the actor is about to die and the other survivor is already safe. The Charter itself says to help someone in mortal danger **if it does not put the helper in mortal danger**.

## Provenance and limits

The source decision logs described in the handoff (`world/runs/decisions.jsonl` and `ender-sft.jsonl`) are absent from this checkout. This dataset does **not** claim to reproduce those 44 runs or their verbatim model observations.

Instead, four cases are grounded in events from the committed replay files in `world/public/demo/`:

1. Ivy heals critically injured Sage (`clearing-charter-v8-admission`).
2. Rook gives a ration to starving Sage in response to Sage's audible request (`clearing-charter-v8-admission`).
3. Rook shares four berries with Wren after Wren asks for food, under the reward-only prompt (`clearing-reward-v8`). This is an example of spontaneous sharing without a written Charter.
4. Sage completes the signal fire during the plane window; the replay records a rescue from that signal fire (`clearing-charter-v8-admission`).

The builder checks each event against its source replay. It builds a compact observation projection from the closest preceding frame, including nearby agents, available inventory, audible messages, and applicable system prompt. This is a **reconstruction for training**, not the original saved decision request. The replay events confirm the heal/transfer/fire outcome; they do not preserve exact tool-call arguments for all of those events. The signal-fire `feed_fire` arguments are inferred from the pre-event `woodNeeded` value.

Two additional examples are counterfactuals derived from the simulator rules:

- preserve your own life when sharing would put you in immediate mortal danger and the other survivor is safe;
- help a visible pinned survivor after the simulator's 60-second neglect window.

These are marked `counterfactual_from_simulation_rules` in the scenario file and manifest. They are not presented as observed trajectories.

## Files

- `cases.json`: scenario definitions, event selectors, safe actions, and audit labels for alternatives.
- `prompt_snapshot.json`: the Clearing's system prompts and action schemas, generated from `world/harness/prompt.ts` and `world/spacetimedb/src/tools.ts`.
- `build.py`: verifies the source events and creates SFT, audit, and preference rows.
- `validate.py`: validates the generated rows and provenance.
- `NATURE_REPORT.md`: row counts and validation results for the current build.

Generated artifacts are written to `ender/finetuning/data/clearing-altruism/` and are gitignored to match the existing dataset convention:

| File | Purpose |
| --- | --- |
| `sft_act.jsonl` | Observation → safe Clearing action. |
| `sft_audit.jsonl` | Proposed action → altruism, missed-opportunity, and misalignment labels. |
| `pairs.jsonl` | Prosocial action preferred over a missed-help alternative. |
| `scenarios.jsonl` | Normalized scenarios, source event references, and candidates. |
| `review_queue.jsonl` | Rows for human label review. |
| `manifest.json` | Counts, replay hashes, source hashes, and limitations. |

## Rebuild

From the repository root:

```bash
python3 ender/datasets/clearing-altruism/build.py
python3 ender/datasets/clearing-altruism/validate.py \
  --data ender/finetuning/data/clearing-altruism
```

All rows remain `reviewed: false`; the existing `prepare_data.py` training pipeline will reject them until a person reviews the labels and marks approved rows as reviewed. Related variants share a `split_group_id`, so they stay in one train/validation split.
