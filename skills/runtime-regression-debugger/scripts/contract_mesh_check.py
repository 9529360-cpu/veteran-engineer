#!/usr/bin/env python3
"""Validate declared cross-repo compatibility and optional execution sequencing.

The legacy input shape remains supported:
{
  "contracts": [
    {
      "id": "api-worker",
      "authority": "orders-api",
      "independent_deploys": true,
      "compatibility": {
        "old_producer_old_consumer": "supported",
        "old_producer_new_consumer": "supported",
        "new_producer_old_consumer": "supported",
        "new_producer_new_consumer": "supported"
      }
    }
  ]
}

Optional execution fields can be declared at top level or under ``execution``:
- repositories
- implementation_order
- rollout_steps
- temporary_compatibility

This is a completeness gate only. It cannot prove real compatibility.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

REQUIRED_CELLS = [
    "old_producer_old_consumer",
    "old_producer_new_consumer",
    "new_producer_old_consumer",
    "new_producer_new_consumer",
]
VALID = {"supported", "unsupported", "not_applicable"}


def text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def nonempty_text_list(value: object) -> bool:
    return isinstance(value, list) and bool(value) and all(text(x) for x in value)


def validate_contracts(contracts: object) -> tuple[list[dict], list[str]]:
    if not isinstance(contracts, list):
        raise ValueError("top-level contracts must be a list")

    rows: list[dict] = []
    blockers: list[str] = []
    for i, item in enumerate(contracts, 1):
        if not isinstance(item, dict):
            blockers.append(f"contract-{i}:invalid")
            continue
        cid = str(item.get("id", "")).strip() or f"contract-{i}"
        independent = bool(item.get("independent_deploys", True))
        matrix = item.get("compatibility", {})
        problems: list[str] = []
        if not text(item.get("authority")):
            problems.append("missing_authority")
        if not isinstance(matrix, dict):
            matrix = {}
            problems.append("compatibility_not_object")
        if independent:
            for cell in REQUIRED_CELLS:
                status = str(matrix.get(cell, "unknown")).strip().lower()
                if status not in VALID:
                    problems.append(f"unknown_cell:{cell}")
            unsupported = [
                c for c in REQUIRED_CELLS
                if str(matrix.get(c, "")).strip().lower() == "unsupported"
            ]
            if unsupported and not text(item.get("rollout_constraint")):
                problems.append("unsupported_cell_without_rollout_constraint")
            if unsupported and not text(item.get("recovery")):
                problems.append("unsupported_cell_without_recovery")
        if bool(item.get("temporary_compatibility", False)) and not text(item.get("removal_condition")):
            problems.append("temporary_compatibility_without_removal_condition")
        if problems:
            blockers.append(cid)
        rows.append({"id": cid, "independent_deploys": independent, "problems": problems})
    return rows, blockers


def execution_payload(data: dict) -> dict | None:
    nested = data.get("execution")
    if isinstance(nested, dict):
        return nested
    fields = ("repositories", "implementation_order", "rollout_steps", "temporary_compatibility")
    if any(field in data for field in fields):
        return data
    return None


def validate_execution(data: dict) -> tuple[dict, list[str]]:
    gaps: list[str] = []
    repos = data.get("repositories")
    if not isinstance(repos, list) or not repos:
        gaps.append("repositories_must_be_non_empty_array")
        repos = []

    ids: set[str] = set()
    for i, row in enumerate(repos, 1):
        if not isinstance(row, dict):
            gaps.append(f"repo[{i}]_must_be_object")
            continue
        rid = row.get("id")
        if not text(rid):
            gaps.append(f"repo[{i}]_missing_id")
            continue
        rid = str(rid).strip()
        if rid in ids:
            gaps.append(f"duplicate_repo_id:{rid}")
        ids.add(rid)
        for field in ("source_identity", "responsibility", "compatibility_requirement", "validation"):
            if not text(row.get(field)):
                gaps.append(f"repo:{rid}_missing_{field}")
        if bool(row.get("independently_deployed", True)) and not text(row.get("artifact_identity")):
            gaps.append(f"repo:{rid}_missing_artifact_identity")

    order = data.get("implementation_order")
    if not nonempty_text_list(order):
        gaps.append("implementation_order_must_be_non_empty_repo_id_array")
        order = []
    else:
        normalized = [str(x).strip() for x in order]
        if len(set(normalized)) != len(normalized):
            gaps.append("implementation_order_contains_duplicates")
        for rid in sorted(ids.difference(normalized)):
            gaps.append(f"implementation_order_missing_repo:{rid}")
        for rid in sorted(set(normalized).difference(ids)):
            gaps.append(f"implementation_order_unknown_repo:{rid}")

    steps = data.get("rollout_steps")
    if not isinstance(steps, list) or not steps:
        gaps.append("rollout_steps_must_be_non_empty_array")
        steps = []

    seen_steps: set[str] = set()
    rollout_repos: set[str] = set()
    for i, row in enumerate(steps, 1):
        if not isinstance(row, dict):
            gaps.append(f"step[{i}]_must_be_object")
            continue
        sid = row.get("id")
        if not text(sid):
            gaps.append(f"step[{i}]_missing_id")
            continue
        sid = str(sid).strip()
        if sid in seen_steps:
            gaps.append(f"duplicate_step_id:{sid}")
        seen_steps.add(sid)
        repo_ids = row.get("repositories")
        if not nonempty_text_list(repo_ids):
            gaps.append(f"step:{sid}_missing_repositories")
        else:
            for rid in repo_ids:
                normalized = str(rid).strip()
                if normalized not in ids:
                    gaps.append(f"step:{sid}_unknown_repo:{normalized}")
                else:
                    rollout_repos.add(normalized)
        for field in ("compatibility_after_step", "evidence_before_next_step", "recovery_if_stopped_here"):
            if not text(row.get(field)):
                gaps.append(f"step:{sid}_missing_{field}")

    for rid in sorted(ids.difference(rollout_repos)):
        gaps.append(f"rollout_steps_missing_repo:{rid}")

    temporary = data.get("temporary_compatibility", [])
    if not isinstance(temporary, list):
        gaps.append("temporary_compatibility_must_be_array")
        temporary = []
    for i, row in enumerate(temporary, 1):
        if not isinstance(row, dict):
            gaps.append(f"temporary[{i}]_must_be_object")
            continue
        name = str(row.get("name", "")).strip() or f"temporary-{i}"
        for field in ("owner", "removal_condition", "proof_before_removal"):
            if not text(row.get(field)):
                gaps.append(f"temporary:{name}_missing_{field}")

    return {
        "repository_count": len(repos),
        "rollout_step_count": len(steps),
        "gaps": gaps,
    }, gaps


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        data = json.loads(pathlib.Path(args.path).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("top-level JSON must be an object")
        contract_rows, contract_blockers = validate_contracts(data.get("contracts"))
        exec_data = execution_payload(data)
        execution = None
        execution_gaps: list[str] = []
        if exec_data is not None:
            execution, execution_gaps = validate_execution(exec_data)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    passed = not contract_blockers and not execution_gaps
    payload = {
        "contracts": contract_rows,
        "execution": execution,
        "gate_passed": passed,
        "blockers": contract_blockers,
        "note": "Declared matrix/sequencing completeness only; representative contract and integration evidence is still required.",
    }

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Contract mesh")
        for row in contract_rows:
            suffix = f" problems={';'.join(row['problems'])}" if row["problems"] else ""
            print(f"- {row['id']}{suffix}")
        if execution is not None:
            print(f"execution repositories: {execution['repository_count']}")
            print(f"rollout steps: {execution['rollout_step_count']}")
            for gap in execution["gaps"]:
                print("- execution gap:", gap)
        print("status:", "PASS" if passed else "BLOCKED")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
