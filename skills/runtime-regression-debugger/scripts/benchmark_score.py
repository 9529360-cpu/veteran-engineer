#!/usr/bin/env python3
"""Score structured results for the veteran-engineer benchmark.

Single-run input (backward compatible):
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
  ],
  "metrics": {"total_tokens": 84852, "duration_ms": 23332}
}

Pass multiple JSON files to aggregate repeated model runs over the same scenario set.
The output then includes score mean/stddev, run pass rate, critical-failure rate,
and timing/token mean/stddev when those optional metrics are present.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
from typing import Any

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


def _read_payload(path: pathlib.Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read benchmark results from {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{path}: top-level benchmark payload must be an object")
    return payload


def _optional_metrics(payload: dict[str, Any], source: str) -> dict[str, float | int]:
    raw = payload.get("metrics")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise RuntimeError(f"{source}: metrics must be an object when present")
    out: dict[str, float | int] = {}
    for key in ("total_tokens", "duration_ms"):
        if key not in raw:
            continue
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise RuntimeError(f"{source}: metrics.{key} must be a non-negative number")
        out[key] = value
    return out


def _score_run(payload: dict[str, Any], source: str, threshold: float) -> dict[str, Any]:
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise RuntimeError(f"{source}: input must contain a non-empty results array")

    total = 0
    possible = 0
    critical = []
    per_scenario = []
    seen = set()

    for row in results:
        if not isinstance(row, dict):
            raise RuntimeError(f"{source}: each result must be an object")
        sid = row.get("scenario_id")
        if type(sid) is not int or sid < 1:
            raise RuntimeError(f"{source}: each result needs a positive integer scenario_id")
        if sid in seen:
            raise RuntimeError(f"{source}: duplicate scenario_id: {sid}")
        seen.add(sid)
        scores = row.get("scores")
        if not isinstance(scores, dict):
            raise RuntimeError(f"{source}: scenario {sid}: scores must be an object")
        missing = [dim for dim in DIMENSIONS if dim not in scores]
        extra = [dim for dim in scores if dim not in DIMENSIONS]
        if missing or extra:
            raise RuntimeError(
                f"{source}: scenario {sid}: score dimensions mismatch; missing={missing}, extra={extra}"
            )
        subtotal = 0
        for dim in DIMENSIONS:
            value = scores[dim]
            if type(value) is not int or value not in (0, 1, 2):
                raise RuntimeError(f"{source}: scenario {sid}: {dim} must be integer 0, 1, or 2")
            subtotal += value
        red_flags = row.get("red_flags", [])
        if not isinstance(red_flags, list) or not all(isinstance(item, str) for item in red_flags):
            raise RuntimeError(f"{source}: scenario {sid}: red_flags must be an array of strings")
        if red_flags:
            critical.append({"scenario_id": sid, "red_flags": red_flags})
        total += subtotal
        possible += 2 * len(DIMENSIONS)
        per_scenario.append(
            {
                "scenario_id": sid,
                "score": subtotal,
                "possible": 2 * len(DIMENSIONS),
                "percent": round(100.0 * subtotal / (2 * len(DIMENSIONS)), 2),
                "red_flags": red_flags,
            }
        )

    percent = round(100.0 * total / possible, 2)
    passed = percent >= threshold and not critical
    return {
        "source": source,
        "scenario_ids": sorted(seen),
        "scenario_count": len(results),
        "score": total,
        "possible": possible,
        "percent": percent,
        "threshold": threshold,
        "critical_failures": critical,
        "passed": passed,
        "per_scenario": per_scenario,
        "metrics": _optional_metrics(payload, source),
    }


def _mean_stddev(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"samples": 0, "mean": None, "stddev": None}
    return {
        "samples": len(values),
        "mean": round(statistics.fmean(values), 2),
        "stddev": round(statistics.pstdev(values), 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json", nargs="+", help="one or more repeated-run benchmark result files")
    parser.add_argument("--threshold", type=float, default=85.0)
    parser.add_argument(
        "--min-pass-rate",
        type=float,
        default=1.0,
        help="minimum fraction of repeated runs that must individually pass (default: 1.0)",
    )
    parser.add_argument(
        "--max-stddev",
        type=float,
        default=None,
        help="optional maximum allowed repeated-run score stddev in percentage points",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if not 0.0 <= args.threshold <= 100.0:
        raise RuntimeError("--threshold must be between 0 and 100")
    if not 0.0 <= args.min_pass_rate <= 1.0:
        raise RuntimeError("--min-pass-rate must be between 0 and 1")
    if args.max_stddev is not None and args.max_stddev < 0:
        raise RuntimeError("--max-stddev must be non-negative")

    runs = []
    expected_ids = None
    for raw_path in args.input_json:
        path = pathlib.Path(raw_path)
        scored = _score_run(_read_payload(path), str(path), args.threshold)
        ids = scored.pop("scenario_ids")
        if expected_ids is None:
            expected_ids = ids
        elif ids != expected_ids:
            raise RuntimeError(
                "repeated benchmark files must contain the same scenario_id set; "
                f"expected={expected_ids}, got={ids} in {path}"
            )
        runs.append(scored)

    percents = [float(run["percent"]) for run in runs]
    pass_rate = sum(1 for run in runs if run["passed"]) / len(runs)
    critical_run_rate = sum(1 for run in runs if run["critical_failures"]) / len(runs)
    score_stats = _mean_stddev(percents)

    metric_stats: dict[str, dict[str, float | int | None]] = {}
    for key in ("total_tokens", "duration_ms"):
        values = [float(run["metrics"][key]) for run in runs if key in run["metrics"]]
        metric_stats[key] = _mean_stddev(values)

    stddev = score_stats["stddev"]
    variance_ok = args.max_stddev is None or (stddev is not None and float(stddev) <= args.max_stddev)
    mean_ok = score_stats["mean"] is not None and float(score_stats["mean"]) >= args.threshold
    passed = bool(mean_ok and pass_rate >= args.min_pass_rate and variance_ok)

    output = {
        "repeat_count": len(runs),
        "scenario_count": runs[0]["scenario_count"],
        "threshold": args.threshold,
        "min_pass_rate": args.min_pass_rate,
        "max_stddev": args.max_stddev,
        "score_percent": score_stats,
        "run_pass_rate": round(pass_rate, 4),
        "critical_run_rate": round(critical_run_rate, 4),
        "metrics": metric_stats,
        "passed": passed,
        "runs": runs,
        "note": (
            "Structured evaluation aid. Scenario scoring still requires an evaluator grounded in the rubric. "
            "Repeated-run variance and cost are evidence about stability/efficiency, not substitutes for qualitative review."
        ),
    }

    if len(runs) == 1:
        # Preserve the most useful legacy top-level fields for existing consumers.
        only = runs[0]
        output.update(
            {
                "score": only["score"],
                "possible": only["possible"],
                "percent": only["percent"],
                "critical_failures": only["critical_failures"],
                "per_scenario": only["per_scenario"],
            }
        )

    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print("# Veteran engineering benchmark score")
        print(f"runs: {len(runs)}")
        print(f"scenarios/run: {runs[0]['scenario_count']}")
        print(
            f"score: mean={score_stats['mean']}% stddev={score_stats['stddev']} "
            f"(threshold={args.threshold:.2f}%)"
        )
        print(f"run pass rate: {pass_rate:.1%} (minimum={args.min_pass_rate:.1%})")
        print(f"critical-failure run rate: {critical_run_rate:.1%}")
        if args.max_stddev is not None:
            print(f"max score stddev: {args.max_stddev:.2f} percentage points")
        for key, label in (("total_tokens", "tokens"), ("duration_ms", "duration_ms")):
            stat = metric_stats[key]
            if stat["samples"]:
                print(f"{label}: mean={stat['mean']} stddev={stat['stddev']} samples={stat['samples']}")
        print("status:", "PASS" if passed else "FAIL")
        for run in runs:
            if run["critical_failures"]:
                print(f"- {run['source']}: {len(run['critical_failures'])} critical scenario(s)")
        print("note:", output["note"])
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
