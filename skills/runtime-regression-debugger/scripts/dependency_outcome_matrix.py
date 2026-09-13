#!/usr/bin/env python3
"""Validate declared outcome policies for remote/external dependency operations."""
from __future__ import annotations
import argparse, json, pathlib, sys

READ_OUTCOMES = {"success", "explicit_failure", "timeout", "throttled", "stale"}
MUTATION_OUTCOMES = {"success", "explicit_failure", "unknown_outcome", "throttled", "partial"}
SAFE_UNKNOWN_ACTIONS = {"status_lookup", "reconcile", "idempotent_retry", "manual_reconcile", "durable_resume"}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        operations = data.get("operations")
        if not isinstance(operations, list):
            raise ValueError("top-level operations must be a list")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    rows, blockers = [], []
    for i, op in enumerate(operations, 1):
        if not isinstance(op, dict):
            blockers.append(f"operation-{i}:invalid")
            continue
        name = str(op.get("name", "")).strip() or f"operation-{i}"
        kind = str(op.get("kind", "")).strip().lower()
        outcomes = op.get("outcomes", {})
        problems: list[str] = []
        if kind not in {"read", "mutation"}:
            problems.append("invalid_kind")
            required = set()
        else:
            required = READ_OUTCOMES if kind == "read" else MUTATION_OUTCOMES
        if not isinstance(outcomes, dict):
            outcomes = {}
            problems.append("outcomes_not_object")
        missing = sorted(required - set(outcomes))
        if missing:
            problems.append("missing_outcomes:" + ",".join(missing))
        if kind == "mutation":
            unknown = outcomes.get("unknown_outcome", {})
            action = str(unknown.get("action", "")).strip().lower() if isinstance(unknown, dict) else ""
            if action not in SAFE_UNKNOWN_ACTIONS:
                problems.append("unsafe_unknown_outcome_policy")
            if action == "idempotent_retry" and not str(op.get("idempotency_identity", "")).strip():
                problems.append("idempotent_retry_without_identity")
        if kind == "read":
            stale = outcomes.get("stale", {})
            if isinstance(stale, dict) and str(stale.get("action", "")).strip().lower() == "serve":
                if not str(stale.get("freshness_bound", "")).strip():
                    problems.append("serve_stale_without_freshness_bound")
        if problems:
            blockers.append(name)
        rows.append({"name": name, "kind": kind, "problems": problems})

    payload = {"operations": rows, "gate_passed": not blockers, "blockers": blockers,
               "note": "Outcome names are a compact planning model; adapt them when provider semantics require additional states."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Dependency outcome matrix")
        for row in rows:
            suffix = f" problems={';'.join(row['problems'])}" if row["problems"] else ""
            print(f"- {row['name']}: {row['kind']}{suffix}")
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
