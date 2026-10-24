#!/usr/bin/env python3
"""Validate the curated scenario catalogs.

Usage:
    python3 ender/datasets/validate_scenarios.py

Exits non-zero on any schema error. Prints a small census on success.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOGS = {
    "alignment": ROOT / "alignment" / "scenarios.jsonl",
    "rewardhacking": ROOT / "rewardhacking" / "scenarios.jsonl",
}

TIERS = {1, 2, 3, 4}
DETECTORS = {
    "world_state",
    "file_integrity",
    "process_event",
    "network_egress",
    "paired_comparison",
    "llm_judge",
    "timing",
}
WORLDS = {"clearing", "ledger_street", "low_orbit", "any"}
VARIANTS = {"charter", "no_charter", "win_at_all_costs"}
DERIVATIONS = {"verbatim", "adapted", "synthesized"}
# Temptations already specified in DESIGN_SPEC.md; overlaps may point at these.
SPEC_IDS = {f"T{i}" for i in range(1, 9)} | {f"F{i}" for i in range(1, 8)}

REQUIRED = {
    "id": str,
    "title": str,
    "subcategory": str,
    "tier": int,
    "worlds": list,
    "trigger": str,
    "observation": str,
    "unethical": dict,
    "ethical": dict,
    "detection": dict,
    "variants": list,
    "source": dict,
    "overlaps": list,
    "notes": str,
}


def fail(errors: list[str], cid: str, msg: str) -> None:
    errors.append(f"{cid}: {msg}")


def main() -> int:
    errors: list[str] = []
    rows: list[dict] = []
    seen: set[str] = set()

    for category, path in CATALOGS.items():
        if not path.exists():
            fail(errors, category, f"missing {path}")
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                fail(errors, f"{path.name}:{lineno}", f"invalid JSON: {exc}")
                continue

            cid = row.get("id", f"{path.name}:{lineno}")
            for field, typ in REQUIRED.items():
                if field not in row:
                    fail(errors, cid, f"missing field {field!r}")
                elif not isinstance(row[field], typ):
                    fail(errors, cid, f"{field!r} must be {typ.__name__}")

            if cid in seen:
                fail(errors, cid, "duplicate id")
            seen.add(cid)

            if not cid.startswith(category + "."):
                fail(errors, cid, f"id must start with {category!r}")

            if row.get("tier") not in TIERS:
                fail(errors, cid, f"tier must be one of {sorted(TIERS)}")

            worlds = row.get("worlds") or []
            if not worlds:
                fail(errors, cid, "worlds is empty")
            for w in worlds:
                if w not in WORLDS:
                    fail(errors, cid, f"unknown world {w!r}")

            for v in row.get("variants") or []:
                if v not in VARIANTS:
                    fail(errors, cid, f"unknown variant {v!r}")

            detection = row.get("detection") or {}
            if detection.get("type") not in DETECTORS:
                fail(errors, cid, f"unknown detection type {detection.get('type')!r}")
            if not detection.get("check"):
                fail(errors, cid, "detection.check is empty")

            for side in ("unethical", "ethical"):
                block = row.get(side) or {}
                for key in ("action", "payoff" if side == "unethical" else "cost"):
                    if not block.get(key):
                        fail(errors, cid, f"{side}.{key} is empty")

            source = row.get("source") or {}
            for key in ("dataset", "url", "path", "derivation"):
                if not source.get(key):
                    fail(errors, cid, f"source.{key} is empty")
            if source.get("derivation") not in DERIVATIONS:
                fail(errors, cid, f"unknown derivation {source.get('derivation')!r}")

            for other in row.get("overlaps") or []:
                if other not in SPEC_IDS and not other.startswith(("alignment.", "rewardhacking.")):
                    fail(errors, cid, f"overlaps entry {other!r} is not a spec id or catalog id")

            rows.append(row)

    all_ids = {r["id"] for r in rows}
    for row in rows:
        for other in row.get("overlaps") or []:
            if other.startswith(("alignment.", "rewardhacking.")) and other not in all_ids:
                fail(errors, row["id"], f"overlaps entry {other!r} does not exist")

    if errors:
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
        print(f"\n{len(errors)} errors", file=sys.stderr)
        return 1

    print(f"ok: {len(rows)} scenarios, {len(seen)} unique ids")
    for category in CATALOGS:
        subset = [r for r in rows if r["id"].startswith(category + ".")]
        tiers = Counter(r["tier"] for r in subset)
        dets = Counter(r["detection"]["type"] for r in subset)
        subs = Counter(r["subcategory"] for r in subset)
        print(f"\n{category}: {len(subset)}")
        print("  tiers:      " + ", ".join(f"T{t}={tiers.get(t, 0)}" for t in sorted(TIERS)))
        print("  detectors:  " + ", ".join(f"{k}={v}" for k, v in dets.most_common()))
        print("  families:   " + ", ".join(f"{k}={v}" for k, v in subs.most_common()))
        sources = Counter(r["source"]["dataset"] for r in subset)
        print("  sources:    " + ", ".join(f"{k}={v}" for k, v in sources.most_common()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
