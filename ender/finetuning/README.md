# Qwen3.8-27B on the Spark

## Scope

- Host: `asus@172.20.13.192` (`gx10-b29c`).
- Remote directory: `/home/asus/endersbench-finetune`.
- Model: `Qwen/Qwen3.8-27B`, Apache-2.0, BF16 base weights.
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
Model fit and training throughput remain untested until the checkpoint is available.

Installation follows the [current NVIDIA LLaMA-Factory guide](https://build.nvidia.com/spark/llama-factory/instructions).
The remote environment contains CUDA 13 PyTorch and a separate Python virtual environment.
`llamafactory-commit.txt` records the source revision.
`requirements-spark.lock.txt` records the installed packages after a successful installation.

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

4. Run the environment check.

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

`baseline.py` runs the unmodified BF16 checkpoint without a LoRA adapter.
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

The checkpoint download and Python package installation must finish before inference.
StrongREJECT also needs `pyarrow`, which the environment gets through `datasets`.
A dry run does not need PyTorch or model weights.

1. Open `~/endersbench-finetune` on the Spark.
2. Activate `.venv`.
3. Check the selected prompts without model inference.

   ```bash
   python finetuning/baseline.py --dry-run \
     --output-dir results/baseline-plan
   ```

4. Run the sample baseline.

   ```bash
   python -u finetuning/baseline.py \
     --output-dir results/qwen38-base-sample
   ```

5. To evaluate all eligible rows in the default suites, use an unlimited sample.

   ```bash
   python -u finetuning/baseline.py --limit-per-dataset 0 \
     --output-dir results/qwen38-base-full
   ```

Full evaluation can take a long time on the Spark.
The default output limit is 256 tokens per response.
Use `--max-new-tokens` to change that limit.
The script records responses that reach the limit.
It rejects prompts above 4,096 input tokens instead of truncating them.
Use `--max-input-tokens` to change that limit.
Existing result directories are never overwritten.
Responses are saved after each prompt.
If you interrupt a run, previous responses remain available.
The script does not resume interrupted runs.
By default, inference uses cached model files only.
Use `--allow-download` only if you want to download missing files during the run.

Each result directory contains:

- `manifest.json`: model revision, source hashes, settings, sample sizes, environment, and run status.
- `prompts.jsonl`: the exact selected prompts, source rows, labels, and prompt hashes.
- `responses.jsonl`: responses, refusal markers, token counts, latency, memory, and errors.
- `summary.json`: per-suite harmful refusal and benign over-refusal proxies, plus performance measurements.

The refusal detector is an English regular-expression heuristic, not an official benchmark scorer.
A refusal marker does not prove safety.
An absent refusal marker does not prove harmful compliance or useful assistance.
Review the responses before you report alignment improvement.
The script reports suites separately because some source prompts overlap.
It records exact duplicates but does not remove them from individual suite results.
Generation latency includes prompt processing and decoding, but excludes model load and tokenization.
CUDA memory counters exclude some driver and system allocations.

For a local prompt check, use the repository copy:

```bash
python ender/finetuning/baseline.py --dry-run \
  --datasets advbench jbb-harmful jbb-benign xstest \
  --output-dir /tmp/opencode/qwen38-local-baseline-plan
```

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
