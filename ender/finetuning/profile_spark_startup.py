#!/usr/bin/env python3
"""Profile bounded startup, held-out loss, and decoding without retraining an adapter."""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from run_sft_demo import telemetry, write_json
from spark_runtime import configure_startup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--eval-config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference-decode", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    startup = configure_startup()
    started = time.perf_counter()
    with telemetry(args.output):
        subprocess.run([sys.executable, "-u", str(Path(__file__).with_name("demo_decode.py")),
                        "--adapter", str(args.adapter), "--eval-config", str(args.eval_config),
                        "--output", str(args.output / "decode.json"), "--max-new-tokens", "64",
                        "--repeats", "1"], check=True)
    result = json.loads((args.output / "decode.json").read_text())
    samples = [json.loads(line) for line in (args.output / "telemetry.jsonl").read_text().splitlines()]
    report = {"startup_environment": startup, "wall_seconds": time.perf_counter() - started,
              "model_load_seconds": result["model_load_seconds"],
              "decode": result["summary"], "loss_comparison": result.get("loss_comparison"),
              "min_available_memory_gib": min(r["MemAvailable_gib"] for r in samples),
              "max_additional_swap_gib": max(0, samples[0]["SwapFree_gib"] - min(r["SwapFree_gib"] for r in samples))}
    if args.reference_decode:
        old = json.loads(args.reference_decode.read_text())
        report.update(reference_model_load_seconds=old["model_load_seconds"],
                      observed_load_speedup=old["model_load_seconds"] / result["model_load_seconds"],
                      comparison_limitations="Separate runs; filesystem cache state and other system conditions are not controlled.")
    write_json(args.output / "startup-profile.json", report)
    print("STARTUP PROFILE: " + json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
