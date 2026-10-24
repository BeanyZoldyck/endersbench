# Ender BF16 LoRA demo on DGX Spark

This is a training-pipeline smoke test, not a release model or proof of alignment.
It uses the pinned `Qwen/Qwen3.8-27B` checkpoint in BF16, without weight
quantization, and trains rank-8 LoRA adapters. The upstream checkpoint is already
post-trained; “base” here means **unmodified upstream checkpoint**, not a raw
pretraining model. The vision components stay frozen.

## Official resources consulted

- [NVIDIA: LLaMA-Factory on Spark](https://build.nvidia.com/spark/llama-factory/instructions)
  describes the CUDA 13 PyTorch virtual environment and LoRA workflow used here.
- [NVIDIA: Unsloth on Spark](https://build.nvidia.com/spark/unsloth/instructions)
  provides an alternative container workflow. This demo does not install Unsloth
  over the existing LLaMA-Factory environment or substitute a 4-bit model.
- [NVIDIA: hardware specifications](https://docs.nvidia.com/dgx/dgx-spark/hardware.html)
  lists 128 GB unified memory and 273 GB/s memory bandwidth.
- [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B) documents the hybrid
  DeltaNet/full-attention architecture and notes engine-dependent inference speed.
- [Transformers loader settings](https://huggingface.co/docs/transformers/main/en/reference/environment_variables)
  documents `HF_DEACTIVATE_ASYNC_LOAD`, used to bound checkpoint prefetch memory.

## Data and limitations

`build_demo_data.py` uses the 24 alignment and 26 reward-hacking scenario briefs,
the assistant-authored responses in `data/demo_responses.json`, and 10 benign
controls. Records explicitly say `reviewed: false`. They are hypothetical policy
plans, **not executed tool trajectories**, and are not attributed to frontier
model rollouts. The production `prepare_data.py` review gate is unchanged.

The split is deterministic and groups alignment scenario families. Both catalog
hashes, response hashes, scenario IDs, source provenance, and limitations are
recorded. This does not establish independence from semantically related external
benchmarks. Scores on training-derived scenarios must be labeled contaminated.
Human review and separately authored held-out tool tasks are needed before using
this as an alignment dataset.

## Run

Use the existing `~/endersbench-finetune/.venv` on Spark. Install missing optimized
hybrid-attention dependencies only after checking their compatibility with that
environment; a slow fallback is not evidence of peak GB10 performance.

Always launch inside an attachable tmux session:

```bash
cd ~/endersbench-finetune
tmux new-session -s ender-sft-demo
set -o pipefail
.venv/bin/python -u finetuning/run_sft_demo.py \
  --data-root reference/executable-catalogs-20261024T101532105319Z \
  --output outputs/ender-sft-demo-$(date -u +%Y%m%dT%H%M%SZ) \
  --max-steps 12 --accept-synthetic-demo --stop-idle-project-server \
  2>&1 | tee -a ender-sft-demo.log
```

The output directory must be new. The runner checks token lengths rather than
silently truncating examples. It uses batch size 1, accumulation 2, a 1,024-token
cutoff, gradient checkpointing, SDPA, and no compilation. Twelve steps are a
**partial-epoch smoke test**, not a full training curriculum. Larger token budgets,
batch sizes, and compilation require separate memory/performance checks.

### Memory-bounded startup and model reuse

`spark_runtime.py` defaults `HF_DEACTIVATE_ASYNC_LOAD=1` **before Transformers is
imported**. The installed Transformers version otherwise dispatches tensor loads
to four workers. Sequential loading limits live prefetched weights on Spark's
unified memory. The upstream documentation describes it as potentially slower;
it can be faster when parallel loading causes memory pressure. Measure it rather
than assuming a speedup. Explicit environment overrides are respected.

Training and post-training decode now share the same loaded model. The worker
keeps the model after LLaMA-Factory saves/evaluates it, disables gradient
checkpointing for generation, and runs the base/adapter comparison in-process.
It no longer unloads and reloads the entire checkpoint for that comparison.
Standalone `demo_decode.py` remains available for existing adapters.

To measure startup and compare base/adapter held-out loss without retraining:

```bash
.venv/bin/python -u finetuning/profile_spark_startup.py \
  --adapter outputs/ender-sft-demo-20261024T192018Z/adapter \
  --eval-config outputs/ender-sft-demo-20261024T192018Z/train.yaml \
  --reference-decode outputs/ender-sft-demo-20261024T192018Z/decode.json \
  --output outputs/startup-profile-$(date -u +%Y%m%dT%H%M%SZ)
```

Use tmux for this command, too. The profile records loading time, memory/swap
samples, and actual decode speed. A single measured prompt per model is a smoke
check, not a maximum-throughput serving test. Separate-run cache state is not
controlled. Do not load this model while another training model is resident.

### Larger financial dataset

Before starting a financial run, measure lengths using the actual LLaMA-Factory
template. This audit does not load model weights or truncate examples:

```bash
.venv/bin/python -u finetuning/audit_sft_data.py \
  --config finetuning/configs/qwen38_27b_lora.yaml \
  --output logs/financial-length-audit-$(date -u +%Y%m%dT%H%M%SZ).json
```

Check both splits' `exceeds_cutoff` fields. Do not use a short demo cutoff on
long finance conversations: it can remove the supervised answer entirely. Use a
new training configuration/output directory and test the required sequence length
for memory/throughput before a full run. Existing datasets and checkpoints must
not be overwritten. For a direct LLaMA-Factory launch in tmux, apply the same
startup setting explicitly:

```bash
HF_DEACTIVATE_ASYNC_LOAD=1 HF_HUB_OFFLINE=1 OMP_NUM_THREADS=8 \
  .venv/bin/llamafactory-cli train path/to/new-financial-config.yaml
```

Autoregressive **decode tokens/s** measures generation of responses/rollouts.
Supervised training processes known target tokens together; its relevant rate is
**training input tokens/s**. Faster single-stream decoding does not directly
accelerate SFT. Estimate a large run from a representative training throughput
test at its real sequence length, not the short policy-plan demo.

### Interpreting loss

The reported loss is cross-entropy, averaged over supervised assistant tokens;
it is not bounded to 0–1. A cross-entropy of 2.19 nats corresponds to perplexity
`exp(2.19)`, about 8.94. Its absolute value depends on dataset difficulty,
tokenizer, masking, and template. Compare the original model and adapter on the
same held-out tokens. The updated decode comparison records both mean-example
loss and token-weighted loss/perplexity with prompts masked. A six-example
synthetic validation set still cannot establish broader alignment improvement.

`--stop-idle-project-server` gracefully stops only the verified project BF16
llama.cpp server after checking that no request is processing. Its command is
saved in the run directory. It does not stop unrelated inference services or
close any tmux session. Do not restart the 50 GiB inference model while training.
The GGUF is retained, but training loads the original safetensors, not the GGUF.

Attach from another machine:

```bash
ssh -t asus@172.20.13.192 'tmux attach -t ender-sft-demo'
```

## Outputs and performance

- `manifest.json`, `requirements.lock.txt`, `train.yaml`: configuration/provenance.
- `data/`: synthetic source rows, prepared split, and data manifest.
- `adapter/`: LoRA weights, resumable checkpoints, training state and loss metrics.
- `throughput.jsonl`: per-optimizer-step CUDA memory, elapsed time, and **training
  input tokens/s** (teacher-forced; not autoregressive decode speed).
- `telemetry.jsonl`: five-second GPU utilization, power, clocks, temperature, and
  available system memory samples during training and decoding.
- `decode.json`: warmup plus three batch-one prompts each for the original model
  and adapter, using the same Transformers/PEFT process and GPU placement.
  New demo runs also include matched held-out loss comparisons.

Decode timing synchronizes CUDA at every generated token. The reported decode
rate excludes prefill and the first generated token; first-token latency and
end-to-end speed are recorded separately. Generation stops normally at EOS, so
the actual generated-token count is recorded. Warmup is excluded from summaries.
No CPU offload, weight quantization, or speculative generation is used. Per-token
synchronization adds some overhead; this is a reproducible smoke measurement,
not a maximum-throughput serving benchmark. Base timing disables the loaded
adapter, and adapted timing enables it; neither is a merged/quantized deployment.

A 27B BF16 model moves roughly 54 GB of weights per single-token decoding step.
At 273 GB/s the simple weight-streaming estimate is only about 5 tokens/s, before
other costs. This is an approximation, not a hard roofline. Training and batched
prefill reuse weights across tokens and can achieve much higher token throughput.
Do not equate Spark's advertised FP4 compute with BF16 single-stream decode speed.

The demo does not merge, quantize, publish, or replace the active serving model.
Keep adapter and source revision together. After reviewing a trained adapter,
merge a **new** BF16 output using a separately named export configuration, then
quantize that export for inference. Never overwrite the original BF16 checkpoint.
