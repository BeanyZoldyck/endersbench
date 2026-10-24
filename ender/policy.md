## The 30-second explanation

> “We’re adapting an existing Qwen model to demonstrate more honest, policy-aware behavior. We use supervised examples and LoRA, which trains small additional weight matrices while keeping the original BF16 weights frozen. This demo validates the training pipeline—not that we’ve solved alignment. We measure training throughput separately from inference speed.”

## 1. What fine-tuning actually changes

A language model predicts the next token from the preceding context. Training adjusts its weights so desired continuations become more likely.

**Supervised fine-tuning (SFT)** gives it examples of:

```text
Situation: A test conflicts with the specification.
Desired response: Preserve the test, investigate the conflict,
and report the actual result rather than fabricate success.
```

The training objective is **cross-entropy loss**: penalize the model when it assigns low probability to the desired next token.

Our configuration trains on the **assistant response**, not on reproducing the input prompt.

**Important distinction:** Qwen’s upstream checkpoint is already post-trained. Here, “base model” means the **unmodified upstream model**, not a raw pretrained model.

## 2. Why LoRA instead of full fine-tuning?

Full fine-tuning updates billions of original parameters. Besides weights, training needs gradients, optimizer state, and intermediate activations. That can exceed Spark’s memory.

LoRA represents a weight update using two smaller matrices:

\[
W_{\text{adapted}} = W_{\text{original}} + \frac{\alpha}{r}BA
\]

- **\(W\):** frozen original weights.
- **\(A\), \(B\):** trainable adapter matrices.
- **Rank \(r\):** controls the adapter’s capacity.
- **Alpha:** scales its contribution.

Our demo uses **rank 8, alpha 16**.

Higher rank gives more flexibility, but costs memory and can increase overfitting. Higher rank does **not** automatically mean better alignment.

Although the original weights are frozen, training still computes through the model to determine how the adapters should change.

## 3. The settings worth knowing

| Setting | Meaning in this demo |
|---|---|
| **BF16** | Original weights use a two-byte floating-point format; no weight quantization |
| **Microbatch 1** | Process one example at a time |
| **Gradient accumulation 2** | Combine gradients from two examples before updating the adapters |
| **12 optimizer steps** | A short smoke test: roughly 24 training-example presentations |
| **1,024-token cutoff** | Maximum training sequence length; examples are checked to avoid truncation |
| **Gradient checkpointing** | Save memory by recomputing some intermediate results during backward passes |
| **Learning rate** | Controls update size; too high can damage behavior, too low may barely change it |

With **54 training examples**, this run is less than one epoch. An **epoch** is one pass through the training set.

### Two meanings of “checkpoint”

- **Training checkpoint:** saved adapter, optimizer state, and progress for resuming.
- **Gradient checkpointing:** a memory-saving computation technique.

They are unrelated mechanisms despite the shared name.

## 4. Training speed is not decode speed

This is probably the most useful performance explanation during the demo.

**During training**, the desired response is already known. The model can process many token positions together—called **teacher forcing**.

**During decoding**, each new token depends on the previous generated token. A single response therefore advances largely sequentially.

Consequently:

> “Training at hundreds of input tokens per second does not mean the model can generate hundreds of tokens per second.”

We record:

- **Training input tokens/s**
- **Decode tokens/s**, excluding prefill and the first token
- **First-token latency**
- GPU utilization, memory, power, and temperature

A 27B BF16 model has roughly **54 GB of weights**. Against Spark’s advertised **273 GB/s memory bandwidth**, a simple weight-streaming estimate suggests around **5 decode tokens/s before other costs**. That is an approximation—not a measured result or a strict ceiling.

## 5. What the data can—and cannot—teach

We have **50 synthetic policy-plan examples plus 10 benign controls**, split into **54 training / 6 validation examples**.

The benign controls matter: we want useful assistance, **not indiscriminate refusal**.

But these examples teach **what to say about a situation**. They do not yet demonstrate that the model will make the right tool calls under pressure.

> “Stating a safe intention is not the same as behaving safely.”

The next stage should include reviewed trajectories showing authorized actions, tool results, recovery from mistakes, and honest blocker reports.

## 6. How to interpret the results

**Lower training loss** means better prediction of training responses. It does **not** establish better judgment.

**Lower validation loss** suggests the model predicts held-out responses better. With only six validation examples, that evidence is weak.

To establish useful improvement, we need:

- New scenarios not derived from training examples.
- Actual tool-use evaluations.
- Benign tasks to detect over-refusal.
- General capability tests to detect regressions.
- Human review—not merely “no detector rule fired.”

## Likely questions

**“Why not reinforcement learning?”**  
SFT teaches demonstrations. Preference methods such as DPO teach relative preferences between responses; reinforcement learning optimizes a reward signal. SFT is the simplest starting point for validating this pipeline.

**“Can we quantize afterward?”**  
Yes. Preserve the original model and adapter, merge into a separate checkpoint if appropriate, then quantize for inference and reevaluate quality.

**“Does this prove alignment?”**  
No. It demonstrates a reproducible mechanism for changing behavior. Reliable alignment requires stronger data and independent behavioral evidence.
