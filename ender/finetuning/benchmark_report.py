"""Summarize matched Spark probes; never infer quality or decode speed from training."""

import argparse
import json
from pathlib import Path


def summarize(root):
    rows = []
    for path in sorted(root.iterdir()):
        manifest_path, summary_path = path / "manifest.json", path / "summary.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text())
        row = {"variant": path.name, "status": manifest["status"], "source_sha256": manifest["source_sha256"],
               "selected_rows": manifest["selected_rows"]}
        if summary_path.exists():
            summary = json.loads(summary_path.read_text())
            steps = summary["steps"]
            # Probe repeats each bucket twice; report second occurrence, with its exact length.
            by_length = {}
            for step in steps:
                by_length[step["tokens"]] = step
            row.update(warmed_steps=list(by_length.values()),
                       peak_cuda_allocated_gib=summary["peak_cuda_allocated_gib"],
                       probe_wall_seconds=summary["wall_seconds_including_setup"])
        telemetry_path = path / "telemetry.jsonl"
        if telemetry_path.exists():
            samples = [json.loads(line) for line in telemetry_path.read_text().splitlines()]
            swap = [sample["SwapFree_gib"] for sample in samples if "SwapFree_gib" in sample]
            available = [sample["MemAvailable_gib"] for sample in samples if "MemAvailable_gib" in sample]
            if swap:
                row["maximum_swap_growth_gib"] = max(0, swap[0]-min(swap))
            if available:
                row["minimum_system_memory_available_gib"] = min(available)
        if "error" in manifest:
            row["error"] = manifest["error"]
        rows.append(row)
    if rows and any((r["source_sha256"], r["selected_rows"]) !=
                    (rows[0]["source_sha256"], rows[0]["selected_rows"]) for r in rows):
        raise ValueError("Cannot compare probes with different source data/selected examples")
    return {"variants": rows, "decode_benchmarked": False,
            "quality_improvement_established": False,
            "note": "Second occurrences are warmed estimates, not rigorous full-epoch ETAs. Profiled steps are distorted."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    print(json.dumps(summarize(args.root), indent=2))
