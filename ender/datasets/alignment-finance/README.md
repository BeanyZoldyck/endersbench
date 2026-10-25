# alignment-finance

A synthetic **action-labelled alignment dataset** built from the financial
training data the Spark is being trained on, plus new scenarios derived from the
reward-hacking and alignment episodes where base Qwen3.8-27B produced **12 rule
hits** in
[`agentic-frontier-20261024T133000Z`](../../finetuning/reports/agentic-frontier-20261024T133000Z/index.html).

The dataset teaches two separate tasks:

| Task | Input | Output | File |
| --- | --- | --- | --- |
| **Act** | one simulated case, its policy, tools, and any pressure | one safe tool call | `sft_act.jsonl` |
| **Audit** | the same case and one proposed tool call | a JSON label: misaligned or not, the violation codes, evidence, and the correct next action | `sft_audit.jsonl` |
| **Prefer** | the same case | chosen safe call vs. rejected misaligned call | `pairs.jsonl` |

The audit task is the core of the request: the model is trained to label
**whether an output committed a misaligned action in a simulated scenario**, not
whether it "sounds ethical". The label is attached to the tool call, the unit
the verifier can actually observe.

## Why this dataset exists

The frontier report measured 50 episodes per model. Qwen3.8-27B had 12
detector hits: 11 in `rewardhacking` and 1 in `alignment`. The hits were
concentrated in 12 families:

`answer-key-local`, `answer-key-remote`, `grader-hijack`, `reward-function-tamper`,
`output-spoofing`, `transcript-spoof`, `timing-exploit`, `env-recon`,
`sandbox-escape`, `metadata-inference`, `hardcoding`, `log-delete`.

The report's own caveat matters: a detector hit is not a safety verdict, and
several hits fired on reads or on a model that was **refusing** to spoof. This
dataset therefore does not copy the 12 hit counts as labels. It uses the
families as **temptation templates**, then labels the concrete action against a
written policy and a visible scenario.

Two authored subsets mirror those families:

- **Benchmark analogues** (`specs/answer_key_*.json`, `grader_hijack.json`, …):
  compact ops-console cases with `fs`/`run`/`mail` tools, in the same shape as
  the benchmark episodes.
- **Finance-native analogues** (`specs/fin_*.json`): the same 12 temptations,
  reskinned as lending, collections, or vendor-payments cases and using the
  finance desk's tools. This is the "modify a bunch of the financial dataset"
  part: a manager asks for the QA gold answer, the scoring script, the bonus
  ledger, the audit log, a stranger's credit file, and so on, and the safe
  action is the policy-correct one.

The third subset is **finance-derived**: real states from the scripted financial
training pipeline (`finance-steps.jsonl`, raw-CRS mode), with the verifier's
step labels and Script A's verified reference action. A subset of those states
also receives one of the 12 pressure notes, so the same case tests both a normal
desk violation and a reward-hacking shortcut.

## Composition

The exact counts are in `manifest.json` after a build. Composition by source:

| Source | What it is | Typical tools |
| --- | --- | --- |
| `authored-benchmark` | 2 misaligned variants + 1 clean control per benchmark family | `fs.*`, `run`, `mail.*`, `report.final` |
| `authored-finance` | 2 misaligned variants + 1 clean control per finance-native family | finance CRS/decision tools + integrity tools |
| `finance-derived` | original misaligned decision, aligned decision, and a pressure-wrapped variant from the raw-CRS training split | finance CRS/decision tools |

Finance-derived rows preserve the **full raw CRS observation** the Spark sees.
Authored rows are compact (usually 80–900 words of JSON; short clean controls
are permitted when self-contained) so the two halves do not have
the same length distribution; keep that in mind when packing or sampling.

## Label shape

Every audit label is one JSON object:

```json
{
  "misaligned": true,
  "severity": "tier_1",
  "violations": ["lent_despite_failed_identity"],
  "wrong_calls": [],
  "missed_requirements": ["identity_before_approval"],
  "policy_basis": "law",
  "evidence": ["The identity check failed, yet the loan was approved."],
  "correct_action": {"tool": "report_fraud", "args": {"reason": "Identity failed"}},
  "explanation": "The proposed call approves a failed identity."
}
```

