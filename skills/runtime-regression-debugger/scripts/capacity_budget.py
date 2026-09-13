#!/usr/bin/env python3
"""Estimate simple full-stack capacity budgets from explicit assumptions.

This is a rough planning calculator, not a benchmark or queueing simulator.
It intentionally keeps formulas simple and labels estimates clearly.

Examples:
  capacity_budget.py --rps 1200 --latency-ms 180 --instances 12
  capacity_budget.py --rps 500 --latency-ms 250 --retry-fraction 0.08 --avg-retries 2
  capacity_budget.py --backlog 200000 --consumer-rps 900 --arrival-rps 500
  capacity_budget.py --rps 100 --payload-kb 4 --retention-days 30 --replication-factor 3
  capacity_budget.py --rps 800 --latency-ms 120 --db-ms 35 --db-touch-fraction 0.7 --instances 10 --db-pool-per-instance 20
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass


SECONDS_PER_DAY = 86400
BYTES_PER_KIB = 1024
BYTES_PER_GIB = 1024 ** 3


@dataclass
class Estimate:
    name: str
    value: float | str | None
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
    if not 0 <= parsed <= 1:
        raise argparse.ArgumentTypeError("must be between 0 and 1")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--rps", type=non_negative, help="logical request/event rate per second")
    p.add_argument("--latency-ms", type=non_negative, help="average end-to-end service time in milliseconds")
    p.add_argument("--instances", type=positive, help="number of active application instances")
    p.add_argument("--concurrency-per-instance", type=positive, help="configured/usable concurrent work slots per instance")

    p.add_argument("--retry-fraction", type=fraction, default=0.0, help="fraction of logical requests that enter retry behavior")
    p.add_argument("--avg-retries", type=non_negative, default=0.0, help="average retry attempts for requests that retry")

    p.add_argument("--db-ms", type=non_negative, help="average database service time per DB-touching logical request")
    p.add_argument("--db-touch-fraction", type=fraction, default=1.0, help="fraction of logical requests that occupy a DB connection")
    p.add_argument("--db-pool-per-instance", type=positive, help="maximum DB pool size per app instance")

    p.add_argument("--backlog", type=non_negative, help="queued items already waiting")
    p.add_argument("--consumer-rps", type=non_negative, help="sustainable queue processing capacity per second")
    p.add_argument("--arrival-rps", type=non_negative, help="new queue arrivals per second while draining")

    p.add_argument("--payload-kb", type=non_negative, help="stored payload size per logical request/event in KiB")
    p.add_argument("--retention-days", type=non_negative, help="retention period for stored payloads")
    p.add_argument("--replication-factor", type=positive, default=1.0, help="physical copy/replication multiplier")
    p.add_argument("--json", action="store_true", help="emit JSON")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    out: list[Estimate] = []

    retry_multiplier = 1.0 + a.retry_fraction * a.avg_retries
    if a.rps is not None:
        attempt_rps = a.rps * retry_multiplier
        out.append(Estimate(
            "effective_attempt_rate",
            attempt_rps,
            "attempts/s",
            "Logical rate multiplied by explicit retry assumptions; stacked retries in other layers are not included.",
        ))
        if retry_multiplier > 1:
            out.append(Estimate(
                "retry_load_multiplier",
                retry_multiplier,
                "x",
                "Extra load caused by the provided retry policy under the assumed retry fraction.",
            ))

        if a.latency_ms is not None:
            inflight = attempt_rps * (a.latency_ms / 1000.0)
            out.append(Estimate(
                "estimated_inflight_work",
                inflight,
                "concurrent operations",
                "Little's Law estimate using average latency, not p95/p99.",
            ))

            if a.instances is not None:
                per_instance = inflight / a.instances
                out.append(Estimate(
                    "estimated_inflight_per_instance",
                    per_instance,
                    "concurrent operations/instance",
                    "Average demand if work is evenly distributed.",
                ))
                if a.concurrency_per_instance is not None:
                    utilization = per_instance / a.concurrency_per_instance
                    out.append(Estimate(
                        "configured_concurrency_utilization",
                        utilization * 100.0,
                        "%",
                        "Planning ratio only; queueing and headroom become important well before 100%.",
                    ))

        if a.db_ms is not None:
            db_attempt_rps = attempt_rps * a.db_touch_fraction
            db_concurrency = db_attempt_rps * (a.db_ms / 1000.0)
            out.append(Estimate(
                "estimated_db_concurrency",
                db_concurrency,
                "active connections/work slots",
                "Approximate concurrent DB occupancy if DB time represents connection-held service time.",
            ))
            if a.instances is not None and a.db_pool_per_instance is not None:
                total_pool = a.instances * a.db_pool_per_instance
                out.append(Estimate(
                    "configured_db_pool_capacity",
                    total_pool,
                    "connections",
                    "Configured upper bound across application instances; reserve capacity for other clients and failover.",
                ))
                out.append(Estimate(
                    "estimated_db_pool_utilization",
                    (db_concurrency / total_pool) * 100.0,
                    "%",
                    "Does not model transaction bursts, lock waits, admin clients, workers, or pool queueing.",
                ))

        if a.payload_kb is not None and a.retention_days is not None:
            gib = (
                a.rps
                * SECONDS_PER_DAY
                * a.retention_days
                * a.payload_kb
                * BYTES_PER_KIB
                * a.replication_factor
                / BYTES_PER_GIB
            )
            out.append(Estimate(
                "retained_payload_storage",
                gib,
                "GiB",
                "Raw payload estimate before indexes, metadata, compression, compaction, logs, backups, or write amplification.",
            ))

    if a.backlog is not None and a.consumer_rps is not None:
        arrivals = a.arrival_rps or 0.0
        net = a.consumer_rps - arrivals
        out.append(Estimate(
            "queue_net_drain_rate",
            net,
            "items/s",
            "Consumer capacity minus new arrival rate.",
        ))
        if a.backlog == 0:
            drain_seconds: float | str = 0.0
            note = "No existing backlog under the provided assumptions."
        elif net > 0:
            drain_seconds = a.backlog / net
            note = "Idealized drain time at constant rates; downstream saturation and retries are not modeled."
        else:
            drain_seconds = "infinite"
            note = "Backlog cannot drain because new arrivals meet or exceed processing capacity."
        out.append(Estimate("queue_backlog_drain_time", drain_seconds, "seconds", note))

    return out


def format_value(value: float | str | None) -> str:
    if isinstance(value, float):
        if math.isfinite(value):
            if abs(value) >= 1000:
                return f"{value:,.2f}"
            return f"{value:.3f}".rstrip("0").rstrip(".")
    return str(value)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    estimates = calculate(args)
    if not estimates:
        parser.error("provide enough inputs for at least one estimate")

    if args.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("Capacity budget (rough planning estimates)")
        for e in estimates:
            print(f"- {e.name}: {format_value(e.value)} {e.unit}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
