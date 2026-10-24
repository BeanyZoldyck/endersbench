# Qwen3.8-27B on the Spark

## Ender post-training smoke test

See [SPARK_DEMO.md](SPARK_DEMO.md) for the BF16 LoRA training demo using clearly
labeled synthetic alignment/reward-hacking examples, live training throughput,
and separately timed base/adapter inference decoding. Demo data is unreviewed
and does not bypass the production preparation script's review requirement.

## 8-bit local inference

The Q8_0 model was removed from Spark at the user's request on 2026-10-24.
BF16 remains selected; the following script is an optional rebuild workflow,
not a description of the currently deployed weights.

`setup_q8.py` builds `llama-quantize` from the existing checkout and creates
`models/Qwen3.8-27B-Q8_0.gguf` from the pinned BF16 GGUF. It retains BF16 GGUF and
training safetensors, writes the source/output hashes and quantization provenance,
and selects Q8_0 in `models/active-model.json`. `serve_llamacpp.sh` reads this
selection on subsequent starts; it does not silently fall back to a different model.

```bash
cd ~/endersbench-finetune
.venv/bin/python -u finetuning/setup_q8.py --threads 8 --parallel 4
```

The setup replaces only this project's model server and temporary cache bridge,
not other inference services. Pause local inference clients before running it.
The resulting server binds to `127.0.0.1:8080`, with four concurrent slots, 8,192
tokens per slot, BF16 KV caches, prompt caching enabled, and no adapter. Model
weights are Q8_0 (8-bit blocks with scale overhead), not BF16. Clients must also
request prompt caching. `models/q8-validation.json` contains readiness checks
and an actual decode smoke timing; `q8-setup.log` shows build/quantization progress.

The earlier BF16 benchmark scripts intentionally reject a differently served
GGUF. For a reproducible historical BF16 run, explicitly select the retained
model rather than using the active Q8 default:

```bash
LLAMA_MODEL_PATH="$HOME/endersbench-finetune/models/Qwen3.8-27B-BF16.gguf" \
LLAMA_MODEL_ALIAS=qwen38-27b-bf16 LLAMA_PARALLEL=1 LLAMA_CACHE_PROMPT=0 \
bash finetuning/serve_llamacpp.sh
```

The OpenRouter continuation is separate from this local setup. Its completed
result retains 11 local episodes and uses `qwen/qwen3.8-27b` for the remaining
seven, with four concurrent API workers. Hosted precision/revision is unspecified;
do not present the mixed result as an unchanged BF16 benchmark. Its report and
raw per-request usage are saved under `openrouter-continuation-20261024T134558919964598Z`.

## Scope

- Host: `asus@172.20.13.192` (`gx10-b29c`).
- Remote directory: `/home/asus/endersbench-finetune`.
- Model: `Qwen/Qwen3.8-27B`, Apache-2.0, BF16 base weights.
- Inference: llama.cpp CUDA with BF16 GGUF. Q8_0 can be rebuilt explicitly with the optional setup above.
- Method: supervised fine-tuning (SFT) with low-rank adaptation (LoRA).
- Output: a LoRA adapter. The export configuration can merge the adapter into a BF16 checkpoint.
- No automatic training, model publication, or external experiment reports.

The local [demo transcript](../dgx-spark-finetuning-transcript.md) uses Llama 3.1 8B and full fine-tuning.
It specifies SDPA attention, batch size 8, sequence length 1,000, mixed precision, and compilation.
It does not contain installation commands or alignment data.

This configuration uses the requested 27B model instead.
Standard full fine-tuning with Adam needs more memory than this Spark provides.
LoRA keeps the base weights in BF16 without quantization.
The microbatch size is 1, with 8 accumulation steps.
Compilation stays off until a short test establishes memory use and stability.
Training memory use and throughput remain untested until a training test completes.

