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
