#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA = "veteran-outcome-contract-v1"
DIMENSIONS = {
    "functional",
    "layout",
    "visual_style",
    "interaction",
    "workflow",
    "integration",
    "architecture",
    "data",
    "performance",
    "reliability",
    "security",
    "accessibility",
    "responsive",
    "copy",
    "delivery",
    "other",
}
BOUNDARY_RANK = {
    "static": 1,
    "focused": 2,
    "integration": 3,
    "runtime": 4,
    "production": 5,
}
CLAIM_RANK = {
    "implemented": 1,
    "focused-validated": 2,
    "integration-validated": 3,
    "runtime-validated": 4,
    "production-verified": 5,
}
CLOSED = {"done", "deferred", "not_applicable"}
RUNTIME_DIMENSIONS = {"layout", "visual_style", "interaction", "responsive", "accessibility", "workflow"}


def nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value: object) -> bool:
    return isinstance(value, list) and bool(value) and all(nonempty(item) for item in value)


def blocker(items: list[dict], code: str, path: str, message: str) -> None:
    items.append({"code": code, "path": path, "message": message})


def load(path: str):
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": path, "message": str(exc)}]
    if not isinstance(payload, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest root must be an object"}]
    return payload, []


def normalize_requirements(payload: dict, blockers: list[dict]):
    request = payload.get("request")
    if not isinstance(request, dict):
        blocker(blockers, "REQUEST_OBJECT_REQUIRED", "request", "request must be an object")
        return [], {}
    if not nonempty(request.get("summary")):
        blocker(blockers, "REQUEST_SUMMARY_REQUIRED", "request.summary", "request.summary must preserve the requested outcome")
    requirements = request.get("requirements")
    if not isinstance(requirements, list) or not requirements:
        blocker(blockers, "REQUIREMENTS_REQUIRED", "request.requirements", "at least one requirement clause is required")
        return [], {}

    by_id = {}
    normalized = []
    for index, item in enumerate(requirements):
        path = f"request.requirements[{index}]"
        if not isinstance(item, dict):
            blocker(blockers, "REQUIREMENT_OBJECT_REQUIRED", path, "requirement must be an object")
            continue
        req_id = item.get("id")
        if not nonempty(req_id):
            blocker(blockers, "REQUIREMENT_ID_REQUIRED", f"{path}.id", "id must be non-empty")
            continue
        req_id = req_id.strip()
        if req_id in by_id:
            blocker(blockers, "REQUIREMENT_ID_DUPLICATE", f"{path}.id", f"duplicate requirement id: {req_id}")
            continue
        statement = item.get("statement")
        acceptance = item.get("acceptance")
        if not nonempty(statement):
            blocker(blockers, "REQUIREMENT_STATEMENT_REQUIRED", f"{path}.statement", "statement must preserve one material user-request clause")
        if not nonempty(acceptance):
            blocker(blockers, "REQUIREMENT_ACCEPTANCE_REQUIRED", f"{path}.acceptance", "acceptance must describe an observable result")
        dimension = item.get("dimension")
        if dimension not in DIMENSIONS:
            blocker(blockers, "REQUIREMENT_DIMENSION_INVALID", f"{path}.dimension", f"dimension must be one of: {', '.join(sorted(DIMENSIONS))}")
        boundary = item.get("validation_boundary", "focused")
        if boundary not in BOUNDARY_RANK:
            blocker(blockers, "VALIDATION_BOUNDARY_INVALID", f"{path}.validation_boundary", f"validation_boundary must be one of: {', '.join(BOUNDARY_RANK)}")
        required = item.get("required", True)
        if not isinstance(required, bool):
            blocker(blockers, "REQUIREMENT_REQUIRED_BOOLEAN", f"{path}.required", "required must be boolean")
            required = True
        normalized_item = {
            "id": req_id,
            "statement": statement if nonempty(statement) else None,
            "acceptance": acceptance if nonempty(acceptance) else None,
            "dimension": dimension,
            "validation_boundary": boundary if boundary in BOUNDARY_RANK else "focused",
            "required": required,
        }
        by_id[req_id] = normalized_item
        normalized.append(normalized_item)
    return normalized, by_id


def validate(payload: dict) -> dict:
    blockers: list[dict] = []
    if payload.get("schema") != SCHEMA:
        blocker(blockers, "SCHEMA_INVALID", "schema", f"schema must be {SCHEMA}")

    requirements, by_id = normalize_requirements(payload, blockers)

    delivery = payload.get("delivery")
    if not isinstance(delivery, dict):
        blocker(blockers, "DELIVERY_OBJECT_REQUIRED", "delivery", "delivery must be an object")
        delivery = {}
    rows = delivery.get("requirements")
    if not isinstance(rows, list):
        blocker(blockers, "DELIVERY_REQUIREMENTS_REQUIRED", "delivery.requirements", "delivery.requirements must be an array")
        rows = []

    delivered = {}
    for index, item in enumerate(rows):
        path = f"delivery.requirements[{index}]"
        if not isinstance(item, dict):
            blocker(blockers, "DELIVERY_REQUIREMENT_OBJECT_REQUIRED", path, "delivery requirement must be an object")
            continue
        req_id = item.get("id")
        if not nonempty(req_id):
            blocker(blockers, "DELIVERY_REQUIREMENT_ID_REQUIRED", f"{path}.id", "id must be non-empty")
            continue
        req_id = req_id.strip()
        if req_id in delivered:
            blocker(blockers, "DELIVERY_REQUIREMENT_DUPLICATE", f"{path}.id", f"duplicate delivery requirement id: {req_id}")
            continue
        delivered[req_id] = item
        if req_id not in by_id:
            blocker(blockers, "DELIVERY_REQUIREMENT_UNKNOWN", f"{path}.id", f"delivery references unknown requirement: {req_id}")
            continue
        status = item.get("status")
        if status not in CLOSED:
            blocker(blockers, "DELIVERY_STATUS_INVALID", f"{path}.status", f"status must be one of: {', '.join(sorted(CLOSED))}")
            continue
        req = by_id[req_id]
        if req["required"] and status != "done":
            blocker(blockers, "REQUIRED_REQUIREMENT_NOT_DONE", path, f"required requirement {req_id} is {status!r}, not done")
        if status == "done":
            if not string_list(item.get("evidence")):
                blocker(blockers, "REQUIREMENT_EVIDENCE_REQUIRED", f"{path}.evidence", "done requirements need concrete implementation evidence")
            if not string_list(item.get("validation")):
                blocker(blockers, "REQUIREMENT_VALIDATION_REQUIRED", f"{path}.validation", "done requirements need validation evidence")
        elif not nonempty(item.get("disposition")):
            blocker(blockers, "REQUIREMENT_DISPOSITION_REQUIRED", f"{path}.disposition", "deferred/not-applicable requirements need an explicit disposition")

    for req in requirements:
        if req["required"] and req["id"] not in delivered:
            blocker(
                blockers,
                "REQUESTED_REQUIREMENT_UNDELIVERED",
                f"request.requirements[{req['id']}]",
                f"required user-request clause {req['id']} has no delivery row; related work cannot substitute for it",
            )

    execution = payload.get("execution")
    if not isinstance(execution, dict):
        blocker(blockers, "EXECUTION_OBJECT_REQUIRED", "execution", "execution must be an object")
        execution = {}
    for key in ("repository_inspected", "active_path_verified", "final_change_reviewed"):
        if execution.get(key) is not True:
            blocker(blockers, "EXECUTION_PROOF_REQUIRED", f"execution.{key}", f"{key} must be true before claiming completion")

    runtime_available = execution.get("runtime_available")
    runtime_observed = execution.get("runtime_observed")
    if not isinstance(runtime_available, bool):
        blocker(blockers, "RUNTIME_AVAILABLE_BOOLEAN", "execution.runtime_available", "runtime_available must be boolean")
        runtime_available = False
    if not isinstance(runtime_observed, bool):
        blocker(blockers, "RUNTIME_OBSERVED_BOOLEAN", "execution.runtime_observed", "runtime_observed must be boolean")
        runtime_observed = False

    requested_runtime = any(req["required"] and req["dimension"] in RUNTIME_DIMENSIONS for req in requirements)
    if runtime_available and requested_runtime and not runtime_observed:
        blocker(blockers, "RUNTIME_OBSERVATION_REQUIRED", "execution.runtime_observed", "runtime-capable UI/workflow changes must be observed in the real rendered/running surface")
    if runtime_observed and not nonempty(execution.get("runtime_observation")):
        blocker(blockers, "RUNTIME_OBSERVATION_EVIDENCE_REQUIRED", "execution.runtime_observation", "state what was actually observed at runtime")
    if not runtime_available and requested_runtime and not nonempty(execution.get("runtime_limitation")):
        blocker(blockers, "RUNTIME_LIMITATION_REQUIRED", "execution.runtime_limitation", "state why runtime/rendered verification is unavailable")

    claim = payload.get("completion_claim")
    if claim not in CLAIM_RANK:
        blocker(blockers, "COMPLETION_CLAIM_INVALID", "completion_claim", f"completion_claim must be one of: {', '.join(CLAIM_RANK)}")
        claim_rank = 0
    else:
        claim_rank = CLAIM_RANK[claim]

    required_boundary_rank = max(
        (BOUNDARY_RANK[req["validation_boundary"]] for req in requirements if req["required"]),
        default=1,
    )
    if claim_rank and claim_rank < required_boundary_rank:
        blocker(
            blockers,
            "COMPLETION_CLAIM_BELOW_REQUIRED_BOUNDARY",
            "completion_claim",
            f"claim {claim} is below the strongest required validation boundary",
        )
    if claim_rank >= CLAIM_RANK["runtime-validated"] and not runtime_observed:
        blocker(blockers, "RUNTIME_CLAIM_UNPROVEN", "completion_claim", "runtime-validated claims require runtime_observed=true")

    if not nonempty(payload.get("limitations")):
        blocker(blockers, "LIMITATIONS_REQUIRED", "limitations", "limitations must be explicit; use 'none known' when appropriate")

    dimensions = sorted({req["dimension"] for req in requirements if req["required"] and req["dimension"] in DIMENSIONS})
    delivered_dimensions = sorted({
        by_id[req_id]["dimension"]
        for req_id, row in delivered.items()
        if req_id in by_id and row.get("status") == "done" and by_id[req_id]["required"]
    })
    missing_dimensions = sorted(set(dimensions) - set(delivered_dimensions))

    return {
        "gate_passed": not blockers,
        "required_requirements": sum(1 for req in requirements if req["required"]),
        "delivered_requirements": sum(1 for req_id, row in delivered.items() if req_id in by_id and by_id[req_id]["required"] and row.get("status") == "done"),
        "requested_dimensions": dimensions,
        "delivered_dimensions": delivered_dimensions,
        "missing_dimensions": missing_dimensions,
        "runtime_observed": runtime_observed,
        "completion_claim": claim if claim in CLAIM_RANK else None,
        "blockers": blockers,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail closed when a multi-clause engineering request has not been fully delivered and evidenced")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    payload, load_blockers = load(args.manifest)
    if payload is None:
        result = {
            "gate_passed": False,
            "required_requirements": 0,
            "delivered_requirements": 0,
            "requested_dimensions": [],
            "delivered_dimensions": [],
            "missing_dimensions": [],
            "runtime_observed": False,
            "completion_claim": None,
            "blockers": load_blockers,
        }
    else:
        result = validate(payload)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(
            f"requirements={result['delivered_requirements']}/{result['required_requirements']} "
            f"dimensions={','.join(result['delivered_dimensions']) or '-'} "
            f"claim={result['completion_claim']}"
        )
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
