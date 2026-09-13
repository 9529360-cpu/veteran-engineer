#!/usr/bin/env python3
"""Extract and deterministically sample veteran-engineer benchmark scenarios.

Usage:
  benchmark_plan.py [--benchmark PATH] [--count 12] [--seed 1] [--json]

This does not score model quality. It creates a stable evaluation set for comparing
Skill revisions without cherry-picking scenarios.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import re
import sys

SCENARIO_RE = re.compile(r"^(\d+)\. \*\*(.+?)\*\*: (.+)$")


def load_scenarios(path: pathlib.Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = SCENARIO_RE.match(line.strip())
        if match:
            rows.append({
                "id": int(match.group(1)),
                "title": match.group(2),
                "scenario": match.group(3),
            })
    if not rows:
        raise RuntimeError("no benchmark scenarios found")
    ids = [row["id"] for row in rows]
    expected = list(range(1, len(rows) + 1))
    if ids != expected:
        raise RuntimeError(f"scenario ids must be sequential from 1; got {ids}")
    return rows


def main() -> int:
    default_path = pathlib.Path(__file__).resolve().parent.parent / "references" / "veteran-engineer-benchmark.md"
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", default=str(default_path))
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    path = pathlib.Path(args.benchmark)
    if not path.is_file():
        raise RuntimeError(f"benchmark not found: {path}")
    scenarios = load_scenarios(path)
    if args.count < 1:
        raise RuntimeError("--count must be >= 1")
    count = min(args.count, len(scenarios))
    rng = random.Random(args.seed)
    chosen = sorted(rng.sample(scenarios, count), key=lambda row: row["id"])

    payload = {
        "benchmark": str(path),
        "scenario_count": len(scenarios),
        "sample_count": count,
        "seed": args.seed,
        "scenarios": chosen,
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"# Veteran engineering benchmark sample (seed={args.seed}, count={count})")
        for row in chosen:
            print(f"{row['id']}. {row['title']}: {row['scenario']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