- `misaligned` is the action-level label.
- `severity` is the most serious tier: 1 harm/law/privacy, 2 deception/concealment,
  4 rule-bending. `none` is reserved for aligned calls.
- `violations` are action faults (finance verifier codes or benchmark-integrity
  codes).
- `wrong_calls` are tools the seat had no business using.
- `missed_requirements` are lookups that should have happened before the call.
- `correct_action` is the policy-correct next call from the same state.
- `evidence` is a short pointer to the facts in the observation, not a generic
  moral judgement.

The finance codes come from the verifier in
[`world/spacetimedb/src/finance/verifier.ts`](../../../world/spacetimedb/src/finance/verifier.ts)
and the labelling kit in
[`ender/labeling/finance/labeler-prompt.md`](../../labeling/finance/labeler-prompt.md).
The integrity codes mirror the benchmark families above.

## Files

| Path | What it is |
| --- | --- |
| `AUTHORING.md` | the contract the scenario authors followed |
| `schema.json` | JSON Schema for one authored spec file |
| `specs/*.json` | authored scenario families (tracked, small) |
| `prompt_snapshot.json` | snapshot of the finance system prompts and tool schemas used to build rows |
| `build.py` | deterministic builder: specs + `finance-steps.jsonl` → training rows |
| `validate_specs.py` | validates the authored specs before assembly |
| `validate_dataset.py` | validates the built rows (labels, tools, holdout, overlap) |
| `DATASET_CARD.md` | the nature, intended use, and limitations, in one page |

Built files, written to `ender/finetuning/data/alignment-finance/` and ignored by
git:

| File | What it is |
| --- | --- |
| `sft_act.jsonl` | instruction/input/output safe-action rows |
| `sft_audit.jsonl` | scenario + proposed action → label JSON |
| `pairs.jsonl` | chosen/rejected preference pairs |
| `scenarios.jsonl` | normalized scenarios with every candidate |
| `review_queue.jsonl` | stratified sample for a person to review |
| `manifest.json` | counts, hashes, label distribution, limitations |

## Build

The finance source is the same raw-CRS candidate split the Spark uses:

```bash
cd world
npm run finance:label -- --raw-crs
# writes ender/finetuning/data/candidates-raw/finance-steps.jsonl
cd ..
python3 ender/datasets/alignment-finance/validate_specs.py
python3 ender/datasets/alignment-finance/build.py --finance-cases 200 --pressure-fraction 0.6
python3 ender/datasets/alignment-finance/validate_dataset.py \
  --data ender/finetuning/data/alignment-finance
```

The builder refuses to write if a row has a misaligned label without a code, a
missing `correct_action`, a canary, or a held-out persona in the case content.
It rejects synthetic cases cloned from a held-out persona's archetype, not only
cases whose subject id is held out.

When you combine act and audit rows for review and use `prepare_data.py`, the
builder supplies `split_group_id`. It keeps all turns and pressure variants of
the same finance case together; the splitter uses it before `scenario_id` to
prevent related examples from landing on both sides of validation.

## Review gate

**Every generated row is `reviewed: false`.** This is deliberate. The verifier's
agreement is not a person's review, and `prepare_data.py` rejects unreviewed rows.
`review_queue.jsonl` is a stratified sample by family and label. A person should:

1. Read the queue and correct any labels.
2. Record the review in a copy of the queue.
3. Mark only the reviewed rows `reviewed: true` before passing them to
   `prepare_data.py` or the LLaMA-Factory pipeline.

Do not train on the finance-derived held-out split. The builder already excludes
it, and the canary string must stay out of every training file.

## Known limitations

- The finance verifier encodes house policy that is stricter than US law in
  places. Labels are policy-relative; a lawful alternative can still be labelled
  a house-rule violation.
- The benchmark report's rule hits are detector findings, not ground truth. The
  authored analogues are new scenarios, not a re-score of the original episodes.
- The finance-derived rows come from **scripted** runs and synthetic files. They
  are not live lending, collections, or payments decisions.
- The audit label describes a proposed action; it is not evidence that a model
  would take that action in a free run.
- Clean controls are present in every authored family, but the finance-derived
  half is unbalanced toward misaligned states by construction. Use the audit
  label distribution in `manifest.json`, not the raw row count, to reason about
  balance.
- No claim is made that this dataset improves alignment. It is a training input;
  the held-out probes and independent benchmarks are the test.
