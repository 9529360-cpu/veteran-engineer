#!/usr/bin/env python3
"""Evaluate explicit architecture assumptions against current observed facts."""
from __future__ import annotations
import argparse, json, pathlib, sys


def check(item: dict) -> tuple[bool | None, str]:
    kind = str(item.get("kind", "")).strip().lower()
    expected = item.get("expected")
    observed = item.get("observed")
    try:
        if kind == "max":
            return float(observed) <= float(expected), f"observed={observed} <= max={expected}"
        if kind == "min":
            return float(observed) >= float(expected), f"observed={observed} >= min={expected}"
        if kind == "range":
            lo, hi = expected
            value = float(observed)
            return float(lo) <= value <= float(hi), f"observed={observed} in [{lo},{hi}]"
        if kind == "equals":
            return observed == expected, f"observed={observed!r} expected={expected!r}"
        if kind == "boolean":
            if not isinstance(expected, bool) or not isinstance(observed, bool):
                return None, "boolean kind requires JSON booleans"
            return observed is expected, f"observed={observed} expected={expected}"
        if kind == "declared":
            status = str(item.get("status", "unknown")).strip().lower()
            if status == "valid": return True, "declared valid"
            if status == "violated": return False, "declared violated"
            return None, "declared unknown"
    except (TypeError, ValueError):
        return None, "invalid values"
    return None, "unsupported kind"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        assumptions = data.get("assumptions")
        if not isinstance(assumptions, list):
            raise ValueError("top-level assumptions must be a list")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    rows, pressure = [], []
    for i, item in enumerate(assumptions, 1):
        if not isinstance(item, dict):
            pressure.append(f"assumption-{i}:invalid")
            continue
        aid = str(item.get("id", "")).strip() or f"assumption-{i}"
        statement = str(item.get("statement", "")).strip()
        sensitive = bool(item.get("decision_sensitive", False))
        ok, detail = check(item)
        status = "valid" if ok is True else "violated" if ok is False else "unknown"
        if sensitive and status != "valid":
            pressure.append(aid)
        rows.append({"id": aid, "statement": statement, "status": status, "decision_sensitive": sensitive, "detail": detail})

    payload = {"assumptions": rows, "architecture_pressure": pressure,
               "gate_passed": not pressure,
               "note": "A violated assumption is redesign pressure, not automatic justification for a rewrite."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Architecture fitness")
        for row in rows:
            print(f"- {row['id']}: {row['status']} ({row['detail']})")
        print("status:", "PASS" if not pressure else "PRESSURE")
    return 0 if not pressure else 1


if __name__ == "__main__":
    raise SystemExit(main())