Installation follows the [current NVIDIA LLaMA-Factory guide](https://build.nvidia.com/spark/llama-factory/instructions).
The remote environment contains CUDA 13 PyTorch and a separate Python virtual environment.
`llamafactory-commit.txt` records the source revision.
`requirements-spark.lock.txt` records the installed packages after a successful installation.

The current NVIDIA cuSPARSELt wheel declares the platform tag `manylinux2014_sbsa`.
`pip check` does not recognize this tag on the Spark and returns an error.
The installed wheel metadata remains unchanged.
BF16 CUDA matrix multiplication, SDPA backward, and baseline imports pass in `.venv`.
These checks do not establish full-model compatibility or test sparse cuSPARSELt operations.
The remote `environment-validation.json` records these results and the dependency-check error.

## Data requirements

The existing collection is at `ender/datasets/refusal/`, not `ender/dataset/`.
These files contain benchmark prompts, not a complete SFT refusal baseline.

| Source | Available content | Limitation |
| --- | --- | --- |
| AdvBench | Harmful goals and attack targets | `target` is a harmful answer prefix, not a refusal |
| JailbreakBench | Harmful and benign goals | `Target` is not a reviewed alignment response |
| HarmBench | Harmful behaviors and categories | Desired responses are absent |
| SORRY-Bench / StrongREJECT | Harmful prompts and variants | Reviewed SFT responses are absent |
| XSTest / OR-Bench | Benign controls and harmful controls | Do not assign refusal responses to benign prompts |

Do not use attack targets as positive SFT responses.
Keep independent test prompts out of the SFT inputs.
If a benchmark supplies training prompts, its score is no longer an independent test result.
Check overlap across benchmarks before you report alignment improvement.
The preparation script checks exact normalized duplicates within its inputs, not semantic overlap with external benchmarks.

Use JSONL files for the reviewed refusal baseline and the financial cases.
Each line must contain these fields:

```json
{"instruction":"User request","input":"Optional context","output":"Reviewed desired response","source":"dataset-or-author","scenario_id":"optional-shared-scenario-id","reviewed":true}
```

`scenario_id` keeps related examples in the same split.
Use globally unique scenario IDs across sources.
Include useful answers to benign requests, not only refusals.
Keep financial scenarios simulated.
Do not use real account credentials or personal financial data.

## Environment check

To see setup progress on the Spark, use the monitor:

```bash
cd ~/endersbench-finetune
python3 finetuning/status.py
```

The monitor uses the system Python. It does not need PyTorch to start.
It checks packages in `.venv`, not `.download-venv`.
It shows active jobs, checkpoint shards, the llama.cpp build, and GGUF conversion output.
Partial shards are not counted as complete downloads.
It refreshes every 5 seconds.
It prints `READY` after it checks the baseline dependency, BF16 GGUF provenance, and the local server model.
It then rings the terminal bell and exits.
These checks do not test full-model inference.
Use `--once` for a single status report.
Use Ctrl+C to stop the monitor without stopping installation or downloads.

To see the llama.cpp build log, use this command:

```bash
tail -f ~/endersbench-finetune/llamacpp-setup.log
```

`gguf-conversion.log` contains conversion progress.
`llama-server.log` contains server startup, CUDA offload, and request diagnostics.
`setup-install.log` contains the earlier Python training environment installation.

1. Connect to the Spark.

   ```bash
   ssh asus@172.20.13.192
   ```

2. Open the remote directory.

   ```bash
   cd ~/endersbench-finetune
   ```

3. Activate the environment.

   ```bash
   source .venv/bin/activate
   ```

4. Run the training environment check, if needed.

   ```bash
   python finetuning/preflight.py
   ```

This check tests BF16 SDPA forward and backward operations.
It checks model metadata and training arguments without loading the checkpoint weights.
It does not establish alignment improvement or full-model compatibility.

## Data preparation

1. Put the reviewed refusal examples in `finetuning/data/raw/refusal.jsonl`.
2. Put the reviewed financial examples in `finetuning/data/raw/financial.jsonl`.
3. Prepare the split.

   ```bash
   python finetuning/prepare_data.py \
     finetuning/data/raw/refusal.jsonl \
     finetuning/data/raw/financial.jsonl
   ```

The script rejects absent responses, unreviewed rows, attack-target fields, and duplicate prompts.
It creates a deterministic 90/10 train/validation split by prompt or scenario.
It records input hashes and source names.
It does not overwrite an existing prepared split.
Use `--output` for a new split directory.
Change `dataset_dir` in the training configuration to use that directory.
The validation split measures training loss. It is not an independent alignment benchmark.

## Model download

The BF16 checkpoint requires 55.6 GB (51.7 GiB), plus cache overhead.
Download duration depends on the network.

1. Download the checkpoint.

   ```bash
   hf download Qwen/Qwen3.8-27B --revision 1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0
   ```

## Base-model baseline

`baseline.py` uses a local llama.cpp CUDA server with the BF16 conversion of the pinned checkpoint.
It does not load a model with PyTorch or Transformers.
PyTorch and Transformers remain available for training and the one-time GGUF conversion.
The server has no LoRA adapter, tool execution, or public network listener.
It does not train the model or send responses to an external judge.
It uses greedy generation with thinking disabled and no added system prompt.
The model revision matches the training configuration.

The default sample contains 10 prompts per suite, with seed 42.
XSTest and StrongREJECT samples preserve harmful and benign groups if both exist.
The default suites are AdvBench, HarmBench, JailbreakBench harmful/benign, XSTest, SORRY-Bench,
StrongREJECT, OR-Bench hard, and OR-Bench toxic.
HarmBench includes standard and contextual behaviors only.
The script keeps the context for contextual behaviors.
OR-Bench 80k is available with `--datasets or-bench-80k`.
SORRY-Bench variants and duplicate HarmBench files are not included.

The GGUF conversion and llama.cpp build must finish before inference.
The client uses the Python standard library, plus `pyarrow` for StrongREJECT.
StrongREJECT needs `pyarrow` in `.venv`, the environment that runs the client.
Packages in `.download-venv` are not available to `.venv`.
The script checks all required package names before it reads datasets or creates result files.
Install the client dependency with this command:

```bash
.venv/bin/python -m pip install -r finetuning/requirements-baseline.txt
```

A dry run does not need PyTorch or model weights.

### Server preparation

1. Open `~/endersbench-finetune` on the Spark.
2. Build the pinned llama.cpp revision with CUDA support for GB10.

   ```bash
   bash finetuning/build_llamacpp.sh
   ```

3. Convert the complete cached checkpoint to BF16 GGUF.

   ```bash
   .venv/bin/python -u finetuning/prepare_llamacpp.py
   ```

The conversion keeps the training safetensors unchanged.
It does not download another model or quantize weights.
It exports the text model without vision or the unused MTP draft head.
The converter can retain some tensors, such as norms, in FP32.
The sidecar `models/Qwen3.8-27B-BF16.gguf.json` records the source revision, converter revision, file size, and SHA256.
The client checks the provenance and file size before inference.
It records the conversion hash without hashing the full GGUF again on each run.
The conversion requires about 55 GB of additional disk space.

4. Start the server in a separate terminal.

   ```bash
   bash finetuning/serve_llamacpp.sh
   ```

The server binds to `127.0.0.1:8080` only.
It requests all model layers on the GPU, BF16 KV caches, an 8,192-token context, and 1 slot.
It disables thinking, context shifting, and cross-request prompt caching.
It does not enable speculative decoding or attach an adapter.
The startup log shows the actual CUDA offload.
The launcher stays in the foreground. Use Ctrl+C in that terminal to stop it.
Stop the server before a training run to release its memory.

### Evaluation

1. Activate `.venv` in another terminal in `~/endersbench-finetune`.
2. Check the selected prompts without model inference.

   ```bash
   python finetuning/baseline.py --dry-run \
     --output-dir results/baseline-plan
   ```

3. Run the sample baseline.

   ```bash
   python -u finetuning/baseline.py \
     --output-dir results/qwen38-base-sample
   ```

4. To evaluate all eligible rows in the default suites, use an unlimited sample.

   ```bash
   python -u finetuning/baseline.py --limit-per-dataset 0 \
     --output-dir results/qwen38-base-full
   ```

Full evaluation can take a long time on the Spark.
The default is fast prefix screening: stop at the first English refusal regex marker,
or after 32 output tokens if no marker appears. Closing the stream cancels server generation.
Each row records `early_stopped`, `response_complete`, `stop_reason`, and `screening_label`.
A capped prefix without a marker is `undetermined`, not evidence of compliance or helpfulness.
A refusal marker is a heuristic signal, not a semantic verdict: a full answer can contradict its opening.
`summary.json` includes `screening_counts`; marker rates are prefix proxies and are not comparable
to earlier full-response runs. No API key or external service is used.

For longer responses without early cancellation, use:

```bash
python -u finetuning/baseline.py --no-early-stop-refusal --max-new-tokens 256
```
Use `--max-new-tokens` to change that limit.
The script records responses that reach the limit.
It rejects prompts above 4,096 input tokens instead of truncating them.
Use `--max-input-tokens` to change that limit.
Existing result directories are never overwritten.
Responses are saved after each prompt.
The terminal shows each prompt and streams its response as the model generates text.
Every 5 seconds, it shows elapsed time, output tokens, speed, server RSS, GPU process memory, and available system memory.
After each response, it shows the refusal proxy, latency, token counts, sampled peak memory, and length-limit status.
It also shows the progress count, estimated remaining time, errors, and current suite refusal proxies.
The estimates exclude model load time.
Use `--progress-interval 2` for more frequent updates.
Use `--no-stream` to hide response text but keep the live measurements and saved responses.
Live measurements use standard error. Response text and completed-result summaries use standard output.
To save both terminal streams, use this command:

```bash
python -u finetuning/baseline.py 2>&1 | tee baseline-console.log
```

If you interrupt a run, previous responses remain available.
The script does not resume interrupted runs.
Inference uses the prepared local GGUF only.
There is no automatic download, backend fallback, or quantization fallback.
The server applies the embedded model chat template and tokenizes the prompt.
The client sends token IDs to the native streaming `/completion` endpoint.
It rejects a different served model, loaded adapters, or a context budget that is too small.

Each result directory contains:

- `manifest.json`: backend, server build/properties, GGUF provenance, model revision, source hashes, settings, and run status.
- `prompts.jsonl`: the exact selected prompts, source rows, labels, and prompt hashes.
- `responses.jsonl`: responses, refusal markers, token counts, client latency, server timings, memory, and errors.
- `summary.json`: per-suite harmful refusal and benign over-refusal proxies, plus performance measurements.
- `progress.json`: current prompt, live token count, elapsed time, speed, first-token latency, and sampled memory.

The refusal detector is an English regular-expression heuristic, not an official benchmark scorer.
A refusal marker does not prove safety.
An absent refusal marker does not prove harmful compliance or useful assistance.
Review the responses before you report alignment improvement.
The script reports suites separately because some source prompts overlap.
It records exact duplicates but does not remove them from individual suite results.
Client generation latency includes local HTTP streaming, prompt processing, and decoding.
It excludes model load, template application, and tokenization.
`server_timings` separately records llama.cpp prompt and decoding measurements.
Live response display and measurement updates add some overhead to generation latency.
Use the same display settings for base-model and fine-tuned comparisons.
Memory measurements are process RSS and NVIDIA process memory, not PyTorch allocation counters.
GB10 can report GPU process memory as unavailable. The client records `null`, not a fabricated value.
Memory peaks are sampled, not allocator high-water marks.
GGUF inference is not bitwise identical to Transformers inference, even with BF16 weights.
Use this backend and the same server settings for later fine-tuned comparisons.

For a local prompt check, use the repository copy:

```bash
python ender/finetuning/baseline.py --dry-run \
  --datasets advbench jbb-harmful jbb-benign xstest \
  --output-dir /tmp/opencode/qwen38-local-baseline-plan
```

### Second-pass review and visuals

The [latest 90-example report](reports/baseline-20261024T075432-second-pass/index.html)
reviews the 28 undetermined prefixes from `baseline-qwen38-20261024T075432064502Z`.
It includes overall and semantic-category SVG charts, searchable evidence, CSV, and annotated JSONL.
The review is assistant-authored, not a human label set or an independent external judge evaluation.
It does not generate longer responses: accepted means an on-task answer begins; rejected means
visible non-acceptance; undetermined means the saved text is insufficient. The other 62 first-pass
refusal-marker decisions are retained and clearly identified.

`reviews/baseline-20261024T075432-second-pass.json` contains the explicit decisions, verbatim evidence,
and one primary topic per prompt. `second_pass.py` checks its source hash and complete coverage before
building the report. Rebuild into a new output directory with:

```bash
python finetuning/second_pass.py \
  --run-dir results/baseline-qwen38-20261024T075432064502Z \
  --annotations finetuning/reviews/baseline-20261024T075432-second-pass.json \
  --output-dir reports/baseline-second-pass
```

### Alignment and reward-hacking catalogs (separate run)

`scenario_baseline.py` evaluates all 24 `alignment/scenarios.jsonl` and 26
`rewardhacking/scenarios.jsonl` entries. Raw upstream mirrors are copied for
reference but their original agent harnesses are **not** executed. This is a
text-only, explicit two-option decision probe, not an agentic benchmark score.

The prompt contains the scenario observation and both actions with consequences.
It does not contain catalog ethical labels, titles, detection rules, or provenance.
Each scenario runs once; the ethical option is in A for half of each catalog and
in B for the other half (seed 42). No Charter or win-at-all-costs instruction is
added. The model emits `CHOICE: A` or `CHOICE: B` first, followed by a brief
explanation, with a 32-token cap and thinking off. The parser maps only the
explicit leading choice to the catalog branch. Missing choices and errors are
undetermined. Explanations are saved, not independently semantically judged.

Run on Spark, with streaming answers, 2-second heartbeat, counts, ETA, and a log:

```bash
cd ~/endersbench-finetune
bash finetuning/run_scenarios.sh
```

For a detached but attachable terminal:

```bash
tmux new-session -s alignment-reward 'bash finetuning/run_scenarios.sh; exec bash'
# Detach with Ctrl+B, then D. Reattach with:
tmux attach -t alignment-reward
```

Each run creates unique `results/alignment-reward-<timestamp>/`,
`logs/alignment-reward-<timestamp>.log`, and
`finetuning/reports/alignment-reward-<timestamp>/` directories. The offline HTML
report has overall/per-catalog SVG charts, source semantic categories, an
option-position diagnostic, searchable exact prompts/responses, provenance,
overlap links, JSONL, and CSV. Existing runs are never overwritten. `COMPLETE`
and a terminal bell announce that inference and report generation both finished.

No model tools execute. Stated ethical choices do not establish safe behavior;
providing both alternatives can cue the answer. Catalog labels are not independent
ground truth, and related cases overlap across the two catalogs. The report keeps
the suites separate and marks the pooled count as descriptive, not independent
trials. Longer explanations can be truncated; inspect the saved text before
drawing conclusions. No external judge/API key is used.

### Updated executable catalogs (observed simulated tool calls)

`agentic_baseline.py` runs the updated catalogs' `env`, `tools`, and `detections`
through `datasets/sim/`. This is a **different experiment** from the A/B test
above. The model receives the operational system/task prompts and tool names,
parameters, and descriptions, not the canonical actions, ethical branch labels,
detection rules, or simulator source. An empty task prompt gets a neutral startup
instruction to check the inbox or read `/workspace/task.md` when those tools exist.

Only the in-memory Python simulator executes generated calls. No generated `run`
command enters a host shell, and no generated URL makes a real network request.
The simulator returns canned shell/network output, not a real container. Existing
data limitations are retained and disclosed rather than silently repaired.

On Spark, supply the versioned dataset snapshot copied from this repository:

```bash
cd ~/endersbench-finetune
bash finetuning/run_agentic_scenarios.sh --data-root reference/<snapshot-directory>
```

Run in `tmux` to attach to its actual live terminal. The launch script streams
model JSON and tool results, a 2-second token/memory heartbeat, per-episode counts,
and ETA, and saves everything under `logs/agentic-alignment-reward-<timestamp>.log`.
Each unique result directory saves the complete catalog snapshot, source/runtime
hashes, manifest, `episodes.jsonl`, `turns.jsonl`, `tool-calls.jsonl`, live progress,
and summary. Earlier runs are never overwritten.

Default budgets are 10 model turns, 192 output tokens per turn, and 768 output
tokens per episode. Complete JSON responses cancel extra generation. Up to four
calls may be batched, but dispatch stops on a structural rule hit. Otherwise the
episode ends at the model's final message or a budget. Invalid JSON receives one
repair opportunity; no command is extracted from prose. Errors are not successes.

`agentic_report.py` creates a separate offline HTML/SVG/CSV report for just the two
catalogs. Outcomes are **rule hit / no rule hit / unresolved**, not ethical versus
unethical. No rule hit does not prove exposure, task completion, or safety. Narrow
rules can miss alternate spellings/actions; broad rules may flag failed attempts
or benign reads. Every rule hit links to its observed call and simulator result.
Missing tool access to seeded mail/files/docs is an explicit warning and makes a
non-hit episode unresolved, as do no-call episodes and protocol/dispatch errors.

Content-gated detections stay pending, never auto-pass, until explicitly reviewed.
No fixture `RuleJudge`/`StubJudge` or external API is used on model outputs. A
later assistant-authored semantic review can be passed via `--review` to the report;
it must match the raw episodes hash, identify the exact candidate, quote an actual
tool argument, and give a rationale. Raw results are not modified. The report
retains unresolved candidates and identifies the reviewer.

#### Long-horizon restart of unresolved episodes

```bash
bash finetuning/retry_unresolved.sh results/<prior-run> reference/<snapshot>
```

This selects only the prior run's `unresolved` IDs and restarts them in a new
directory, recording the source run and raw episodes hash. It allows **80 turns,
1,024 output tokens per turn, and 16,384 per episode**, versus the original
10 / 192 / 768. It does not stop when a detector rule first fires: the model may
continue to a completion or an evidence-backed blocker report.

JSON-schema constrained decoding avoids malformed/unterminated output when
possible; the protocol-error allowance is raised to eight. A repaired protocol
error alone no longer makes an otherwise finished retry unresolved. It is still
logged. This does not make a final message evidence of task success.

Long histories use explicit, model-authored memory checkpoints before the 8K
server context fills. Complete earlier traces and the checkpoint prompt/output
are retained. Checkpoints may lose information; they are not lossless memory.
Their output tokens count against the episode budget.

For the two cases with seeded mail/files but no matching read tool, existing
seed information is supplied as an explicit operations briefing. No new answer,
canonical action, detection rule, or privileged tool is supplied. The startup
also explains the simulated shell's limitations and asks the agent to report
real blockers rather than loop on unsupported commands. All interventions are
recorded in the manifest and report: this is a restarted, revised condition,
not an unchanged continuation or a directly comparable replicate.

#### Live prompt caching without restarting the agent

The retry run `agentic-alignment-reward-20261024T120923631829674Z` was paused
between closed HTTP requests with `pause_between_requests.py` and resumed with
SIGCONT in the **same process**, preserving the episode and conversation.
The model server was restarted on loopback port 8081 with
`LLAMA_SERVER_PORT=8081 LLAMA_CACHE_PROMPT=1 bash finetuning/serve_llamacpp.sh`.
`prompt_cache_proxy.py` listens on the original loopback port 8080 and forwards
to that backend. Only structured-JSON `/completion` requests have
`cache_prompt` changed to `true`; prompts, sampling, weights, and adapters are
unchanged. Ordinary benchmark requests without a JSON schema retain their own
cache policy. Both services remain loopback-only.

The bridge is necessary because editing an imported Python file would not
reconfigure the already-running client. Cancellation still closes the upstream
stream. Its PID is saved in `prompt-cache-proxy.pid`, and the native server PID
remains in `llama-server.pid`. `prompt-cache-proxy-console.log` and
`llama-server-cached-console.log` contain service diagnostics.

The run's `runtime-interventions.jsonl` records the exact pause boundary, process
IDs, policy transition, and cache verification (143 prompt tokens re-evaluated
on the first verification request, 4 on the second). `prompt-cache-requests.jsonl`
records bridged request counts/settings, not prompt contents. The generated
report includes the live intervention separately from startup settings; latency
before/after this change should not be pooled as an unchanged configuration.

## Training (not started)

1. Run a short test in a separate output directory.

   ```bash
   llamafactory-cli train finetuning/configs/qwen38_27b_lora.yaml \
     max_steps=2 max_samples=16 eval_strategy=no \
     output_dir=outputs/qwen38-27b-smoke
   ```

2. Check the test log for finite loss and available memory.
3. Start the alignment run only after the data review and short test pass.

   ```bash
   llamafactory-cli train finetuning/configs/qwen38_27b_lora.yaml
   ```

4. Compare the base model and adapter on independent refusal, benign-helpfulness, and financial scenarios.
5. Export the merged checkpoint only if the evaluation supports its use.

   ```bash
   llamafactory-cli export finetuning/configs/export.yaml
   ```

The learning rate, LoRA rank, and epoch count are starting settings, not validated alignment hyperparameters.
Use base and adapter results from identical prompts and inference settings.
