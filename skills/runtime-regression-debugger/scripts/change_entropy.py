#!/usr/bin/env python3
"""Estimate semantic change entropy from explicit boundary counts.

The score is a review/decomposition prompt, not a release gate.
"""
from __future__ import annotations
import argparse, json

WEIGHTS = {
    "state_owners": 3,
    "persistence_boundaries": 4,
    "async_boundaries": 3,
    "protocol_boundaries": 4,
    "deploy_units": 2,
    "security_boundaries": 5,
    "irreversible_effects": 6,
    "critical_unknowns": 4,
}

def main() -> int:
    p = argparse.ArgumentParser()
    for name in WEIGHTS:
        p.add_argument("--" + name.replace("_", "-"), type=int, default=0)
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    values = {name: max(0, getattr(a, name)) for name in WEIGHTS}
    score = sum(values[name] * WEIGHTS[name] for name in WEIGHTS)
    if score <= 10:
        band = "low"
        advice = "Keep the mechanism local and validate normally."
    elif score <= 24:
        band = "moderate"
        advice = "Review boundary companions and compatibility; stage if a clean seam exists."
    elif score <= 44:
        band = "high"
        advice = "Prefer decomposition, explicit compatibility, recovery evidence, and progressive exposure."
    else:
        band = "very-high"
        advice = "Challenge the design before implementation; reduce simultaneous assumptions or prove why they cannot be separated."
    payload = {
        "inputs": values,
        "weights": WEIGHTS,
        "score": score,
        "band": band,
        "advice": advice,
        "note": "Heuristic only. A small auth/data/money change can still be critical regardless of score.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Change entropy")
        print("score:", score)
        print("band:", band)
        print("advice:", advice)
        print("note:", payload["note"])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
