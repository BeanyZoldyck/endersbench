#!/usr/bin/env python3
"""Reproducible Spark BF16 LoRA smoke test with loss, throughput, and decode artifacts."""

import argparse
import contextlib
import hashlib
import json
import os
import platform
import select
import signal
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from build_demo_data import build
from spark_runtime import configure_startup, token_ids, gpu_first_loading


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCES = ["https://build.nvidia.com/spark/llama-factory/instructions",
           "https://build.nvidia.com/spark/unsloth/instructions",
           "https://docs.nvidia.com/dgx/dgx-spark/hardware.html",
           "https://huggingface.co/Qwen/Qwen3.8-27B"]


@contextlib.contextmanager
def telemetry(run):
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            row = {"timestamp": datetime.now(timezone.utc).isoformat()}
            try:
                query = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,power.draw,temperature.gpu,clocks.sm,clocks.mem",
                                        "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=4)
                row["gpu_util_percent_power_watts_temp_c_sm_mhz_mem_mhz"] = query.stdout.strip()
                for line in Path("/proc/meminfo").read_text().splitlines():
                    if line.startswith(("MemAvailable:", "SwapFree:")):
                        row[line.split(":")[0] + "_gib"] = int(line.split()[1]) / 2**20
            except (OSError, subprocess.TimeoutExpired) as exc:
                row["sampling_error"] = str(exc)
            with (run / "telemetry.jsonl").open("a") as handle:
                handle.write(json.dumps(row) + "\n")
            stop.wait(5)

    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=6)


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def stop_project_server(run):
    """Only stop the verified idle server for this project's BF16 model."""
    from llamacpp_backend import LlamaClient, default_gguf
    client = LlamaClient()
    pid_file = ROOT / "llama-server.pid"
    if not pid_file.exists() or not (Path("/proc") / pid_file.read_text().strip()).exists():
        print("No project server PID to stop.", flush=True)
        return
    pid = int(pid_file.read_text())
    proc = Path("/proc") / str(pid)
    command = [x.decode() for x in (proc / "cmdline").read_bytes().split(b"\x00") if x]
    if Path(command[0]).resolve() != ROOT / "llama.cpp/build/bin/llama-server":
        raise ValueError("PID does not belong to this project's llama-server")
    client.check(default_gguf())
    if any(slot["is_processing"] for slot in client.json("/slots")):
        raise ValueError("Inference request is active; refusing to stop the server")
    write_json(run / "stopped-server.json", {"pid": pid, "command": command,
                                             "reason": "release BF16 inference weights before BF16 LoRA training"})
    fd = os.pidfd_open(pid)
    try:
        signal.pidfd_send_signal(fd, signal.SIGTERM)
        if not select.select([fd], [], [], 90)[0]:
            raise TimeoutError("Server did not stop gracefully")
    finally:
        os.close(fd)
    print(f"Stopped idle project BF16 server PID {pid}; other services and tmux sessions preserved.", flush=True)


