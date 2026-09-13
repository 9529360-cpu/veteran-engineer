#!/usr/bin/env python3
"""Estimate rough shard load, skew, storage, and rebalance budgets.

This is planning arithmetic, not a datastore simulator. Use measured workload and the
actual datastore's replication/partition semantics before making production decisions.

Examples:
  shard_budget.py --rps 1000000 --shards 256 --hot-multiplier 8
  shard_budget.py --storage-tb 80 --shards 512 --replication-factor 3
  shard_budget.py --move-tb 12 --move-mbps 800 --parallel-moves 4 --efficiency 0.65
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass

BITS_PER_BYTE = 8
BYTES_PER_TIB = 1024 ** 4
SECONDS_PER_HOUR = 3600


@dataclass
class Estimate:
    name: str
    value: float | str
    unit: str
    note: str


def positive(value: str) -> float:
    number = float(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be > 0")
    return number


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def fraction(value: str) -> float:
    number = float(value)
    if not 0 < number <= 1:
        raise argparse.ArgumentTypeError("must be > 0 and <= 1")
    return number


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--rps", type=positive, help="logical requests/events per second")
    p.add_argument("--shards", type=positive_int, help="logical/physical shard count used for the estimate")
    p.add_argument("--hot-multiplier", type=positive, default=1.0, help="hottest shard load divided by average shard load")
    p.add_argument("--headroom", type=fraction, default=0.70, help="target maximum steady-state utilization, default 0.70")
    p.add_argument("--storage-tb", type=positive, help="logical stored data in TiB before replication")
    p.add_argument("--replication-factor", type=positive, default=1.0, help="physical copy multiplier")
    p.add_argument("--move-tb", type=positive, help="logical data to move in TiB during rebalance/migration")
    p.add_argument("--move-mbps", type=positive, help="sustained transfer rate per parallel move in Mbit/s")
    p.add_argument("--parallel-moves", type=positive, default=1.0, help="parallel moves at the assumed per-move transfer rate")
    p.add_argument("--efficiency", type=fraction, default=0.70, help="sustained efficiency versus nominal transfer, default 0.70")
    p.add_argument("--json", action="store_true")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    out: list[Estimate] = []
    if a.rps is not None:
        if a.shards is None:
            raise ValueError("--shards is required with --rps")
        avg = a.rps / a.shards
        hot = avg * a.hot_multiplier
        required_hot_capacity = hot / a.headroom
        out.extend([
            Estimate("average_rps_per_shard", avg, "req/s", "Average only; real placement and key skew may be materially worse."),
            Estimate("estimated_hot_shard_rps", hot, "req/s", "Average multiplied by the explicit hotspot factor."),
            Estimate("hot_shard_capacity_with_headroom", required_hot_capacity, "req/s", "Per-shard sustainable capacity needed to keep the hot shard within the target utilization."),
        ])

    if a.storage_tb is not None:
        if a.shards is None:
            raise ValueError("--shards is required with --storage-tb")
        logical_per_shard = a.storage_tb / a.shards
        physical_total = a.storage_tb * a.replication_factor
        physical_per_shard = logical_per_shard * a.replication_factor
        out.extend([
            Estimate("logical_storage_per_shard", logical_per_shard, "TiB", "Even-placement estimate before index/compaction overhead."),
            Estimate("physical_storage_total", physical_total, "TiB", "Logical storage multiplied by the explicit replication factor only."),
            Estimate("physical_storage_per_shard", physical_per_shard, "TiB", "Even-placement estimate; reserve recovery and compaction headroom."),
        ])

    if a.move_tb is not None:
        if a.move_mbps is None:
            raise ValueError("--move-mbps is required with --move-tb")
        aggregate_mbps = a.move_mbps * a.parallel_moves * a.efficiency
        bytes_to_move = a.move_tb * BYTES_PER_TIB
        bytes_per_second = aggregate_mbps * 1_000_000 / BITS_PER_BYTE
        hours = bytes_to_move / bytes_per_second / SECONDS_PER_HOUR
        out.extend([
            Estimate("effective_rebalance_bandwidth", aggregate_mbps, "Mbit/s", "Nominal per-move bandwidth multiplied by parallelism and sustained efficiency."),
            Estimate("idealized_rebalance_time", hours, "hours", "Does not include reads, apply/index cost, verification, throttling, retries, or production contention."),
        ])

    if not out:
        raise ValueError("provide --rps, --storage-tb, or --move-tb")
    return out


def main() -> int:
    p = parser()
    args = p.parse_args()
    try:
        estimates = calculate(args)
    except ValueError as exc:
        p.error(str(exc))
    if args.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("Shard/rebalance budget (rough planning estimates)")
        for e in estimates:
            value = f"{e.value:,.3f}".rstrip("0").rstrip(".") if isinstance(e.value, float) else str(e.value)
            print(f"- {e.name}: {value} {e.unit}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
