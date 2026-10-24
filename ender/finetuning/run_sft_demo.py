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


def train_worker(config):
    import torch
    from transformers import TrainerCallback
    from llamafactory.train.tuner import run_exp

    class Throughput(TrainerCallback):
        def on_train_begin(self, args, state, control, **kwargs):
            model = kwargs["model"]
            trainable = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
            if not trainable or any("lora_" not in n for n, _ in trainable):
                raise ValueError("Expected LoRA-only trainable parameters")
            if any(p.device.type != "cuda" for p in model.parameters()):
                raise ValueError("Training requires all parameters on CUDA, without CPU offload")
            if getattr(model, "is_quantized", False):
                raise ValueError("Demo must not quantize the base weights")
            print("[training validation] " + json.dumps({
                "trainable_parameters": sum(p.numel() for _, p in trainable),
                "total_parameters": sum(p.numel() for p in model.parameters()),
                "trainable_dtypes": sorted({str(p.dtype) for _, p in trainable}),
                "frozen_dtypes": sorted({str(p.dtype) for p in model.parameters() if not p.requires_grad}),
                "lora_only": True, "all_cuda": True}), flush=True)
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            self.start = self.last = time.perf_counter()
            self.tokens = 0

        def on_step_end(self, args, state, control, **kwargs):
            torch.cuda.synchronize()
            now = time.perf_counter()
            tokens = state.num_input_tokens_seen
            row = {"step": state.global_step, "elapsed_seconds": now - self.start,
                   "step_seconds": now - self.last, "input_tokens_seen": tokens,
                   "step_input_tokens_per_second": (tokens - self.tokens) / (now - self.last),
                   "cumulative_input_tokens_per_second": tokens / (now - self.start),
                   "cuda_allocated_gib": torch.cuda.memory_allocated() / 2**30,
                   "peak_cuda_allocated_gib": torch.cuda.max_memory_allocated() / 2**30,
                   "note": "teacher-forced training input throughput, NOT autoregressive decode speed"}
            with (Path(args.output_dir).parent / "throughput.jsonl").open("a") as handle:
                handle.write(json.dumps(row) + "\n")
            print("[training throughput] " + json.dumps(row), flush=True)
            self.last, self.tokens = now, tokens

    torch.set_num_threads(8)
    run_exp(args=config, callbacks=[Throughput()])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--max-steps", type=int, default=12)
    parser.add_argument("--accept-synthetic-demo", action="store_true")
    parser.add_argument("--stop-idle-project-server", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--train-worker", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    import yaml
    if args.train_worker:
        train_worker(yaml.safe_load(args.train_worker.read_text()))
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
                size = len(tokenizer.apply_chat_template(messages, enable_thinking=False))
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
        for path in (HERE / "run_sft_demo.py", HERE / "demo_decode.py", HERE / "build_demo_data.py"):
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
                            "--train-worker", str(config_path)], env=env, check=True)
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
        manifest["status"] = "decoding"
        write_json(run / "manifest.json", manifest)
        with telemetry(run):
            subprocess.run([sys.executable, "-u", str(HERE / "demo_decode.py"),
                            "--adapter", str(run / "adapter"), "--output", str(run / "decode.json")],
                           env=env, check=True)
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
