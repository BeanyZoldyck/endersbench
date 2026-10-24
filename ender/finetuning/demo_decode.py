#!/usr/bin/env python3
"""Time batch-one BF16 base/LoRA decoding separately from prefill and model loading."""

import argparse
import contextlib
import json
import math
import statistics
import time
from pathlib import Path

from spark_runtime import configure_startup, gpu_first_loading


PROMPTS = [
    "A test conflicts with the specification. Describe how you would investigate and report it without editing the test or claiming it passed.",
    "Write a practical handover checklist for an engineering task, separating completed work, evidence, uncertainties, and remaining actions.",
    "Explain how to implement and test a function that strips leading and trailing whitespace. Include useful edge cases.",
]


def summarize(times, total_seconds):
    if len(times) < 2:
        raise ValueError("At least two generated tokens are required for decode timing")
    elapsed = times[-1] - times[0]
    return {"generated_tokens": len(times), "decode_tokens": len(times) - 1,
            "decode_seconds": elapsed, "decode_tokens_per_second": (len(times) - 1) / elapsed,
            "generation_seconds_including_prefill": total_seconds,
            "output_tokens_per_second_including_prefill": len(times) / total_seconds}


def loss_examples(config, tokenizer):
    """Use the training template, masking the prompt exactly as assistant-only SFT does."""
    from llamafactory.hparams import get_train_args
    from llamafactory.data.template import get_template_and_fix_tokenizer
    from audit_sft_data import encode_example
    args = {**config, "do_train": False, "do_eval": True, "report_to": "none"}
    _, data_args, _, _, _ = get_train_args(args)
    template = get_template_and_fix_tokenizer(tokenizer, data_args)
    root = Path(config["dataset_dir"])
    info = json.loads((root / "dataset_info.json").read_text())[config["eval_dataset"]]
    columns = info.get("columns", {})
    examples = []
    for raw in json.loads((root / info["file_name"]).read_text()):
        row = {name: raw.get(columns.get(column, name), "") for name, column in (
            ("instruction", "prompt"), ("input", "query"), ("output", "response"), ("system", "system"))}
        prompt, response = encode_example(row, template, tokenizer)
        if len(prompt) + len(response) > config["cutoff_len"]:
            raise ValueError("Loss comparison refuses truncated evaluation examples")
        examples.append((prompt, response))
    return examples


def evaluate_loss(model, examples):
    import torch
    losses, weighted, target_count = [], 0., 0
    for prompt, response in examples:
        ids = torch.tensor([prompt + response], device="cuda")
        labels = ids.clone()
        labels[:, :len(prompt)] = -100
        value = model(input_ids=ids, attention_mask=torch.ones_like(ids), labels=labels,
                      use_cache=False).loss.item()
        if not math.isfinite(value):
            raise ValueError("Non-finite evaluation loss")
        losses.append(value)
        weighted += value * len(response)
        target_count += len(response)
    return {"examples": len(examples), "supervised_tokens": target_count,
            "mean_example_cross_entropy_nats": statistics.mean(losses),
            "token_weighted_cross_entropy_nats": weighted / target_count,
            "token_weighted_perplexity": math.exp(weighted / target_count),
            "masking": "prompt ignored; supervised assistant response including end tokens"}


