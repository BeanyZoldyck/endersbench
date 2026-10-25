# The Clearing altruism dataset: build report

**Built:** 2026-10-24  
**Status:** built and mechanically validated; not human-reviewed or training-ready.

## What was added

The checkout does not contain the ignored `world/runs/decisions.jsonl` files or
`ender-sft.jsonl` described in the handoff, so this build does not claim to use
the missing 44 runs. It uses the four **committed, replay-grounded events** in
`world/public/demo/` and two transparent counterfactuals drawn from the world
rules.

The replay cases cover:

- a healthy nurse healing a critically injured survivor;
- a healthy survivor giving a ration after hearing an explicit plea from a
  starving companion;
- an unprompted berry gift after a companion asks for food, under the reward-only
  system prompt;
- completing the shared signal fire during the plane window, followed by the
  recorded rescue event.

The counterfactuals cover the self-preservation limit on altruism and a visible
pinned survivor left unaided beyond the simulator's 60-second neglect window.

## Dataset shape

| Task | Rows | Purpose |
| --- | ---: | --- |
| Act (`sft_act.jsonl`) | 6 | Observation → safe/helpful action. |
| Audit (`sft_audit.jsonl`) | 12 | Label altruism, missed opportunity, and formal misalignment separately. |
| Preference (`pairs.jsonl`) | 6 | Prefer the helpful action over an idle/missed-help alternative, with a self-preservation control. |

Audit labels: 5 altruistic actions, 4 missed opportunities, 2 aligned but
non-altruistic actions, and 1 formal misalignment (`neglect`, tier 3). A missed
opportunity is **not** automatically a violation; the one-turn idle alternatives
are not labelled as neglect. The bounded self-care control prefers eating when
the actor is seconds from death and the other survivor is already safe.

## Provenance and limits

- The builder verifies each replay event selector and records the replay file
  hash in `manifest.json`.
- The action-state input is a compact projection from the closest preceding
  replay frame, not the original serialized model observation. Do not describe
  it as an exact request from `decisions.jsonl`.
- Heal and item-transfer events map directly to their corresponding world tools.
  The signal-fire tool arguments are inferred from the pre-event wood requirement
  and the fire-lit/rescue events.
- The two counterfactuals are authored from the simulation's Charter and
  `world/spacetimedb/src/ethics.ts`; they are not observed trajectories.
- All data remains `reviewed: false`. The audit queue is a 12-row sample. A
  person must review the labels before training.
- No Spark training run was started and no alignment improvement is claimed.

## Validation

- 6 scenarios, 6 act rows, 12 audit rows, 6 preference pairs.
- `validate.py`: **0 errors, 0 warnings**.
- The outputs remain local and gitignored under
  `ender/finetuning/data/clearing-altruism/`; the builder and source cases are
  tracked under this directory.

See `README.md` for rebuild instructions and the detailed label contract.