def train_worker(config, decode_output=None, decode_repeats=3, decode_max_new_tokens=128, memory_fraction=None,
                 retep_shadow=False, retep_initial=None, train_seconds=None):
    import logging
    class CastWarningOnce(logging.Filter):
        seen = False

        def filter(self, record):
            if record.getMessage().startswith("MatMul8bitLt: inputs will be cast from"):
                if self.seen:
                    return False
                self.seen = True
            return True

    # Keep the precision warning, but do not repeat it hundreds of times per
    # microbatch for hours. Other warnings/errors are never filtered.
    logging.getLogger("bitsandbytes.autograd._functions").addFilter(CastWarningOnce())
    import torch
    from transformers import TrainerCallback
    from llamafactory.train.tuner import run_exp
    if memory_fraction is not None:
        torch.cuda.set_per_process_memory_fraction(memory_fraction)

    trained = {}

    class Throughput(TrainerCallback):
        def on_step_begin(self, args, state, control, **kwargs):
            profile_step = int(os.environ.get("ENDER_PROFILE_STEP", "0"))
            if profile_step and state.global_step + 1 == profile_step:
                self.profiler = torch.profiler.profile(
                    activities=[torch.profiler.ProfilerActivity.CPU, torch.profiler.ProfilerActivity.CUDA],
                    record_shapes=True)
                self.profiler.start()

        def on_train_begin(self, args, state, control, **kwargs):
            model = kwargs["model"]
            trained["model"] = model
            trainable = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
            if not trainable or any("lora_" not in n for n, _ in trainable):
                raise ValueError("Expected LoRA-only trainable parameters")
            if any(p.device.type != "cuda" for p in model.parameters()):
                raise ValueError("Training requires all parameters on CUDA, without CPU offload")
            if os.environ.get("ENDER_RESPONSE_ONLY_LOSS") == "1":
                from spark_loss import install_response_only_loss
                print("[loss optimization] " + json.dumps(install_response_only_loss(model, config)), flush=True)
            if os.environ.get("ENDER_INT8_COMPUTE") == "dequant-bf16":
                from spark_int8 import install_w8a16
                print("[int8 compute optimization] " + json.dumps(install_w8a16(model)), flush=True)
            stride = int(os.environ.get("ENDER_CHECKPOINT_STRIDE", "1"))
            if stride > 1:
                if config.get("disable_gradient_checkpointing") or not config.get("gradient_checkpointing"):
                    raise ValueError("Selective policy requires checkpointing-enabled source config")
                from spark_checkpointing import checkpoint_stride
                print("[checkpoint policy] " + json.dumps(checkpoint_stride(model, stride)), flush=True)
            expected_bits = config.get("quantization_bit")
            quantized_modules = 0
            if expected_bits == 8:
                import bitsandbytes as bnb
                quantized = [module for module in model.modules() if isinstance(module, bnb.nn.Linear8bitLt)]
                if not quantized or any(module.weight.dtype != torch.int8 for module in quantized):
                    raise ValueError("Expected actual int8 Linear8bitLt base weights")
                quantized_modules = len(quantized)
            elif expected_bits is not None or getattr(model, "is_quantized", False):
                raise ValueError("Worker supports explicitly configured BF16 or 8-bit LoRA only")
            import re
            layers = sorted({int(match.group(1)) for name, _ in trainable
                             if (match := re.search(r"language_model\.layers\.(\d+)\.", name))})
            validation = {
                "trainable_parameters": sum(p.numel() for _, p in trainable),
                "total_parameters": sum(p.numel() for p in model.parameters()),
                "trainable_dtypes": sorted({str(p.dtype) for _, p in trainable}),
                "frozen_dtypes": sorted({str(p.dtype) for p in model.parameters() if not p.requires_grad}),
                "lora_only": True, "all_cuda": True,
                "base_quantization_bits": expected_bits,
                "int8_linear_modules": quantized_modules,
                "trainable_decoder_layers": layers,
                "lora_b_matrices": sum("lora_B" in name for name, _ in trainable)}
            print("[training validation] " + json.dumps(validation), flush=True)
            validation_dir = Path(args.output_dir)
            if validation_dir.name == "adapter":
                validation_dir = validation_dir.parent
            validation_dir.mkdir(parents=True, exist_ok=True)
            write_json(validation_dir / "training-validation.json", validation)
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            self.start = self.last = time.perf_counter()
            self.tokens = state.num_input_tokens_seen
            self.initial_tokens = self.tokens
            self.profiler = None

        def on_step_end(self, args, state, control, **kwargs):
            torch.cuda.synchronize()
            now = time.perf_counter()
            if self.profiler is not None:
                self.profiler.stop()
                profile_dir = Path(args.output_dir).parent if Path(args.output_dir).name == "adapter" else Path(args.output_dir)
                profile_dir.mkdir(parents=True, exist_ok=True)
                events = self.profiler.key_averages()
                (profile_dir / "profile.txt").write_text(events.table(sort_by="self_device_time_total", row_limit=60))
                self.profiler.export_chrome_trace(str(profile_dir / "profile-trace.json"))
                self.profiler = None
            tokens = state.num_input_tokens_seen
            row = {"step": state.global_step, "elapsed_seconds": now - self.start,
                   "step_seconds": now - self.last, "input_tokens_seen": tokens,
                   "step_input_tokens_per_second": (tokens - self.tokens) / (now - self.last),
                    "cumulative_input_tokens_per_second": (tokens - self.initial_tokens) / (now - self.start),
                   "cuda_allocated_gib": torch.cuda.memory_allocated() / 2**30,
                   "peak_cuda_allocated_gib": torch.cuda.max_memory_allocated() / 2**30,
                   "note": "teacher-forced training input throughput, NOT autoregressive decode speed"}
            metrics_dir = Path(args.output_dir)
            if metrics_dir.name == "adapter":
                metrics_dir = metrics_dir.parent
            metrics_dir.mkdir(parents=True, exist_ok=True)
            with (metrics_dir / "throughput.jsonl").open("a") as handle:
                handle.write(json.dumps(row) + "\n")
            print("[training throughput] " + json.dumps(row), flush=True)
            self.last, self.tokens = now, tokens

    torch.set_num_threads(8)
    callbacks = []
    if os.environ.get("ENDER_ALIGNMENT_FINANCE_PROBES"):
        # First, so the starting-point evaluation runs before the training budget
        # and throughput timers begin.
        from alignment_finance_monitor import monitor_callback
        callbacks.append(monitor_callback(config, os.environ["ENDER_ALIGNMENT_FINANCE_PROBES"]))
    callbacks.append(Throughput())
    if retep_initial is not None and not retep_shadow:
        raise ValueError("Sister warm start requires --retep-shadow")
    if retep_shadow:
        from retep_shadow import retep_callback
        callbacks.append(retep_callback(retep_initial, config.get("resume_from_checkpoint")))
    if train_seconds is not None:
        from timed_training import deadline_callback
        callbacks.append(deadline_callback(train_seconds))
    with gpu_first_loading(target_device="cpu" if config.get("quantization_bit") else "cuda:0"):
        run_exp(args=config, callbacks=callbacks)
    if decode_output is not None:
        from baseline import MODEL, REVISION
        from transformers import AutoTokenizer
        from demo_decode import benchmark
        tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
        print("Reusing trained model for decode: no second 55 GB checkpoint load.", flush=True)
        benchmark(trained["model"], tokenizer, decode_output, max_new_tokens=decode_max_new_tokens,
                  repeats=decode_repeats, reused_from_training=True, evaluation_config=config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--max-steps", type=int, default=12)
    parser.add_argument("--accept-synthetic-demo", action="store_true")
    parser.add_argument("--stop-idle-project-server", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--decode-repeats", type=int, default=3)
    parser.add_argument("--decode-max-new-tokens", type=int, default=128)
    parser.add_argument("--train-worker", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--decode-output", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--memory-fraction", type=float, help=argparse.SUPPRESS)
    parser.add_argument("--retep-shadow", action="store_true",
                        help="Experimental sister AdamW on negated primary gradients; not a validated adversary")
    parser.add_argument("--retep-initial", type=Path, help="Continue saved sister weights with fresh optimizer state")
    parser.add_argument("--train-seconds", type=float, help="Stop gracefully at an optimizer boundary after this training-time budget")
    args = parser.parse_args()
    if args.decode_repeats < 1 or args.decode_max_new_tokens < 2:
        parser.error("Decode requires at least one repeat and two generated tokens")
    if args.memory_fraction is not None and not 0 < args.memory_fraction <= 1:
        parser.error("Memory fraction must be in (0, 1]")
    startup = configure_startup()
    import yaml
    if args.train_worker:
        train_worker(yaml.safe_load(args.train_worker.read_text()), args.decode_output,
                     args.decode_repeats, args.decode_max_new_tokens, args.memory_fraction, args.retep_shadow,
                     args.retep_initial, args.train_seconds)
        return
    if not args.accept_synthetic_demo:
        parser.error("Demo data is synthetic and unreviewed; pass --accept-synthetic-demo explicitly")
    if args.data_root is None or args.output is None or args.max_steps < 1:
        parser.error("Need --data-root, --output, and positive --max-steps")
    run = args.output.resolve()
    run.mkdir(parents=True, exist_ok=False)
    manifest = {"status": "preparing", "started_at": datetime.now(timezone.utc).isoformat(),
                "architecture": platform.machine(), "official_resources": SOURCES,
                "synthetic_unreviewed_demo": True, "full_finetuning": False,
                "method": "BF16 frozen base plus LoRA; no weight quantization",
                "scope": "policy-plan SFT pipeline smoke, not independent alignment evaluation",
                "max_steps": args.max_steps}
    manifest["startup_environment"] = startup
    write_json(run / "manifest.json", manifest)
    try:
        dataset = run / "data"
        build(args.data_root, HERE / "data/demo_responses.json", dataset)
        from baseline import MODEL, REVISION
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
        lengths = []
        for split in ("train", "validation"):
            for row in json.loads((dataset / f"{split}.json").read_text()):
                messages = [{"role": "system", "content": row["system"]},
                            {"role": "user", "content": row["instruction"] + "\n" + row["input"]},
                            {"role": "assistant", "content": row["output"]}]
                size = len(token_ids(tokenizer.apply_chat_template(messages, enable_thinking=False)))
                if size + 32 > 1024:
                    raise ValueError(f"{row['scenario_id']} needs {size} tokens: refusing truncation")
                lengths.append(size)
        manifest["token_lengths"] = {"max": max(lengths), "min": min(lengths),
                                      "mean": sum(lengths) / len(lengths), "cutoff": 1024}
        config = yaml.safe_load((HERE / "configs/qwen38_27b_lora.yaml").read_text())
        config.update(dataset_dir=str(dataset), dataset="demo_train", eval_dataset="demo_validation",
                      output_dir=str(run / "adapter"), lora_rank=8, lora_alpha=16,
                      cutoff_len=1024, max_steps=args.max_steps, gradient_accumulation_steps=2,
                      preprocessing_num_workers=1, save_strategy="steps", save_steps=4,
                      save_total_limit=2, eval_strategy="no", plot_loss=False,
                      include_num_input_tokens_seen=True)
        config_path = run / "train.yaml"
        config_path.write_text(yaml.safe_dump(config, sort_keys=False))
        # Preserve source/version details without including environment variables or auth tokens.
        for path in (HERE / "run_sft_demo.py", HERE / "demo_decode.py", HERE / "build_demo_data.py",
                     HERE / "spark_runtime.py", HERE / "audit_sft_data.py"):
            manifest.setdefault("source_sha256", {})[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        freeze = subprocess.run([sys.executable, "-m", "pip", "freeze"], capture_output=True, text=True, check=True)
        (run / "requirements.lock.txt").write_text(freeze.stdout)
        from llamafactory.hparams import get_train_args
        get_train_args(config)
        if args.prepare_only:
            manifest["status"] = "prepared_not_trained"
            print("DATA AND TRAINING CONFIG VALIDATED: " + str(run), flush=True)
            return
        from transformers.models.qwen3_5.modeling_qwen3_5 import is_fast_path_available
        if not is_fast_path_available:
            raise ValueError("Install and validate FLA/causal-conv1d with setup_demo_kernels.sh first")
        manifest["hybrid_attention_fast_path_imports"] = True
        if args.stop_idle_project_server:
            stop_project_server(run)
        import torch
        if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
            raise ValueError("BF16 CUDA support is required")
        manifest.update(gpu=torch.cuda.get_device_name(0), torch=torch.__version__, cuda=torch.version.cuda)
        free, total = torch.cuda.mem_get_info()
        manifest["cuda_free_before_training_gib"] = free / 2**30
        # On Spark this is unified memory. Refuse an obviously occupied device.
        if free < 65 * 2**30:
            raise ValueError(f"Only {free/2**30:.1f} GiB free; release other workloads explicitly first")
        manifest["status"] = "training"
        write_json(run / "manifest.json", manifest)
        env = {**os.environ, "WANDB_DISABLED": "true", "HF_HUB_OFFLINE": "1",
               "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "8"}
        with telemetry(run):
            subprocess.run([sys.executable, "-u", str(HERE / "run_sft_demo.py"),
                            "--train-worker", str(config_path), "--decode-output", str(run / "decode.json"),
                            "--decode-repeats", str(args.decode_repeats),
                            "--decode-max-new-tokens", str(args.decode_max_new_tokens)],
                           env=env, check=True)
        if not (run / "adapter/adapter_model.safetensors").is_file():
            raise ValueError("Training returned without a saved adapter")
        from safetensors import safe_open
        adapter_path = run / "adapter/adapter_model.safetensors"
        with safe_open(adapter_path, framework="pt", device="cpu") as weights:
            b_keys = [key for key in weights.keys() if "lora_B" in key]
            changed = [key for key in b_keys if weights.get_tensor(key).count_nonzero().item() > 0]
        if not changed:
            raise ValueError("All zero-initialized LoRA B matrices remain zero")
        write_json(run / "adapter-validation.json", {
            "lora_b_matrices": len(b_keys), "nonzero_lora_b_matrices": len(changed),
            "note": "Nonzero trained matrices verify an update, not alignment improvement"})
        if not (run / "decode.json").is_file():
            raise ValueError("Worker returned without reused-model decode results")
        steps = [json.loads(line) for line in (run / "throughput.jsonl").read_text().splitlines()]
        steady = steps[2:] or steps
        summary = {"training_optimizer_steps": len(steps),
                   "median_training_input_tokens_per_second_excluding_first_two_steps": statistics.median(
                       row["step_input_tokens_per_second"] for row in steady),
                   "peak_training_cuda_allocated_gib": max(row["peak_cuda_allocated_gib"] for row in steps),
                   "decode": json.loads((run / "decode.json").read_text())["summary"],
                   "alignment_improvement_established": False}
        write_json(run / "summary.json", summary)
        print("MEASURED DEMO SUMMARY: " + json.dumps(summary, indent=2), flush=True)
        manifest["status"] = "complete"
    except BaseException as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(run / "manifest.json", manifest)
    print("DEMO COMPLETE: " + str(run), flush=True)


if __name__ == "__main__":
    main()