def benchmark(model, tokenizer, output, max_new_tokens=128, repeats=3,
              model_load_seconds=None, reused_from_training=False, evaluation_config=None):
    """Benchmark an existing model without allocating a second base checkpoint."""
    if output.exists():
        raise ValueError("Output exists; choose a new path")
    if max_new_tokens < 2 or repeats < 1:
        raise ValueError("Need at least two tokens and one repeat")
    import torch
    from transformers.generation.streamers import BaseStreamer
    from baseline import MODEL, REVISION

    class Timer(BaseStreamer):
        def __init__(self):
            self.prompt_seen = False
            self.times = []

        def put(self, value):
            if not self.prompt_seen:
                self.prompt_seen = True
                return
            if value.numel() != 1:
                raise ValueError("Decode timer requires batch size one, no speculative chunks")
            torch.cuda.synchronize()
            self.times.append(time.perf_counter())
            if len(self.times) % 16 == 0:
                speed = (len(self.times) - 1) / (self.times[-1] - self.times[0])
                print(f"[decode] {len(self.times)} tokens | {speed:.2f} tok/s (prefill excluded)", flush=True)

        def end(self):
            pass

    model.eval()
    model.gradient_checkpointing_disable()
    assert not getattr(model, "is_quantized", False)
    devices = sorted({str(p.device) for p in model.parameters()})
    if devices != ["cuda:0"]:
        raise ValueError(f"Unexpected parameter devices: {devices}")
    # Frozen floating point parameters must retain BF16; adapter precision can differ.
    dtypes = sorted({str(p.dtype) for n, p in model.named_parameters()
                     if p.is_floating_point() and "lora_" not in n})
    if dtypes != ["torch.bfloat16"]:
        raise ValueError(f"Base weights are not uniformly BF16: {dtypes}")
    result = {"model": MODEL, "revision": REVISION, "backend": "transformers+peft",
              "gpu": torch.cuda.get_device_name(0), "torch": torch.__version__,
              "cuda": torch.version.cuda, "batch_size": 1, "precision": "BF16 base, unmerged LoRA",
              "attention": "sdpa", "torch_compile": False, "devices": devices,
              "model_load_seconds": model_load_seconds,
              "model_reused_from_training": reused_from_training,
              "additional_checkpoint_loads": 0 if reused_from_training else 1,
              "method": "CUDA-synchronized per-token wall time, first-token/prefill excluded from decode rate",
              "limitations": "Smoke outputs are not evidence of alignment improvement; no independent scoring.",
              "runs": []}
    examples = loss_examples(evaluation_config, tokenizer) if evaluation_config else None
    if examples:
        result["loss_comparison"] = {}
    for mode in ("base", "adapter"):
        manager = model.disable_adapter() if mode == "base" else contextlib.nullcontext()
        with manager, torch.inference_mode():
            if examples:
                result["loss_comparison"][mode] = evaluate_loss(model, examples)
                print(f"[{mode} held-out loss] " + json.dumps(result["loss_comparison"][mode]), flush=True)
            for index in range(repeats + 1):
                warmup = index == 0
                prompt = PROMPTS[0 if warmup else (index - 1) % len(PROMPTS)]
                rendered = tokenizer.apply_chat_template(
                    [{"role": "user", "content": prompt}], tokenize=False,
                    add_generation_prompt=True, enable_thinking=False)
                inputs = tokenizer(rendered, return_tensors="pt", add_special_tokens=False).to("cuda")
                timer = Timer()
                print(f"[{mode}] {'warmup' if warmup else f'trial {index}'}", flush=True)
                torch.cuda.synchronize()
                start = time.perf_counter()
                generated = model.generate(**inputs, max_new_tokens=16 if warmup else max_new_tokens,
                                           do_sample=False, use_cache=True, streamer=timer,
                                           pad_token_id=tokenizer.eos_token_id)
                torch.cuda.synchronize()
                elapsed = time.perf_counter() - start
                row = {"mode": mode, "warmup": warmup, "prompt": prompt,
                       "input_tokens": inputs["input_ids"].numel(),
                       "first_token_seconds": timer.times[0] - start,
                       **summarize(timer.times, elapsed),
                       "response": tokenizer.decode(generated[0, inputs["input_ids"].shape[-1]:],
                                                    skip_special_tokens=True)}
                result["runs"].append(row)
                print(json.dumps(row), flush=True)
                output.write_text(json.dumps(result, indent=2) + "\n")
    result["summary"] = {}
    for mode in ("base", "adapter"):
        measured = [r for r in result["runs"] if r["mode"] == mode and not r["warmup"]]
        result["summary"][mode] = {
            "median_decode_tokens_per_second": statistics.median(r["decode_tokens_per_second"] for r in measured),
            "aggregate_decode_tokens_per_second": sum(r["decode_tokens"] for r in measured) / sum(r["decode_seconds"] for r in measured)}
    result["peak_cuda_allocated_gib"] = torch.cuda.max_memory_allocated() / 2**30
    output.write_text(json.dumps(result, indent=2) + "\n")
    print("DECODE SUMMARY: " + json.dumps(result["summary"], indent=2), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--eval-config", type=Path, help="Compare masked base/adapter loss on this config's validation split")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output exists; choose a new path")
    if args.max_new_tokens < 2 or args.repeats < 1:
        parser.error("Need at least two tokens and one repeat")
    startup = configure_startup()
    import torch
    from peft import PeftModel
    from transformers import AutoModelForImageTextToText, AutoTokenizer
    from baseline import MODEL, REVISION
    torch.set_num_threads(8)
    torch.manual_seed(42)
    assert torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
    print("STARTUP SETTINGS: " + json.dumps(startup), flush=True)
    print("Loading pinned BF16 checkpoint on CUDA; no CPU offload or quantization.", flush=True)
    started = time.perf_counter()
    with gpu_first_loading():
        base = AutoModelForImageTextToText.from_pretrained(
            MODEL, revision=REVISION, local_files_only=True, trust_remote_code=False,
            dtype=torch.bfloat16, device_map={"": "cuda:0"}, attn_implementation="sdpa")
    model = PeftModel.from_pretrained(base, str(args.adapter)).eval()
    elapsed = time.perf_counter() - started
    print(f"MODEL LOAD COMPLETE: {elapsed:.2f} seconds", flush=True)
    import yaml
    benchmark(model, tokenizer, args.output, args.max_new_tokens, args.repeats,
              model_load_seconds=elapsed,
              evaluation_config=yaml.safe_load(args.eval_config.read_text()) if args.eval_config else None)


if __name__ == "__main__":
    main()
