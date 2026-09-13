#!/usr/bin/env python3
"""Estimate rough database restore, log replay, and RTO budgets.

This calculator is intentionally simple. It is not a substitute for measured restore
exercises, storage benchmarks, or database-specific recovery semantics.

Examples:
  recovery_budget.py --base-backup-gib 800 --restore-mib-s 350 --log-replay-gib 120 --replay-mib-s 180 --validation-minutes 20 --rto-minutes 90
  recovery_budget.py --log-replay-gib 50 --replay-mib-s 200 --ongoing-log-mib-s 80
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass

MIB_PER_GIB = 1024.0
SECONDS_PER_MINUTE = 60.0


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


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-backup-gib", type=non_negative, help="base backup/snapshot data to restore in GiB")
    p.add_argument("--restore-mib-s", type=positive, help="measured/sustained base restore throughput in MiB/s")
    p.add_argument("--log-replay-gib", type=non_negative, help="transaction-log backlog to replay in GiB")
    p.add_argument("--replay-mib-s", type=positive, help="measured/sustained transaction-log replay throughput in MiB/s")
    p.add_argument("--ongoing-log-mib-s", type=non_negative, default=0.0, help="new transaction-log generation while catching up in MiB/s")
    p.add_argument("--validation-minutes", type=non_negative, default=0.0, help="planned integrity/application validation time")
    p.add_argument("--promotion-minutes", type=non_negative, default=0.0, help="planned promotion/routing/reopen overhead")
    p.add_argument("--rto-minutes", type=positive, help="target recovery-time objective")
    p.add_argument("--json", action="store_true", help="emit JSON")
    return p


def calculate(a: argparse.Namespace) -> list[Estimate]:
    out: list[Estimate] = []
    total_seconds = 0.0
    has_phase = False

    if a.base_backup_gib is not None:
        if a.restore_mib_s is None:
            raise ValueError("--restore-mib-s is required with --base-backup-gib")
        restore_seconds = a.base_backup_gib * MIB_PER_GIB / a.restore_mib_s
        total_seconds += restore_seconds
        has_phase = True
        out.append(Estimate(
            "base_restore_time",
            restore_seconds / SECONDS_PER_MINUTE,
            "minutes",
            "Idealized transfer/restore time at the provided sustained throughput; metadata, decompression, remote fetch limits, and contention are not modeled.",
        ))

    if a.log_replay_gib is not None:
        if a.replay_mib_s is None:
            raise ValueError("--replay-mib-s is required with --log-replay-gib")
        has_phase = True
        net_replay = a.replay_mib_s - a.ongoing_log_mib_s
        out.append(Estimate(
            "net_log_catchup_rate",
            net_replay,
            "MiB/s",
            "Replay throughput minus ongoing log generation; if <= 0, the recovery target cannot catch up while writes continue at the assumed rate.",
        ))
        if a.log_replay_gib == 0:
            replay_seconds: float | str = 0.0
            replay_note = "No existing transaction-log backlog under the provided assumptions."
        elif net_replay > 0:
            replay_seconds = a.log_replay_gib * MIB_PER_GIB / net_replay
            total_seconds += replay_seconds
            replay_note = "Idealized catch-up time at constant replay and generation rates; burstiness, fsync, apply conflicts, and checkpoints are not modeled."
        else:
            replay_seconds = "infinite"
            replay_note = "Catch-up is impossible because ongoing log generation meets or exceeds replay throughput."
        out.append(Estimate(
            "log_catchup_time",
            replay_seconds if isinstance(replay_seconds, str) else replay_seconds / SECONDS_PER_MINUTE,
            "minutes",
            replay_note,
        ))

    overhead_seconds = (a.validation_minutes + a.promotion_minutes) * SECONDS_PER_MINUTE
    if overhead_seconds > 0:
        has_phase = True
        total_seconds += overhead_seconds
        out.append(Estimate(
            "validation_and_promotion_overhead",
            overhead_seconds / SECONDS_PER_MINUTE,
            "minutes",
            "Explicitly provided non-transfer recovery work; parallelizable phases are not modeled.",
        ))

    if not has_phase:
        raise ValueError("provide at least one recovery phase")

    catchup_infinite = any(e.name == "log_catchup_time" and e.value == "infinite" for e in out)
    if catchup_infinite:
        out.append(Estimate(
            "estimated_total_recovery_time",
            "infinite",
            "minutes",
            "The provided replay rate cannot catch up with ongoing log generation.",
        ))
        if a.rto_minutes is not None:
            out.append(Estimate(
                "rto_status",
                "exceeds target",
                "",
                "Recovery cannot meet a finite RTO under the provided catch-up assumptions.",
            ))
    else:
        total_minutes = total_seconds / SECONDS_PER_MINUTE
        out.append(Estimate(
            "estimated_total_recovery_time",
            total_minutes,
            "minutes",
            "Serial rough estimate. Real recovery may include parallel phases, startup scans, cache warmup, validation failures, and routing propagation.",
        ))
        if a.rto_minutes is not None:
            margin = a.rto_minutes - total_minutes
            out.append(Estimate(
                "rto_margin",
                margin,
                "minutes",
                "Positive means the rough estimate fits inside the target; negative means it exceeds the target.",
            ))
            out.append(Estimate(
                "rto_status",
                "within target" if margin >= 0 else "exceeds target",
                "",
                "Planning signal only; require a timed restore/game-day for credible RTO evidence.",
            ))

    return out


def format_value(value: float | str) -> str:
    if isinstance(value, float) and math.isfinite(value):
        if abs(value) >= 1000:
            return f"{value:,.2f}"
        return f"{value:.3f}".rstrip("0").rstrip(".")
    return str(value)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        estimates = calculate(args)
    except ValueError as exc:
        parser.error(str(exc))

    if args.json:
        print(json.dumps({"estimates": [asdict(e) for e in estimates]}, indent=2, sort_keys=True))
    else:
        print("Recovery budget (rough planning estimates)")
        for e in estimates:
            suffix = f" {e.unit}" if e.unit else ""
            print(f"- {e.name}: {format_value(e.value)}{suffix}")
            print(f"  {e.note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
