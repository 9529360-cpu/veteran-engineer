#!/usr/bin/env python3
"""Extract conservative project-memory candidates from engineering journals.

The output is deliberately *candidate* memory. It must be reviewed, scoped, and
validated before durable promotion.

Usage:
  experience_compactor.py journal1.json journal2.json --scope-id repo:acme/api
  experience_compactor.py work.json --scope-id repo:acme/api --source-identity abc123 --include-decisions
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import defaultdict


def load_journal(path: pathlib.Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read {path}: {exc}") from exc
    if not isinstance(data, dict) or data.get("version") != 1:
        raise RuntimeError(f"{path}: unsupported journal format")
    return data


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def candidate_id(scope_id: str, kind: str, key: str) -> str:
    digest = hashlib.sha256(f"{scope_id}|{kind}|{key}".encode("utf-8")).hexdigest()[:16]
    return f"exp_{digest}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("journals", nargs="+")
    parser.add_argument("--scope-id", required=True)
    parser.add_argument("--source-identity", default=None)
    parser.add_argument("--include-decisions", action="store_true")
    args = parser.parse_args()

    scope_id = compact_text(args.scope_id)
    if not scope_id:
        raise RuntimeError("--scope-id must not be empty")

    failed_groups: dict[str, list[dict]] = defaultdict(list)
    decision_rows: list[dict] = []
    source_files: list[str] = []

    for journal_name in args.journals:
        path = pathlib.Path(journal_name)
        data = load_journal(path)
        source_files.append(str(path))
        for attempt in data.get("attempts", []):
            if not isinstance(attempt, dict) or attempt.get("outcome") != "failed":
                continue
            assumption = compact_text(str(attempt.get("assumption") or ""))
            eq_class = compact_text(str(attempt.get("equivalence_class") or ""))
            forbidden = compact_text(str(attempt.get("forbidden_equivalent_class") or ""))
            if not assumption:
                continue
            key = eq_class or assumption.lower()
            failed_groups[key].append({
                "assumption": assumption,
                "equivalence_class": eq_class or None,
                "forbidden_equivalent_class": forbidden or None,
                "attempt": compact_text(str(attempt.get("name") or "unnamed")),
                "at": attempt.get("at"),
            })
        if args.include_decisions:
            for decision in data.get("decisions", []):
                if not isinstance(decision, dict):
                    continue
                action = compact_text(str(decision.get("action") or ""))
                basis = compact_text(str(decision.get("basis") or ""))
                if action and basis:
                    decision_rows.append({
                        "action": action,
                        "basis": basis,
                        "risk": compact_text(str(decision.get("risk") or "")) or None,
                        "at": decision.get("at"),
                    })

    candidates: list[dict] = []
    for key in sorted(failed_groups):
        rows = failed_groups[key]
        first = rows[0]
        statement = (
            f"Do not repeat the failed assumption '{first['assumption']}' without new discriminating evidence."
        )
        candidates.append({
            "experience_id": candidate_id(scope_id, "failed-assumption", key),
            "scope_type": "project",
            "scope_id": scope_id,
            "kind": "failed-assumption",
            "status": "candidate",
            "statement": statement,
            "mechanism": first["equivalence_class"] or "unclassified-failed-assumption",
            "equivalence_class": first["equivalence_class"],
            "forbidden_equivalent_class": first["forbidden_equivalent_class"],
            "observations": len(rows),
            "attempts": sorted({row["attempt"] for row in rows}),
            "source_identity": args.source_identity,
            "review_required": True,
            "promotion_note": "Confirm scope, counterexamples, freshness/expiry, and evidence pointers before durable activation.",
        })

    if args.include_decisions:
        for row in decision_rows:
            key = f"{row['action']}|{row['basis']}"
            candidates.append({
                "experience_id": candidate_id(scope_id, "decision-precedent", key),
                "scope_type": "project",
                "scope_id": scope_id,
                "kind": "decision-precedent",
                "status": "candidate",
                "statement": row["action"],
                "mechanism": "reviewed-decision-candidate",
                "basis": row["basis"],
                "risk": row["risk"],
                "source_identity": args.source_identity,
                "review_required": True,
                "promotion_note": "Verify that the decision remains valid for the current source/runtime identity before reuse.",
            })

    output = {
        "scope_id": scope_id,
        "source_identity": args.source_identity,
        "journal_count": len(source_files),
        "sources": source_files,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "warning": "Candidate experiences are navigation evidence, not authority. Do not auto-promote or auto-edit the Skill.",
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
