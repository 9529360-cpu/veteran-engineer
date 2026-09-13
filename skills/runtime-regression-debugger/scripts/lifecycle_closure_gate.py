#!/usr/bin/env python3
"""Expose missing lifecycle closure for newly introduced operational mechanisms."""
from __future__ import annotations
import argparse, json, pathlib, sys

BASE = ["owner", "create", "observe", "failure", "recovery", "shutdown"]
TEMPORARY = ["exit_condition", "deletion_proof", "removal_order"]
PERSISTENT = ["capacity_or_retention_bound", "orphan_cleanup"]


def present(value: object) -> bool:
    if isinstance(value, str): return bool(value.strip())
    if isinstance(value, (list, dict)): return bool(value)
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
        temporary = bool(item.get("temporary", False))
        persistent = bool(item.get("persistent_resource", False))
        required = list(BASE)
        if temporary: required += TEMPORARY
        if persistent: required += PERSISTENT
        missing = [field for field in required if not present(item.get(field))]
        if missing: blockers.append(name)
        rows.append({"name": name, "temporary": temporary, "persistent_resource": persistent, "missing": missing})

    payload = {"mechanisms": rows, "gate_passed": not blockers, "blockers": blockers,
               "note": "Model only lifecycle fields that materially exist; the goal is closure, not paperwork."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Lifecycle closure")
        for row in rows:
            suffix = f" missing={','.join(row['missing'])}" if row["missing"] else ""
            print(f"- {row['name']}{suffix}")
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
