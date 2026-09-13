#!/usr/bin/env python3
"""Check whether critical invariants declare regression oracles and challenge mechanisms."""
from __future__ import annotations
import argparse, json, pathlib, sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        rows = data.get("invariants")
        if not isinstance(rows, list) or not rows:
            raise ValueError("top-level invariants must be a non-empty list")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    out, passed = [], True
    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            out.append({"index": i, "status": "invalid"}); passed = False; continue
        name = str(row.get("name", "")).strip() or f"invariant-{i}"
        critical = bool(row.get("critical", False))
        tests = row.get("regression_oracles", [])
        mutations = row.get("mutations", [])
        relations = row.get("metamorphic_relations", [])
        tests = tests if isinstance(tests, list) else []
        mutations = mutations if isinstance(mutations, list) else []
        relations = relations if isinstance(relations, list) else []
        missing = []
        if critical and not tests: missing.append("regression_oracle")
        if critical and not (mutations or relations): missing.append("mutation_or_metamorphic_challenge")
        ok = not missing
        passed = passed and ok
        out.append({"name": name, "critical": critical, "missing": missing, "status": "complete" if ok else "incomplete"})
    payload = {"invariants": out, "gate_passed": passed, "note": "Declaration check only; execute the tests or equivalent evidence before claiming protection."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Regression oracle gate")
        for row in out:
            print(f"- {row['name']}: {row['status']}" + (f" missing={','.join(row['missing'])}" if row['missing'] else ""))
        print("status:", "PASS" if passed else "INCOMPLETE")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
