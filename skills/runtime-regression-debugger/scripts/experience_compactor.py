#!/usr/bin/env python3
"""Extract conservative project-memory candidates from engineering journals.

The output is deliberately *candidate* memory. It must be reviewed, scoped, and
validated before durable promotion.

Usage:
  experience_compactor.py journal1.json journal2.json --scope-id repo:acme/api
  experience_compactor.py work.json --scope-id repo:acme/api --source-identity abc123 --include-decisions
  experience_compactor.py run1.json run2.json run3.json --scope-id repo:acme/api --include-workflows
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



WORKFLOW_LABEL = re.compile(r"^[a-z][a-z0-9-]{1,47}$")
WORKFLOW_PROOF = re.compile(r"^(?:test|ci|commit|artifact|runtime|review|check):[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,125}$")


def extract_workflow_observations(data: dict) -> list[dict]:
    """One independent task observation per workflow; this is not a proof oracle."""
    created, contract = data.get("created_at"), data.get("contract")
    if not isinstance(created, str) or not created or not isinstance(contract, str) or not contract:
        return []
    run_id = hashlib.sha256(f"{created}\0{contract}".encode("utf-8")).hexdigest()[:16]
    telemetry = data.get("telemetry", {})
    if not isinstance(telemetry, dict):
        return []
    events = telemetry.get("workflow_steps", [])
    if not isinstance(events, list):
        return []
    by_workflow: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        if not isinstance(event, dict):
            continue
        workflow = event.get("workflow")
        if isinstance(workflow, str) and WORKFLOW_LABEL.fullmatch(workflow):
            by_workflow[workflow].append(event)
    observations = []
    for workflow, rows in by_workflow.items():
        steps = [row.get("step") for row in rows]
        proof_ids = [row.get("evidence_ids") for row in rows]
        valid = (
            data.get("closed") is True
            and not data.get("residual_risks")
            and 2 <= len(rows) <= 10
            and all(isinstance(step, str) and WORKFLOW_LABEL.fullmatch(step) for step in steps)
            and len(set(steps)) == len(steps)
            and all(row.get("outcome") == "passed" for row in rows)
            and all(isinstance(ids, list) and 0 < len(ids) <= 5
                    and all(isinstance(value, str) and WORKFLOW_PROOF.fullmatch(value) for value in ids)
                    for ids in proof_ids)
        )
        observations.append({
            "workflow": workflow,
            "steps": tuple(steps) if all(isinstance(step, str) for step in steps) else (),
            "run_id": run_id,
            "valid": bool(valid),
            "evidence_ids": [value for ids in proof_ids if isinstance(ids, list) for value in ids
                             if isinstance(value, str) and WORKFLOW_PROOF.fullmatch(value)][:20],
        })
    return observations


def repeated_workflow_candidates(scope_id: str, source_identity: str | None,
                                 observed: dict[str, list[dict]], min_runs: int) -> list[dict]:
    candidates = []
    for workflow in sorted(observed):
        rows = observed[workflow]
        sequences: dict[tuple[str, ...], list[dict]] = defaultdict(list)
        for row in rows:
            if row["valid"]:
                sequences[row["steps"]].append(row)
        for steps, supporting in sorted(sequences.items()):
            if len(supporting) < min_runs:
                continue
            counterexamples = [row for row in rows if not row["valid"] or row["steps"] != steps]
            evidence = sorted({value for row in supporting for value in row["evidence_ids"]})
            candidates.append({
                "experience_id": candidate_id(scope_id, "repeated-workflow", workflow + "|" + "->".join(steps)),
                "scope_type": "project",
                "scope_id": scope_id,
                "kind": "repeated-workflow",
                "status": "candidate",
                "mechanism": workflow,
                "steps": list(steps),
                "statement": f"Potential reusable {workflow} workflow: " + " -> ".join(steps),
                "independent_successful_runs": len(supporting),
                "supporting_run_ids": sorted(row["run_id"] for row in supporting),
                "evidence_ids": evidence[:20],
                "counterexample_runs": len(counterexamples),
                "promotion_blocked": bool(counterexamples),
                "source_identity": source_identity,
                "review_required": True,
                "regression_required": True,
                "promotion_note": (
                    "Resolve conflicting, incomplete or failed runs before promotion."
                    if counterexamples else
                    "Verify evidence/current source identity, scope and counterexamples; compare old/new workflow on a held-out task, add regression, then use an authorized reviewable PR. Never auto-edit or publish the Skill."
                ),
            })
    return candidates


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("journals", nargs="+")
    parser.add_argument("--scope-id", required=True)
    parser.add_argument("--source-identity", default=None)
    parser.add_argument("--include-decisions", action="store_true")
    parser.add_argument("--include-workflows", action="store_true", help="Mine repeated proof-linked ordered workflows")
    parser.add_argument("--min-workflow-runs", type=int, default=3, help="Distinct completed journals required (minimum 2)")
    args = parser.parse_args()

    scope_id = compact_text(args.scope_id)
    if not scope_id:
        raise RuntimeError("--scope-id must not be empty")
    if args.min_workflow_runs < 2:
        raise RuntimeError("--min-workflow-runs must be >= 2")

    failed_groups: dict[str, list[dict]] = defaultdict(list)
    decision_rows: list[dict] = []
    workflow_observations: dict[str, list[dict]] = defaultdict(list)
    seen_workflow_run_ids: set[tuple[str, str]] = set()
    source_files: list[str] = []

    for journal_name in args.journals:
        path = pathlib.Path(journal_name)
        data = load_journal(path)
        source_files.append(str(path))
        if args.include_workflows:
            for row in extract_workflow_observations(data):
                key = (row["workflow"], row["run_id"])
                if key not in seen_workflow_run_ids:
                    seen_workflow_run_ids.add(key)
                    workflow_observations[row["workflow"]].append(row)
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

    if args.include_workflows:
        candidates.extend(repeated_workflow_candidates(scope_id, args.source_identity, workflow_observations, args.min_workflow_runs))

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
