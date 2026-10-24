# Spark optimization experiments

These experiments preserve the pinned base checkpoint, prior datasets and runs.
Training input tokens/s is not autoregressive decode speed. Benchmark variants
use the same six examples (two occurrences each of p50, p90, and maximum length),
seed, precision, rank, optimizer and context limit. A six-step probe is neither a
full epoch nor an independent alignment evaluation.

## Candidate changes

- `prepare_optimized_config.py` can restrict LoRA to attention/memory-routing
  projections in the final 16 of 64 language layers. It includes Q/V/O in full
  attention and QKV, output, and gating projections in Gated DeltaNet. Vision,
  MLP, embeddings and vocabulary head stay frozen. This is a **capacity/quality
  tradeoff**, not a discovery of specific “cheating neurons.” Frozen prefixes
  can run without building a backward graph when their inputs do not require
  gradients. Frozen layers above an adapter still need activation gradients.
- Liger 0.8.5 supplies fused RMSNorm, SwiGLU and chunked loss. The existing
  FLA/causal-conv1d fast paths remain in use. Installation uses `--no-deps` so
  validated Torch/Transformers packages are not replaced.
- Checkpointing-off candidates disable both the Trainer and LLaMA-Factory
  checkpointing controls. This saves recomputation but must pass the longest
  sequence under the existing 80% CUDA allocation limit, without swap growth.
  `ENDER_CHECKPOINT_STRIDE=2` instead retains every other adapted block while
  checkpointing the remaining blocks; this preserves adapter capacity and
  balances recomputation against activation memory. It requires checkpointing
  enabled in the source config.
- `ENDER_RESPONSE_ONLY_LOSS=1` installs an instance-local, text-only loss path.
  It selects hidden states whose **next-token labels** are supervised before
  vocabulary projection. It does not truncate prompts or prevent their context
  from receiving gradients. Dense vs selected loss and hidden-state gradients
  are unit-tested, including padding, batched examples, and token-count
  normalization. Native no-label inference stays on its original forward.
  Loss-only evaluation is required; full logits/label smoothing are unsupported.
- `ENDER_INT8_COMPUTE=dequant-bf16` is an experimental W8A16 execution path.
  Frozen weights remain actual int8 parameters; temporary BF16 dequantized
  matrices use native BF16 GEMMs rather than LLM.int8 activation quantization
  and dynamic outlier splitting. This **changes forward numerics**. Do not call
  it lossless or select it without a matched held-out numerical/quality check.
  It can hold extra dequantized weights for backward when checkpointing is off.
- Full validation moves from every 50 optimizer updates to once per epoch.
  With 4,770 training rows and accumulation 8, the old configuration scheduled
  about 11 full 561-row validation passes (27.8M extra validation input tokens).
  One full pass uses 2.52M tokens. Recovery checkpoints are not removed.

`ENDER_PROFILE_STEP=N` profiles just optimizer step N and writes a Chrome trace
and operator table into that run's own output directory. Profiling/export adds
overhead; exclude the profiled step and its successor from throughput claims.
`benchmark_report.py` refuses to compare probes with differing source hashes or
selected examples. Tiny length probes are not a rigorous whole-epoch ETA.

## Experimental sister: `retep`

`run_sft_demo.py --train-worker <config> --retep-shadow` also maintains a sister
LoRA initialized with identical A/B tensors and an independent AdamW optimizer.
Immediately before each primary optimizer update, it receives **negated,
already-clipped primary gradients**, with matching learning rates, decay,
betas and epsilon. Neither primary weights nor primary gradients are modified.
The sister runs in lockstep, using no extra base model or forward/backward pass.
Its weights, optimizer state and warning manifest are saved separately under
`retep/`, including in newly created recovery checkpoints. Shadow resume is
explicitly unsupported rather than silently resetting optimizer state.

This is **not gradient ascent evaluated at the sister's own parameters**. As the
adapters diverge, its gradients become off-policy. It is also not the inverse of
the final adapter delta (LoRA is a product of A and B). A reciprocal gradient is
not used. Negative gradients on good financial responses can simply destroy
task accuracy or fluency; they do not establish a capable adversary or increased
cheating. The exported manifest always says `validated_adversary: false`.
Future independent trajectory simulations must establish whether `retep` is a
useful counterpart. Do not use scenario-catalog-derived data as independent
evidence of alignment or adversarial capability.

## Completed first matrix (2026-10-24)

Matched warmed training input throughput; these are not decode rates:

| Candidate | 2.5K input | 7.2K input | 12.7K input | Peak CUDA GiB |
|---|---:|---:|---:|---:|
| Original int8 | 164/s | 169/s (earlier unprofiled run) | 160/s | 72.64 |
| Liger, original all-layer/all-linear targets | 175/s | 187/s | 178/s | 42.88 |
| Liger, upper-16 attention targets | 439/s | 435/s | 447/s | 35.23 |

The targeted run completed all six steps without swap growth. The LoRA has
11,487,232 trainable parameters, versus 116,727,808 in the original. The warmed
rates imply approximately 11 hours for 17.47M input tokens, **training only**;
length/template overhead, startup, validation, checkpoints and optimizer-step
effects are not captured by that simple estimate. No full epoch has run.

Disabling checkpointing for the upper-16 candidate **failed** on the longest
example at the existing 97.3-GiB allocation cap. Do not select it. Its failed
artifacts remain under `outputs/perf-matrix-20261024T214033Z/upper16-no-gc`.
The first matrix did not enable `retep`; paired probes are separate experiments.
