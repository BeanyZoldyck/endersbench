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
