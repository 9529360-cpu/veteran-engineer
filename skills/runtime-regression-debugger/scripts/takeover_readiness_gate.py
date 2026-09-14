#!/usr/bin/env python3
"""Fail-closed readiness check before the first mutation in an unfamiliar repository.

This gate validates takeover discipline and traceability. It does not prove that the
supplied repository evidence is truthful or that the proposed change is correct.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SAFE_MUTATION_KINDS = {
    "characterization-test",
    "regression-test",
    "instrumentation",
    "owner-correction",
    "compatibility-seam",
    "small-migration-cohort",
    "reversible-feature-flag",
    "narrow-feature-slice",
    "narrow-bug-fix",
}

AUTHORITATIVE_CLASSIFICATIONS = {
    "authoritative-source",
    "authored-source",
    "migration-authority",
}


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value) -> bool:
    return isinstance(value, list) and all(nonempty(item) for item in value)


def add(blockers, code, message, path=None):
    item = {"code": code, "message": message}
    if path:
        item["path"] = path
    blockers.append(item)


def require_fields(blockers, obj, fields, prefix, code):
    for key in fields:
        if not nonempty(obj.get(key)):
            add(blockers, code, f"{prefix}.{key} must be a non-empty string", f"{prefix}.{key}")


def validate_map(blockers, maps, name, required=True):
    path = f"maps.{name}"
    item = maps.get(name)
    if not isinstance(item, dict):
        add(blockers, "PROJECT_MAP_REQUIRED", f"{path} must be an object", path)
        return
    applicable = item.get("applicable")
    if not isinstance(applicable, bool):
        add(blockers, "PROJECT_MAP_APPLICABILITY_INVALID", f"{path}.applicable must be boolean", f"{path}.applicable")
        return
    if required and not applicable:
        add(blockers, "PROJECT_MAP_REQUIRED", f"{path} is required for takeover readiness", path)
        return
    if applicable:
        entries = item.get("entries")
        if not string_list(entries) or not entries:
            add(blockers, "PROJECT_MAP_ENTRIES_REQUIRED", f"{path}.entries must contain evidence-backed entries", f"{path}.entries")
    elif not nonempty(item.get("reason")):
        add(blockers, "PROJECT_MAP_REASON_REQUIRED", f"{path}.reason is required when not applicable", f"{path}.reason")


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

    repository = payload.get("repository")
    if not isinstance(repository, dict):
        add(blockers, "REPOSITORY_REQUIRED", "repository must be an object")
        repository = {}
    require_fields(
        blockers,
        repository,
        ("authorized_identity", "observed_identity", "default_branch", "revision"),
        "repository",
        "REPOSITORY_FIELD_REQUIRED",
    )
    if nonempty(repository.get("authorized_identity")) and nonempty(repository.get("observed_identity")):
        if repository["authorized_identity"].strip() != repository["observed_identity"].strip():
            add(
                blockers,
                "REPOSITORY_IDENTITY_MISMATCH",
                "authorized and observed repository identities differ",
                "repository.observed_identity",
            )
    identity_evidence = repository.get("identity_evidence")
    if not string_list(identity_evidence) or not identity_evidence:
        add(blockers, "REPOSITORY_IDENTITY_EVIDENCE_REQUIRED", "repository.identity_evidence must contain at least one strong identity proof", "repository.identity_evidence")

    contract = payload.get("contract")
    if not isinstance(contract, dict):
        add(blockers, "CONTRACT_REQUIRED", "contract must be an object")
        contract = {}
    require_fields(
        blockers,
        contract,
        ("actor", "intent", "transition", "postconditions", "failure_recovery", "compatibility"),
        "contract",
        "CONTRACT_FIELD_REQUIRED",
    )

    maps = payload.get("maps")
    if not isinstance(maps, dict):
        add(blockers, "PROJECT_MAPS_REQUIRED", "maps must be an object")
        maps = {}
    for name in ("entry", "authority", "validation"):
        validate_map(blockers, maps, name, required=True)
    for name in ("data", "runtime", "delivery"):
        validate_map(blockers, maps, name, required=False)

    active_path = payload.get("active_path")
    if not isinstance(active_path, dict):
        add(blockers, "ACTIVE_PATH_REQUIRED", "active_path must be an object")
        active_path = {}
    require_fields(
        blockers,
        active_path,
        ("entry", "registration_or_wiring", "caller", "authority", "effect", "visible_result"),
        "active_path",
        "ACTIVE_PATH_FIELD_REQUIRED",
    )
    liveness = active_path.get("liveness_evidence")
    if not string_list(liveness) or not liveness:
        add(blockers, "LIVENESS_EVIDENCE_REQUIRED", "active_path.liveness_evidence must contain at least one proof that the path is live", "active_path.liveness_evidence")

    mutation = payload.get("mutation_target")
    if not isinstance(mutation, dict):
        add(blockers, "MUTATION_TARGET_REQUIRED", "mutation_target must be an object")
        mutation = {}
    require_fields(blockers, mutation, ("path", "classification", "source_of_truth"), "mutation_target", "MUTATION_TARGET_FIELD_REQUIRED")
    classification = mutation.get("classification")
    if nonempty(classification) and classification not in AUTHORITATIVE_CLASSIFICATIONS:
        add(
            blockers,
            "MUTATION_TARGET_NOT_AUTHORITATIVE",
            "mutation_target.classification must identify an authoritative authored mutation surface",
            "mutation_target.classification",
        )

    consumers = payload.get("companion_consumers")
    if not string_list(consumers):
        add(blockers, "COMPANION_CONSUMERS_INVALID", "companion_consumers must be an array of non-empty strings", "companion_consumers")

    unknowns = payload.get("unknowns")
    if not isinstance(unknowns, dict):
        add(blockers, "UNKNOWNS_REQUIRED", "unknowns must be an object")
        unknowns = {}
    for name in ("blocking", "high_value", "deferrable"):
        value = unknowns.get(name)
        if not string_list(value):
            add(blockers, "UNKNOWNS_INVALID", f"unknowns.{name} must be an array of non-empty strings", f"unknowns.{name}")
            continue
        if name in {"blocking", "high_value"} and value:
            add(blockers, "UNRESOLVED_DECISION_UNKNOWN", f"unknowns.{name} contains unresolved items that can change the next safe action", f"unknowns.{name}")

    first_change = payload.get("first_change")
    if not isinstance(first_change, dict):
        add(blockers, "FIRST_CHANGE_REQUIRED", "first_change must be an object")
        first_change = {}
    require_fields(
        blockers,
        first_change,
        ("kind", "scope", "why_smallest", "falsifier", "rollback_or_recovery"),
        "first_change",
        "FIRST_CHANGE_FIELD_REQUIRED",
    )
    kind = first_change.get("kind")
    if nonempty(kind) and kind not in SAFE_MUTATION_KINDS:
        add(blockers, "FIRST_CHANGE_TOO_BROAD", f"first_change.kind {kind!r} is not an approved narrow takeover change", "first_change.kind")
    write_set = first_change.get("expected_write_set")
    if not string_list(write_set) or not write_set:
        add(blockers, "FIRST_CHANGE_WRITE_SET_REQUIRED", "first_change.expected_write_set must contain at least one bounded path/owner", "first_change.expected_write_set")

    validation = payload.get("validation")
    if not isinstance(validation, dict):
        add(blockers, "VALIDATION_REQUIRED", "validation must be an object")
        validation = {}
    require_fields(
        blockers,
        validation,
        ("focused_oracle", "integration_boundary", "exact_identity"),
        "validation",
        "VALIDATION_FIELD_REQUIRED",
    )
    required_gates = validation.get("required_gates")
    if not string_list(required_gates) or not required_gates:
        add(blockers, "VALIDATION_GATES_REQUIRED", "validation.required_gates must contain at least one repository-native gate", "validation.required_gates")

    parallel = payload.get("parallel_work")
    if not isinstance(parallel, dict):
        add(blockers, "PARALLEL_WORK_REQUIRED", "parallel_work must be an object")
        parallel = {}
    if parallel.get("checked") is not True:
        add(blockers, "PARALLEL_WORK_UNCHECKED", "parallel_work.checked must be true before mutation", "parallel_work.checked")
    overlaps = parallel.get("overlaps")
    if not string_list(overlaps):
        add(blockers, "PARALLEL_WORK_OVERLAPS_INVALID", "parallel_work.overlaps must be an array of non-empty strings", "parallel_work.overlaps")
        overlaps = []
    if overlaps and not nonempty(parallel.get("strategy")):
        add(blockers, "PARALLEL_WORK_STRATEGY_REQUIRED", "parallel_work.strategy is required when overlapping work exists", "parallel_work.strategy")

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "summary": {
            "identity_proofs": len(identity_evidence) if isinstance(identity_evidence, list) else 0,
            "liveness_proofs": len(liveness) if isinstance(liveness, list) else 0,
            "companion_consumers": len(consumers) if isinstance(consumers, list) else 0,
            "expected_write_set": len(write_set) if isinstance(write_set, list) else 0,
            "parallel_overlaps": len(overlaps) if isinstance(overlaps, list) else 0,
        },
        "note": "This gate checks takeover readiness and traceability; it does not prove that supplied repository evidence is truthful or that the planned change is correct.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
