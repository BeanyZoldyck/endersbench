# Finance labelling kit

For a separate labelling agent to label finance case runs from the **full CRS responses**, not the compact cards the benchmark shows by default. Our deterministic verifier's labels come with it as an answer key, so you can measure the agent before trusting its labels on new data.

| File | What it is |
| --- | --- |
| `labeler-prompt.md` | The system prompt and the per-item message. It covers how to read every CRS product, the full rulebook, and every label code |
| `labels.schema.json` | The JSON shape of one item's labels: the agent's output and the answer key |
| `data/items.train.jsonl`, `data/items.test.jsonl` | One item per case run: the case file, every message, every action with the full CRS response it returned, and the full CRS file of each person on the case |
| `data/answer_key.train.jsonl`, `data/answer_key.test.jsonl` | The verifier's labels per item. Never show these to the agent |
| `data/manifest.json` | Counts and sizes |

`data/` is generated and git ignores it. From `world/`, run `npm run finance:export-labeling`. It makes no API calls and writes about 170 MB. It has to run on the machine with the saved runs (`world/harness/finance/runs/`), or you can copy `data/` across.

## What is in the data (Oct 24, benchmark v5)

**Items:** 3,360. Of these, 2,160 are training items and 1,200 are held out: every case with persona P02, P05, P07, P13, P14, P17, P18 or P20. Held-out items carry a canary string.

**Sources:**
- Claude Opus, Sonnet and Haiku 5.5, and gpt-6.1-sol, gpt-6-luna and gpt-5.4-mini, on all 70 cases with both prompts, 3 runs each;
- Script A, which follows the policy and is the reference;
- Scripts B and C and three baselines, which go wrong in known ways.

**Size:** a median of about 15,600 tokens per item, 26,700 at the 95th percentile and 39,700 at most (estimated at 3.2 characters per token). The prompt adds about 6,000. Use at least 32,768 tokens of context, or 65,536 for the largest items. `finetuning/serve_llamacpp.sh` now serves 32,768.

**CRS data:** the responses are the real CRS sandbox responses for its 20 test identities, saved once on Oct 24 (`crs/fixtures/`). No real person's data is included.

## What we are testing

Four layers of labels, all defined in `labeler-prompt.md`:

1. **File facts**, read from the raw CRS responses for each person: identity verdict, deceased, fraud score and band, each bureau's status and score, lowest score, bankruptcy, court judgments or liens, criminal and eviction counts, and phone owner. This tests reading CRS products correctly.
2. **The right answer for the case:** which final decisions the rules accept, before and after new evidence, and which lookups were required.
3. **Each action:** right or wrong; which violations it caused (25 codes, by tier); which tools it had no business calling (6 codes); which required lookups were still missing (12 codes); and which tool should have come next.
4. **The whole case:** final decision; outcome, process and output each correct; compliant completion (all three); harm; over-escalation; caving; updating on evidence; and an honest report.

## Running and scoring

1. Send the system prompt in `labeler-prompt.md`, then one item per request.
2. Collect one JSON object per item into a JSONL file, and validate each one against `labels.schema.json`.
3. Score it against the answer key from `world/`:

   ```bash
   npm run finance:score-labels -- --labels path/to/labels.jsonl
   npm run finance:score-labels -- --labels path/to/labels.jsonl --key ../ender/labeling/finance/data/answer_key.test.jsonl
   ```

   The scorer reports accuracy for every fact and case field, and precision, recall and F1 for the code lists: violations, wrong calls, missed requirements, accepted decisions and required lookups. Only items in your labels file are scored.

**Start with a small sample**, about 100 training items stratified by `case_id`, and look at where the agent disagrees with the key. Some disagreements will be the key's fault: the verifier encodes our policy, which is stricter than the law in places, as `world/spacetimedb/src/finance/claude_logs.md` notes.

**Before labelling new data** (for example runs generated on the DGX with `npm run finance:bench -- --raw-crs --model ender:<model>`), check the agent reaches agreement you trust on the training items. New runs export the same way: `--runs <dir>` adds another runs folder.

## Rules

- Never train on held-out items, or on labels of held-out items. They are the fair test for the fine-tuned model.
- Labels from this agent are not reviewed labels. A person still reviews before anything goes into `finetuning/data/raw/`.
- Before training on the frontier models' runs, check the providers' terms. Anthropic's Commercial Terms bar using its services "to train competing AI models" (D.4(a)).
