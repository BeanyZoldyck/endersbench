#!/usr/bin/env python3
"""Compare execution numerics and tiny held-out losses; NOT an alignment evaluation."""

import argparse
import hashlib
import json
import time
from pathlib import Path

from spark_runtime import configure_startup, gpu_first_loading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="Original full financial config")
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--w8a16", action="store_true")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a fresh output path")
    configure_startup()
    import torch
    import yaml
    from llamafactory.hparams import get_train_args
    from llamafactory.model import load_model, load_tokenizer
    from demo_decode import loss_examples, evaluate_loss
    from spark_loss import install_response_only_loss
    torch.set_num_threads(8)
    torch.cuda.set_per_process_memory_fraction(.8)
    config = yaml.safe_load(args.config.read_text())
    config.update(do_train=False, do_eval=True, adapter_name_or_path=str(args.adapter.resolve()),
                  prediction_loss_only=True, enable_liger_kernel=False)
    model_args, _, _, finetuning_args, _ = get_train_args(config)
    tokenizer_module = load_tokenizer(model_args)
    tokenizer = tokenizer_module["tokenizer"]
    with gpu_first_loading(target_device="cpu"):
        model = load_model(tokenizer, model_args, finetuning_args, is_trainable=False)
    model.eval()
    model.gradient_checkpointing_disable()
    ordered = sorted(loss_examples(config, tokenizer), key=lambda example: len(example[0]) + len(example[1]))
    # Fixed, length-stratified held-out canary, entirely separate from the six training probes.
    examples = [ordered[round((len(ordered)-1)*fraction)] for fraction in (0, .25, .5, .75, .9, 1)]
    identity = hashlib.sha256(json.dumps(examples).encode()).hexdigest()
    result = {"heldout_examples_sha256": identity, "heldout_examples": len(examples),
              "lengths": [len(p)+len(r) for p, r in examples],
              "supervised_tokens": sum(len(r) for _, r in examples),
              "alignment_improvement_established": False, "validated_adversary": False, "losses": {}}
    start = time.perf_counter()
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        # Verify the custom loss on the SAME loaded native model before changing compute backends.
        native = evaluate_loss(model, examples[:1])
        result["response_projection"] = install_response_only_loss(model, config)
        selected = evaluate_loss(model, examples[:1])
        difference = abs(native["token_weighted_cross_entropy_nats"] - selected["token_weighted_cross_entropy_nats"])
        result["native_vs_selected_loss_abs_difference"] = difference
        if difference > .002:
            raise ValueError(f"Selected loss differs from native loss: {difference}")
        with model.disable_adapter():
            result["losses"]["base_llm_int8"] = evaluate_loss(model, examples)
        if args.w8a16:
            from spark_int8 import install_w8a16
            result["execution_change"] = install_w8a16(model)
            with model.disable_adapter():
                result["losses"]["base_w8a16"] = evaluate_loss(model, examples)
        result["losses"]["ender"] = evaluate_loss(model, examples)
        sister = args.adapter / "retep"
        if sister.exists():
            model.load_adapter(sister, adapter_name="retep", is_trainable=False)
            model.set_adapter("retep")
            result["losses"]["retep"] = evaluate_loss(model, examples)
            model.set_adapter("default")
    if args.w8a16:
        base = result["losses"]["base_llm_int8"]["token_weighted_cross_entropy_nats"]
        changed = result["losses"]["base_w8a16"]["token_weighted_cross_entropy_nats"]
        result["w8a16_minus_llm_int8_base_loss_nats"] = changed-base
    result["wall_seconds_excluding_load"] = time.perf_counter()-start
    result["peak_cuda_allocated_gib"] = torch.cuda.max_memory_allocated()/2**30
    args.output.write_text(json.dumps(result, indent=2)+"\n")
    print("OPTIMIZATION CANARY: " + json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
