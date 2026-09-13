#!/usr/bin/env python3
"""Check explicit operability contracts for consequential runtime mechanisms."""
from __future__ import annotations
import argparse, json, pathlib, sys

BASE_REQUIRED = ["owner", "success_signal", "failure_signal", "recovery"]
LONG_LIVED_REQUIRED = ["capacity_bound", "shutdown"]
HIGH_RISK_REQUIRED = ["stop_control", "degraded_mode", "stop_condition"]


def present(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return value is not None and value is not False


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        mechanisms = data.get("mechanisms")
        if not isinstance(mechanisms, list):
            raise ValueError("top-level mechanisms must be a list")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    rows, blockers = [], []
    for i, item in enumerate(mechanisms, 1):
        if not isinstance(item, dict):
            blockers.append(f"mechanism-{i}:invalid")
            continue
        name = str(item.get("name", "")).strip() or f"mechanism-{i}"
        risk = str(item.get("risk", "medium")).strip().lower()
        long_lived = bool(item.get("long_lived", False))
        required = list(BASE_REQUIRED)
        if long_lived:
            required += LONG_LIVED_REQUIRED
        if risk in {"high", "critical"}:
            required += HIGH_RISK_REQUIRED
        missing = [field for field in required if not present(item.get(field))]
        if risk not in {"low", "medium", "high", "critical"}:
            missing.append("valid_risk")
        if missing:
            blockers.append(name)
        rows.append({"name": name, "risk": risk, "long_lived": long_lived, "missing": missing})

    payload = {"mechanisms": rows, "gate_passed": not blockers, "blockers": blockers,
               "note": "Use only for mechanisms where operability is material; do not manufacture telemetry or kill switches for trivial local changes."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Operability contract")
        for row in rows:
            suffix = f" missing={','.join(row['missing'])}" if row["missing"] else ""
            print(f"- {row['name']}: risk={row['risk']}{suffix}")
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
