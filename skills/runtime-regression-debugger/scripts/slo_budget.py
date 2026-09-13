#!/usr/bin/env python3
"""Calculate simple SLO error-budget and burn-rate planning figures.

Examples:
  slo_budget.py --slo 99.9 --window-days 30
  slo_budget.py --slo 99.95 --requests 200000000
  slo_budget.py --slo 99.9 --observed-bad-percent 0.5
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass

MINUTES_PER_DAY = 1440


@dataclass
class Estimate:
    name: str
    value: float | str
    unit: str
    note: str


def percent_0_100(value: str) -> float:
    n = float(value)
    if not 0 <= n <= 100:
        raise argparse.ArgumentTypeError("must be between 0 and 100")
    return n


def slo_percent(value: str) -> float:
    n = float(value)
    if not 0 < n < 100:
        raise argparse.ArgumentTypeError("must be > 0 and < 100")
    return n


def positive(value: str) -> float:
    n = float(value)
    if n <= 0:
        raise argparse.ArgumentTypeError("must be > 0")
    return n


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--slo", type=slo_percent, required=True, help="target good-event percentage, e.g. 99.9")
    p.add_argument("--window-days", type=positive, help="SLO window length in days")
    p.add_argument("--requests", type=positive, help="events/requests in the SLO window")
    p.add_argument("--observed-bad-percent", type=percent_0_100, help="observed bad-event percentage for burn-rate estimate")
    p.add_argument("--json", action="store_true")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    out: list[Estimate] = []
    allowed_bad_fraction = (100.0 - a.slo) / 100.0
    out.append(Estimate(
        "allowed_bad_fraction",
        allowed_bad_fraction,
        "fraction",
        "Error-budget fraction implied by the target SLO.",
    ))

    if a.window_days is not None:
        allowed_minutes = a.window_days * MINUTES_PER_DAY * allowed_bad_fraction
        out.append(Estimate(
            "error_budget_time",
            allowed_minutes,
            "minutes/window",
            "Equivalent time budget only when time-based availability is the chosen SLI.",
        ))

    if a.requests is not None:
        allowed_bad_events = a.requests * allowed_bad_fraction
        out.append(Estimate(
            "allowed_bad_events",
            allowed_bad_events,
            "events/window",
            "Event-count budget before rounding and any multi-SLI policy.",
        ))

    if a.observed_bad_percent is not None:
        observed_bad_fraction = a.observed_bad_percent / 100.0
        burn = observed_bad_fraction / allowed_bad_fraction
        out.append(Estimate(
            "observed_error_budget_burn_rate",
            burn,
            "x",
            "Observed bad-event fraction divided by the SLO's allowed bad-event fraction; interpret over a defined time window.",
        ))

    return out


def main() -> int:
    p = build_parser()
    a = p.parse_args()
    estimates = calculate(a)
    if a.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("SLO budget (planning arithmetic)")
        for e in estimates:
            value = f"{e.value:,.6f}".rstrip("0").rstrip(".") if isinstance(e.value, float) else str(e.value)
            print(f"- {e.name}: {value} {e.unit}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
