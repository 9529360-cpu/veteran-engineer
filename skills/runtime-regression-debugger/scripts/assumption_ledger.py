#!/usr/bin/env python3
"""Gate unresolved decision-sensitive assumptions in a task-local JSON ledger."""
from __future__ import annotations
import argparse, json, pathlib, sys

VALID = {"proven", "refuted", "unknown"}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        assumptions = data.get("assumptions")
        if not isinstance(assumptions, list): raise ValueError("top-level assumptions must be a list")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    rows, blockers = [], []
    for i, item in enumerate(assumptions, 1):
        if not isinstance(item, dict):
            rows.append({"index":i,"status":"invalid"}); blockers.append(f"assumption-{i}:invalid"); continue
        text = str(item.get("assumption", "")).strip()
        status = str(item.get("status", "unknown")).strip().lower()
        sensitive = bool(item.get("decision_sensitive", False))
        evidence = item.get("evidence", [])
        falsifier = str(item.get("falsifier", "")).strip()
        problems = []
        if not text: problems.append("missing_assumption")
        if status not in VALID: problems.append("invalid_status")
        if status == "proven" and not (isinstance(evidence, list) and evidence): problems.append("proven_without_evidence")
        if sensitive and status == "unknown": problems.append("decision_sensitive_unknown")
        if sensitive and not falsifier and status != "proven": problems.append("missing_falsifier")
        if problems: blockers.append(text or f"assumption-{i}")
        rows.append({"assumption": text, "status": status, "decision_sensitive": sensitive, "problems": problems})
    payload = {"assumptions": rows, "gate_passed": not blockers, "blockers": blockers, "note": "Task-local reasoning aid; no persistence is required or implied."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Assumption ledger")
        for row in rows:
            print(f"- {row['assumption'] or 'unnamed'}: {row['status']}" + (f" problems={','.join(row['problems'])}" if row['problems'] else ""))
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
