#!/usr/bin/env python3
"""Validate an implementation-ready product requirements manifest.

This gate checks requirements discipline and closure. It does not prove that the
requirements are the right product decision or that repository evidence is true.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def add(blockers, code, message, path=None):
    item = {"code": code, "message": message}
    if path:
        item["path"] = path
    blockers.append(item)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        payload = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"gate_passed": False, "blockers": [{"code": "MANIFEST_INVALID", "message": str(exc)}]}))
        return 2

    blockers = []
    if not isinstance(payload, dict):
        add(blockers, "MANIFEST_ROOT_INVALID", "manifest root must be an object")
        payload = {}

    problem = payload.get("problem")
    if not isinstance(problem, dict):
        add(blockers, "PROBLEM_REQUIRED", "problem must be an object")
        problem = {}
    for key in ("statement", "outcome"):
        if not nonempty(problem.get(key)):
            add(blockers, "PROBLEM_FIELD_REQUIRED", f"problem.{key} must be non-empty", f"problem.{key}")

    actors = payload.get("actors")
    if not isinstance(actors, list) or not actors:
        add(blockers, "ACTORS_REQUIRED", "at least one actor is required")
        actors = []
    actor_ids = set()
    for index, actor in enumerate(actors):
        path = f"actors[{index}]"
        if not isinstance(actor, dict):
            add(blockers, "ACTOR_INVALID", "actor requires non-empty id and scope", path)
            continue
        actor_id = actor.get("id")
        if not nonempty(actor_id) or not nonempty(actor.get("scope")):
            add(blockers, "ACTOR_INVALID", "actor requires non-empty id and scope", path)
            continue
        if actor_id in actor_ids:
            add(blockers, "ACTOR_ID_DUPLICATE", f"duplicate actor id {actor_id}", f"{path}.id")
        else:
            actor_ids.add(actor_id)

    requirements = payload.get("requirements")
    if not isinstance(requirements, list) or not requirements:
        add(blockers, "REQUIREMENTS_REQUIRED", "at least one functional requirement is required")
        requirements = []

    req_ids = set()
    for index, req in enumerate(requirements):
        path = f"requirements[{index}]"
        if not isinstance(req, dict):
            add(blockers, "REQUIREMENT_INVALID", "requirement must be an object", path)
            continue
        rid = req.get("id")
        if not nonempty(rid):
            add(blockers, "REQUIREMENT_ID_REQUIRED", "requirement id must be non-empty", f"{path}.id")
        elif rid in req_ids:
            add(blockers, "REQUIREMENT_ID_DUPLICATE", f"duplicate requirement id {rid}", f"{path}.id")
        else:
            req_ids.add(rid)
        for key in ("actor", "starting_state", "action", "postcondition"):
            if not nonempty(req.get(key)):
                add(blockers, "REQUIREMENT_FIELD_REQUIRED", f"{path}.{key} must be non-empty", f"{path}.{key}")
        actor_id = req.get("actor")
        if nonempty(actor_id) and actor_id not in actor_ids:
            add(
                blockers,
                "REQUIREMENT_ACTOR_UNKNOWN",
                f"requirement actor {actor_id!r} must reference an existing actor",
                f"{path}.actor",
            )

    criteria = payload.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria:
        add(blockers, "ACCEPTANCE_CRITERIA_REQUIRED", "at least one acceptance criterion is required")
        criteria = []

    criterion_ids = set()
    for index, criterion in enumerate(criteria):
        path = f"acceptance_criteria[{index}]"
        if not isinstance(criterion, dict):
            add(blockers, "ACCEPTANCE_CRITERION_INVALID", "criterion must be an object", path)
            continue
        cid = criterion.get("id")
        if not nonempty(cid):
            add(blockers, "ACCEPTANCE_ID_REQUIRED", "criterion id must be non-empty", f"{path}.id")
        elif cid in criterion_ids:
            add(blockers, "ACCEPTANCE_ID_DUPLICATE", f"duplicate criterion id {cid}", f"{path}.id")
        else:
            criterion_ids.add(cid)
        requirement_id = criterion.get("requirement_id")
        if not nonempty(requirement_id) or requirement_id not in req_ids:
            add(blockers, "ACCEPTANCE_REQUIREMENT_MISSING", "criterion must reference an existing requirement", f"{path}.requirement_id")
        for key in ("given", "when", "then", "evidence"):
            if not nonempty(criterion.get(key)):
                add(blockers, "ACCEPTANCE_FIELD_REQUIRED", f"{path}.{key} must be non-empty", f"{path}.{key}")

    non_goals = payload.get("non_goals")
    if not isinstance(non_goals, list) or not all(nonempty(item) for item in non_goals):
        add(blockers, "NON_GOALS_INVALID", "non_goals must be an array of non-empty strings")

    failure = payload.get("failure_recovery")
    if not isinstance(failure, list) or not failure:
        add(blockers, "FAILURE_RECOVERY_REQUIRED", "at least one failure/recovery row is required")
        failure = []
    for index, row in enumerate(failure):
        path = f"failure_recovery[{index}]"
        if not isinstance(row, dict) or not nonempty(row.get("failure")) or not nonempty(row.get("recovery")) or not nonempty(row.get("visible_state")):
            add(blockers, "FAILURE_RECOVERY_INVALID", "failure row requires failure, recovery, and visible_state", path)

    assumptions = payload.get("assumptions", [])
    if not isinstance(assumptions, list):
        add(blockers, "ASSUMPTIONS_INVALID", "assumptions must be an array")
        assumptions = []
    for index, item in enumerate(assumptions):
        path = f"assumptions[{index}]"
        if not isinstance(item, dict) or not nonempty(item.get("statement")) or not nonempty(item.get("falsifier")):
            add(blockers, "ASSUMPTION_INVALID", "assumption requires statement and falsifier", path)

    decisions = payload.get("open_product_decisions", [])
    if not isinstance(decisions, list):
        add(blockers, "OPEN_DECISIONS_INVALID", "open_product_decisions must be an array")
        decisions = []
    for index, item in enumerate(decisions):
        path = f"open_product_decisions[{index}]"
        if not isinstance(item, dict) or not nonempty(item.get("question")) or not nonempty(item.get("impact")):
            add(blockers, "OPEN_DECISION_INVALID", "open product decision requires question and impact", path)

    validation = payload.get("validation_mapping")
    if not isinstance(validation, list) or not validation:
        add(blockers, "VALIDATION_MAPPING_REQUIRED", "validation_mapping is required")
        validation = []
    mapped = set()
    for index, item in enumerate(validation):
        path = f"validation_mapping[{index}]"
        if not isinstance(item, dict):
            add(blockers, "VALIDATION_MAPPING_INVALID", "validation mapping row must be an object", path)
            continue
        cid = item.get("criterion_id")
        if not nonempty(cid) or cid not in criterion_ids:
            add(blockers, "VALIDATION_CRITERION_MISSING", "validation row must reference an existing criterion", f"{path}.criterion_id")
        else:
            mapped.add(cid)
        if not nonempty(item.get("oracle")):
            add(blockers, "VALIDATION_ORACLE_REQUIRED", "validation row requires a non-empty oracle", f"{path}.oracle")

    for cid in criterion_ids - mapped:
        add(blockers, "ACCEPTANCE_UNMAPPED", f"acceptance criterion {cid} has no validation mapping")

    compatibility = payload.get("compatibility", {"applicable": False, "reason": "not applicable"})
    if not isinstance(compatibility, dict) or not isinstance(compatibility.get("applicable"), bool):
        add(blockers, "COMPATIBILITY_INVALID", "compatibility requires boolean applicable")
    elif compatibility.get("applicable"):
        for key in ("window", "rollout", "recovery"):
            if not nonempty(compatibility.get(key)):
                add(blockers, "COMPATIBILITY_FIELD_REQUIRED", f"compatibility.{key} is required when applicable", f"compatibility.{key}")
    elif not nonempty(compatibility.get("reason")):
        add(blockers, "COMPATIBILITY_REASON_REQUIRED", "non-applicable compatibility requires a reason", "compatibility.reason")

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "actors": len(actors),
            "requirements": len(requirements),
            "acceptance_criteria": len(criteria),
            "assumptions": len(assumptions),
            "open_product_decisions": len(decisions),
            "validation_mappings": len(validation),
        },
        "note": "This gate checks requirements completeness and traceability, not whether the product decisions are substantively correct.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
