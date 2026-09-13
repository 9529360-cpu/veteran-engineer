#!/usr/bin/env python3
"""Estimate a rough admission/load-shedding budget for a constrained downstream.

This calculator converts downstream attempt capacity into a maximum admitted logical
request rate under explicit retry, reserve, and safety-margin assumptions.

Example:
  load_shed_budget.py --incoming-rps 5000 --downstream-capacity-rps 4200 --safety-margin 0.2 --retry-fraction 0.1 --avg-retries 1.5 --reserved-rps 300
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass


@dataclass
class Estimate:
    name: str
    value: float | str
    unit: str
    note: str


def non_negative(value: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return parsed


def positive(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be > 0")
    return parsed


def fraction(value: str) -> float:
    parsed = float(value)
    if not 0 <= parsed < 1:
        raise argparse.ArgumentTypeError("must be >= 0 and < 1")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--incoming-rps", type=non_negative, required=True, help="incoming logical request rate")
    p.add_argument("--downstream-capacity-rps", type=positive, required=True, help="measured sustainable attempt capacity of the protected bottleneck")
    p.add_argument("--safety-margin", type=fraction, default=0.2, help="fraction of capacity intentionally kept as headroom; default 0.2")
    p.add_argument("--reserved-rps", type=non_negative, default=0.0, help="attempt capacity reserved for critical/control traffic")
    p.add_argument("--retry-fraction", type=fraction, default=0.0, help="fraction of admitted logical requests expected to retry")
    p.add_argument("--avg-retries", type=non_negative, default=0.0, help="average retry attempts for requests that retry")
    p.add_argument("--json", action="store_true", help="emit JSON")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    retry_multiplier = 1.0 + a.retry_fraction * a.avg_retries
    headroom_capacity = a.downstream_capacity_rps * (1.0 - a.safety_margin)
    usable_attempt_capacity = max(0.0, headroom_capacity - a.reserved_rps)
    max_logical_admit = usable_attempt_capacity / retry_multiplier
    admitted = min(a.incoming_rps, max_logical_admit)
    shed = max(0.0, a.incoming_rps - admitted)
    shed_pct = (shed / a.incoming_rps * 100.0) if a.incoming_rps > 0 else 0.0
    expected_attempts = admitted * retry_multiplier
    utilization = (expected_attempts / a.downstream_capacity_rps * 100.0) if a.downstream_capacity_rps > 0 else 0.0

    notes = [
        Estimate(
            "retry_load_multiplier",
            retry_multiplier,
            "x",
            "Logical admitted requests multiplied by the explicit retry assumptions; retries in other layers are not included.",
        ),
        Estimate(
            "usable_attempt_capacity",
            usable_attempt_capacity,
            "attempts/s",
            "Protected downstream capacity after the requested safety margin and critical/control reserve.",
        ),
        Estimate(
            "max_logical_admission_rate",
            max_logical_admit,
            "requests/s",
            "Maximum rough logical admission rate that keeps expected attempts inside the usable capacity.",
        ),
        Estimate(
            "suggested_admitted_rate",
            admitted,
            "requests/s",
            "Incoming demand capped at the rough maximum logical admission rate.",
        ),
        Estimate(
            "suggested_shed_rate",
            shed,
            "requests/s",
            "Logical demand to reject, defer, or route elsewhere under the provided assumptions.",
        ),
        Estimate(
            "suggested_shed_fraction",
            shed_pct,
            "%",
            "Planning fraction only; apply product priority/fairness rules rather than random shedding when possible.",
        ),
        Estimate(
            "expected_downstream_utilization",
            utilization,
            "%",
            "Expected attempt utilization of the measured downstream capacity after shedding; burstiness and queueing are not modeled.",
        ),
    ]
    if a.reserved_rps > headroom_capacity:
        notes.append(Estimate(
            "warning",
            "reserved capacity exceeds headroom-adjusted capacity",
            "",
            "No non-reserved workload can be admitted under the supplied reserve and safety margin.",
        ))
    return notes


def format_value(value: float | str) -> str:
    if isinstance(value, float) and math.isfinite(value):
        if abs(value) >= 1000:
            return f"{value:,.2f}"
        return f"{value:.3f}".rstrip("0").rstrip(".")
    return str(value)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    estimates = calculate(args)

    if args.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("Load-shedding budget (rough planning estimates)")
        for e in estimates:
            suffix = f" {e.unit}" if e.unit else ""
            print(f"- {e.name}: {format_value(e.value)}{suffix}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
