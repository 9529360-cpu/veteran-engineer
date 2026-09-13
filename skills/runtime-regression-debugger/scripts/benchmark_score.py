#!/usr/bin/env python3
"""Score structured results for the veteran-engineer benchmark.

Input JSON format:
{
  "results": [
    {
      "scenario_id": 1,
      "scores": {
        "contract_invariant": 2,
        "ownership": 2,
        "evidence": 2,
        "safety_compatibility": 2,
        "failure_model": 2,
        "validation": 2,
        "rollout_recovery": 1,
        "simplicity": 2,
        "delivery_closure": 2,
        "claim_calibration": 2
      },
      "red_flags": []
    }
  ]
}

Scores are 0..2. Any non-empty red_flags entry is treated as a critical benchmark failure.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

DIMENSIONS = (
    "contract_invariant",
    "ownership",
    "evidence",
    "safety_compatibility",
    "failure_model",
    "validation",
    "rollout_recovery",
    "simplicity",
    "delivery_closure",
    "claim_calibration",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json")
    parser.add_argument("--threshold", type=float, default=85.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    path = pathlib.Path(args.input_json)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read benchmark results: {exc}") from exc

    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise RuntimeError("input must contain a non-empty results array")

    total = 0
    possible = 0
    critical = []
    per_scenario = []
    seen = set()

    for row in results:
        sid = row.get("scenario_id")
        if not isinstance(sid, int) or sid < 1:
            raise RuntimeError("each result needs a positive integer scenario_id")
        if sid in seen:
            raise RuntimeError(f"duplicate scenario_id: {sid}")
        seen.add(sid)
        scores = row.get("scores")
        if not isinstance(scores, dict):
            raise RuntimeError(f"scenario {sid}: scores must be an object")
        missing = [dim for dim in DIMENSIONS if dim not in scores]
        extra = [dim for dim in scores if dim not in DIMENSIONS]
        if missing or extra:
            raise RuntimeError(f"scenario {sid}: score dimensions mismatch; missing={missing}, extra={extra}")
        subtotal = 0
        for dim in DIMENSIONS:
            value = scores[dim]
            if not isinstance(value, int) or value not in (0, 1, 2):
                raise RuntimeError(f"scenario {sid}: {dim} must be integer 0, 1, or 2")
            subtotal += value
        red_flags = row.get("red_flags", [])
        if not isinstance(red_flags, list) or not all(isinstance(item, str) for item in red_flags):
            raise RuntimeError(f"scenario {sid}: red_flags must be an array of strings")
        if red_flags:
            critical.append({"scenario_id": sid, "red_flags": red_flags})
        total += subtotal
        possible += 2 * len(DIMENSIONS)
        per_scenario.append({
            "scenario_id": sid,
            "score": subtotal,
            "possible": 2 * len(DIMENSIONS),
            "percent": round(100.0 * subtotal / (2 * len(DIMENSIONS)), 2),
            "red_flags": red_flags,
        })

    percent = round(100.0 * total / possible, 2)
    passed = percent >= args.threshold and not critical
    output = {
        "scenario_count": len(results),
        "score": total,
        "possible": possible,
        "percent": percent,
        "threshold": args.threshold,
        "critical_failures": critical,
        "passed": passed,
        "per_scenario": per_scenario,
        "note": "Structured evaluation aid; scenario scoring still requires an evaluator grounded in the benchmark rubric.",
    }
    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print("# Veteran engineering benchmark score")
        print(f"scenarios: {len(results)}")
        print(f"score: {total}/{possible} ({percent:.2f}%)")
        print(f"threshold: {args.threshold:.2f}%")
        print(f"critical failures: {len(critical)}")
        print("status:", "PASS" if passed else "FAIL")
        for item in critical:
            print(f"- scenario {item['scenario_id']}: " + "; ".join(item["red_flags"]))
        print("note:", output["note"])
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
