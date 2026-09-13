#!/usr/bin/env python3
"""Validate a structured end-to-end delivery-slice closure record.

This is a deterministic completeness aid, not a correctness proof.

Input JSON example:
{
  "contract": "user saves profile -> durable update -> refreshed UI",
  "transitions": [
    {
      "name": "API mutation",
      "owner": "ProfileService",
      "status": "done",
      "success_postcondition": "row committed",
      "error_postcondition": "validation error is stable",
      "evidence": ["integration:test_profile_update"]
    }
  ],
  "companions": [
    {
      "name": "cache invalidation",
      "applicable": true,
      "status": "done",
      "evidence": ["integration:read_after_write"]
    }
  ]
}

Usage:
  delivery_slice_gate.py delivery.json [--json]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

ALLOWED_STATUS = {"done", "pending", "blocked", "not_applicable"}


def nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def evidence_ok(value: object) -> bool:
    return isinstance(value, list) and any(nonempty(item) for item in value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    path = pathlib.Path(args.input_json)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read delivery slice: {exc}") from exc

    gaps: list[str] = []

    if not nonempty(payload.get("contract")):
        gaps.append("missing non-empty contract")

    transitions = payload.get("transitions")
    if not isinstance(transitions, list) or not transitions:
        gaps.append("transitions must be a non-empty array")
        transitions = []

    for idx, row in enumerate(transitions, start=1):
        prefix = f"transition[{idx}]"
        if not isinstance(row, dict):
            gaps.append(f"{prefix} must be an object")
            continue
        if not nonempty(row.get("name")):
            gaps.append(f"{prefix} missing name")
        if not nonempty(row.get("owner")):
            gaps.append(f"{prefix} missing owner")
        status = row.get("status")
        if status not in ALLOWED_STATUS:
            gaps.append(f"{prefix} status must be one of {sorted(ALLOWED_STATUS)}")
            continue
        if status == "done":
            if not nonempty(row.get("success_postcondition")):
                gaps.append(f"{prefix} done but missing success_postcondition")
            if not nonempty(row.get("error_postcondition")):
                gaps.append(f"{prefix} done but missing error_postcondition")
            if not evidence_ok(row.get("evidence")):
                gaps.append(f"{prefix} done but missing evidence")
        elif status == "not_applicable":
            if not nonempty(row.get("reason")):
                gaps.append(f"{prefix} not_applicable but missing reason")

    companions = payload.get("companions", [])
    if not isinstance(companions, list):
        gaps.append("companions must be an array when present")
        companions = []

    for idx, row in enumerate(companions, start=1):
        prefix = f"companion[{idx}]"
        if not isinstance(row, dict):
            gaps.append(f"{prefix} must be an object")
            continue
        if not nonempty(row.get("name")):
            gaps.append(f"{prefix} missing name")
        applicable = row.get("applicable")
        if not isinstance(applicable, bool):
            gaps.append(f"{prefix} applicable must be boolean")
            continue
        status = row.get("status")
        if status not in ALLOWED_STATUS:
            gaps.append(f"{prefix} status must be one of {sorted(ALLOWED_STATUS)}")
            continue
        if applicable:
            if status == "not_applicable":
                gaps.append(f"{prefix} marked applicable but status is not_applicable")
            if status == "done" and not evidence_ok(row.get("evidence")):
                gaps.append(f"{prefix} done but missing evidence")
        else:
            if status != "not_applicable":
                gaps.append(f"{prefix} not applicable but status is {status!r}")
            if not nonempty(row.get("reason")):
                gaps.append(f"{prefix} not applicable but missing reason")

    passed = not gaps
    output = {
        "passed": passed,
        "transition_count": len(transitions),
        "companion_count": len(companions),
        "gaps": gaps,
        "note": "Completeness aid only; repository/runtime evidence still determines correctness.",
    }

    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print("# Delivery slice gate")
        print("status:", "PASS" if passed else "FAIL")
        print("transitions:", len(transitions))
        print("companions:", len(companions))
        if gaps:
            for gap in gaps:
                print("-", gap)
        print("note:", output["note"])

    return 0 if passed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
