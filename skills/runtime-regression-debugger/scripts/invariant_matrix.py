#!/usr/bin/env python3
"""Validate a structured invariant/evidence matrix.

Input JSON shape:
{"invariants":[{"name":"...","owner":"...","violation":"...",
"required_evidence":["focused"],"evidence":["focused"]}]}
"""
from __future__ import annotations
import argparse, json, pathlib, sys

REQUIRED_FIELDS = ("name", "owner", "violation")

def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    invariants = data.get("invariants")
    if not isinstance(invariants, list) or not invariants:
        print("error: top-level 'invariants' must be a non-empty list", file=sys.stderr)
        return 2
    rows, overall = [], True
    for i, inv in enumerate(invariants, 1):
        if not isinstance(inv, dict):
            rows.append({"index": i, "status": "invalid", "missing": ["object"]})
            overall = False
            continue
        missing = [f for f in REQUIRED_FIELDS if not nonempty(inv.get(f))]
        required = inv.get("required_evidence", [])
        evidence = inv.get("evidence", [])
        if not isinstance(required, list):
            missing.append("required_evidence:list")
            required = []
        if not isinstance(evidence, list):
            missing.append("evidence:list")
            evidence = []
        missing_evidence = sorted({str(x) for x in required} - {str(x) for x in evidence})
        ok = not missing and not missing_evidence
        overall = overall and ok
        rows.append({
            "index": i,
            "name": inv.get("name", ""),
            "owner": inv.get("owner", ""),
            "missing_fields": missing,
            "missing_evidence": missing_evidence,
            "status": "complete" if ok else "incomplete",
        })
    payload = {"invariants": rows, "gate_passed": overall, "note": "Completeness check only; it does not prove the invariants are correct or sufficient."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Invariant matrix")
        for row in rows:
            print(f"- {row.get('name') or 'unnamed'}: {row['status']}")
            if row.get("missing_fields"):
                print("  missing fields:", ", ".join(row["missing_fields"]))
            if row.get("missing_evidence"):
                print("  missing evidence:", ", ".join(row["missing_evidence"]))
        print("status:", "PASS" if overall else "INCOMPLETE")
    return 0 if overall else 1

if __name__ == "__main__":
    raise SystemExit(main())
