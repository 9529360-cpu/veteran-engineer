#!/usr/bin/env python3
"""Estimate rough backfill, catch-up, and transfer budgets for live migrations.

Examples:
  migration_budget.py --items 500000000 --apply-rps 12000
  migration_budget.py --backlog 5000000 --apply-rps 20000 --change-rps 8000
  migration_budget.py --data-tb 40 --transfer-mbps 2500 --efficiency 0.65
  migration_budget.py --items 800000000 --target-hours 12
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass

SECONDS_PER_HOUR = 3600
BYTES_PER_TIB = 1024 ** 4
BITS_PER_BYTE = 8


@dataclass
class Estimate:
    name: str
    value: float | str
    unit: str
    note: str


def positive(value: str) -> float:
    n = float(value)
    if n <= 0:
        raise argparse.ArgumentTypeError("must be > 0")
    return n


def non_negative(value: str) -> float:
    n = float(value)
    if n < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return n


def fraction(value: str) -> float:
    n = float(value)
    if not 0 < n <= 1:
        raise argparse.ArgumentTypeError("must be > 0 and <= 1")
    return n


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--items", type=positive, help="items/rows/documents to backfill")
    p.add_argument("--apply-rps", type=positive, help="sustained destination apply capacity in items/s")
    p.add_argument("--change-rps", type=non_negative, default=0.0, help="live change rate that must also be applied")
    p.add_argument("--backlog", type=non_negative, help="live-tail backlog waiting at catch-up start")
    p.add_argument("--target-hours", type=positive, help="desired completion window for the provided item count")
    p.add_argument("--data-tb", type=positive, help="logical data volume to transfer in TiB")
    p.add_argument("--transfer-mbps", type=positive, help="nominal transfer bandwidth in Mbit/s")
    p.add_argument("--efficiency", type=fraction, default=0.70, help="sustained fraction of nominal transfer, default 0.70")
    p.add_argument("--json", action="store_true")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    out: list[Estimate] = []

    if a.items is not None and a.apply_rps is not None:
        hours = a.items / a.apply_rps / SECONDS_PER_HOUR
        out.append(Estimate(
            "idealized_backfill_time",
            hours,
            "hours",
            "At sustained apply capacity before throttling, retries, source scans, verification, or production contention.",
        ))

    if a.items is not None and a.target_hours is not None:
        required = a.items / (a.target_hours * SECONDS_PER_HOUR)
        out.append(Estimate(
            "required_apply_rate_for_target",
            required,
            "items/s",
            "Minimum average rate before live-change load, retries, verification, and headroom.",
        ))

    if a.apply_rps is not None:
        net = a.apply_rps - a.change_rps
        out.append(Estimate(
            "net_catchup_rate",
            net,
            "items/s",
            "Apply capacity minus ongoing live changes; this is the capacity left to reduce lag.",
        ))
        if a.backlog is not None:
            if a.backlog == 0:
                catchup: float | str = 0.0
                note = "No starting backlog under the provided assumptions."
            elif net > 0:
                catchup = a.backlog / net / SECONDS_PER_HOUR
                note = "Idealized catch-up time at constant rates; bursts and retry amplification are not modeled."
            else:
                catchup = "infinite"
                note = "The live tail cannot catch up because change rate meets or exceeds apply capacity."
            out.append(Estimate("idealized_live_tail_catchup", catchup, "hours", note))

    if a.data_tb is not None:
        if a.transfer_mbps is None:
            raise ValueError("--transfer-mbps is required with --data-tb")
        effective_mbps = a.transfer_mbps * a.efficiency
        bytes_per_second = effective_mbps * 1_000_000 / BITS_PER_BYTE
        hours = a.data_tb * BYTES_PER_TIB / bytes_per_second / SECONDS_PER_HOUR
        out.extend([
            Estimate("effective_transfer_bandwidth", effective_mbps, "Mbit/s", "Nominal bandwidth multiplied by sustained efficiency."),
            Estimate("idealized_raw_transfer_time", hours, "hours", "Does not include serialization, indexes, compaction, checksums, throttling, or retries."),
        ])

    if not out:
        raise ValueError("provide enough inputs for a backfill, catch-up, target-rate, or transfer estimate")
    return out


def main() -> int:
    p = build_parser()
    a = p.parse_args()
    try:
        estimates = calculate(a)
    except ValueError as exc:
        p.error(str(exc))
    if a.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("Migration budget (rough planning estimates)")
        for e in estimates:
            if isinstance(e.value, float):
                value = f"{e.value:,.3f}".rstrip("0").rstrip(".")
            else:
                value = str(e.value)
            print(f"- {e.name}: {value} {e.unit}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
