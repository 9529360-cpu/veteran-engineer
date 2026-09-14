#!/usr/bin/env python3
"""Fail-closed completeness check for an end-to-end delivery slice.

The gate validates the evidence needed for the completion stage being claimed.
It does not prove that declared evidence is truthful or that production behavior
is correct.

Usage:
  delivery_slice_gate.py delivery.json [--json]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

SCHEMA = "veteran-delivery-slice-v2"
STAGES = {
    "code-change": 1,
    "merge-ready": 2,
    "release-candidate": 3,
    "deployed": 4,
    "production-verified": 5,
}
CLOSED_STATUS = {"done", "not_applicable"}


def nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value: object, *, nonempty_list: bool = False) -> bool:
    return isinstance(value, list) and (not nonempty_list or bool(value)) and all(nonempty(item) for item in value)


def evidence_ok(value: object) -> bool:
    return string_list(value, nonempty_list=True)


def gap(gaps: list[str], message: str) -> None:
    gaps.append(message)


def require_text(gaps: list[str], obj: dict, key: str, prefix: str) -> None:
    if not nonempty(obj.get(key)):
        gap(gaps, f"{prefix}.{key} must be a non-empty string")


def validate_closed_rows(
    gaps: list[str],
    rows: object,
    label: str,
    *,
    require_postconditions: bool,
    require_unique_names: bool = False,
) -> int:
    if not isinstance(rows, list):
        gap(gaps, f"{label} must be an array")
        return 0
    seen_names: set[str] = set()
    for idx, row in enumerate(rows, start=1):
        prefix = f"{label}[{idx}]"
        if not isinstance(row, dict):
            gap(gaps, f"{prefix} must be an object")
            continue
        name = row.get("name")
        require_text(gaps, row, "name", prefix)
        if require_unique_names and nonempty(name):
            if name in seen_names:
                gap(gaps, f"{prefix}.name duplicates {name!r}; names must be unique within {label}")
            else:
                seen_names.add(name)
        applicable = row.get("applicable", True)
        if not isinstance(applicable, bool):
            gap(gaps, f"{prefix}.applicable must be boolean")
            continue
        status = row.get("status")
        if not isinstance(status, str) or status not in CLOSED_STATUS:
            gap(gaps, f"{prefix} is not closed: {status!r}")
            continue
        if applicable:
            if status != "done":
                gap(gaps, f"{prefix} is applicable but status is {status!r}")
                continue
            if require_postconditions:
                require_text(gaps, row, "owner", prefix)
                require_text(gaps, row, "success_postcondition", prefix)
                require_text(gaps, row, "error_postcondition", prefix)
            if not evidence_ok(row.get("evidence")):
                gap(gaps, f"{prefix} done but missing evidence")
        else:
            if status != "not_applicable":
                gap(gaps, f"{prefix} not applicable but status is {status!r}")
            if not nonempty(row.get("reason")):
                gap(gaps, f"{prefix} not applicable but missing reason")
    return len(rows)


def validate_check(gaps: list[str], obj: object, prefix: str, *, required: bool) -> None:
    if not isinstance(obj, dict):
        if required:
            gap(gaps, f"{prefix} must be an object")
        return
    applicable = obj.get("applicable", True)
    if not isinstance(applicable, bool):
        gap(gaps, f"{prefix}.applicable must be boolean")
        return
    if not applicable:
        if required:
            gap(gaps, f"{prefix} is required for the claimed completion stage")
        elif not nonempty(obj.get("reason")):
            gap(gaps, f"{prefix}.reason is required when not applicable")
        return
    if obj.get("status") != "passed":
        gap(gaps, f"{prefix}.status must be 'passed'")
    if not evidence_ok(obj.get("evidence")):
        gap(gaps, f"{prefix}.evidence must contain at least one proof")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_json")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    path = pathlib.Path(args.input_json)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot read delivery slice: {exc}", file=sys.stderr)
        return 2
    if not isinstance(payload, dict):
        print("error: delivery slice root must be an object", file=sys.stderr)
        return 2

    gaps: list[str] = []
    if payload.get("schema") != SCHEMA:
        gap(gaps, f"schema must be {SCHEMA!r}")

    stage = payload.get("completion_stage")
    if not isinstance(stage, str) or stage not in STAGES:
        gap(gaps, f"completion_stage must be one of {sorted(STAGES)}")
        stage_rank = 0
    else:
        stage_rank = STAGES[stage]

    identity = payload.get("change_identity")
    if not isinstance(identity, dict):
        gap(gaps, "change_identity must be an object")
        identity = {}
    for key in ("repository", "base_revision", "head_revision", "change_id"):
        require_text(gaps, identity, key, "change_identity")
    if not evidence_ok(identity.get("evidence")):
        gap(gaps, "change_identity.evidence must contain at least one proof")

    if not nonempty(payload.get("contract")):
        gap(gaps, "contract must be a non-empty string")
    if not nonempty(payload.get("visible_completion")):
        gap(gaps, "visible_completion must be a non-empty string")

    write_set = payload.get("write_set")
    if not isinstance(write_set, dict):
        gap(gaps, "write_set must be an object")
        write_set = {}
    expected = write_set.get("expected")
    actual = write_set.get("actual")
    if not string_list(expected, nonempty_list=True):
        gap(gaps, "write_set.expected must contain at least one path/owner")
        expected = []
    if not string_list(actual, nonempty_list=True):
        gap(gaps, "write_set.actual must contain at least one path/owner")
        actual = []
    exceptions = write_set.get("exceptions", [])
    exception_paths = set()
    if not isinstance(exceptions, list):
        gap(gaps, "write_set.exceptions must be an array")
        exceptions = []
    for idx, item in enumerate(exceptions, start=1):
        prefix = f"write_set.exceptions[{idx}]"
        if not isinstance(item, dict):
            gap(gaps, f"{prefix} must be an object")
            continue
        if not nonempty(item.get("path")) or not nonempty(item.get("reason")):
            gap(gaps, f"{prefix} requires non-empty path and reason")
            continue
        exception_paths.add(item["path"])
    expected_set = set(expected) if isinstance(expected, list) else set()
    actual_set = set(actual) if isinstance(actual, list) else set()
    for item in sorted(expected_set ^ actual_set):
        if item not in exception_paths:
            gap(gaps, f"write_set drift for {item!r} requires an explicit exception reason")

    transition_count = validate_closed_rows(
        gaps,
        payload.get("transitions"),
        "transitions",
        require_postconditions=True,
        require_unique_names=True,
    )
    if transition_count == 0:
        gap(gaps, "transitions must contain at least one material transition")
    companion_count = validate_closed_rows(
        gaps,
        payload.get("companions", []),
        "companions",
        require_postconditions=False,
        require_unique_names=True,
    )
    consumer_count = validate_closed_rows(
        gaps,
        payload.get("consumers", []),
        "consumers",
        require_postconditions=False,
        require_unique_names=True,
    )

    effects = payload.get("durable_or_external_effects")
    if not isinstance(effects, dict):
        gap(gaps, "durable_or_external_effects must be an object")
        effects = {}
    present = effects.get("present")
    if not isinstance(present, bool):
        gap(gaps, "durable_or_external_effects.present must be boolean")
    elif present:
        for key in ("replay_semantics", "rollback_or_forward_repair", "terminal_or_reconciliation_state"):
            require_text(gaps, effects, key, "durable_or_external_effects")
        if not evidence_ok(effects.get("evidence")):
            gap(gaps, "durable_or_external_effects.evidence must contain at least one proof")
    elif not nonempty(effects.get("reason")):
        gap(gaps, "durable_or_external_effects.reason is required when no durable/external effect exists")

    validation = payload.get("validation")
    if not isinstance(validation, dict):
        gap(gaps, "validation must be an object")
        validation = {}
    require_text(gaps, validation, "exact_identity", "validation")
    validate_check(gaps, validation.get("focused"), "validation.focused", required=True)
    validate_check(gaps, validation.get("integration"), "validation.integration", required=stage_rank >= STAGES["merge-ready"])
    validate_check(gaps, validation.get("visible_boundary"), "validation.visible_boundary", required=stage_rank >= STAGES["merge-ready"])
    required_gates = validation.get("required_gates")
    gate_count = validate_closed_rows(gaps, required_gates, "validation.required_gates", require_postconditions=False)
    if gate_count == 0:
        gap(gaps, "validation.required_gates must contain at least one repository-native gate")

    integration = payload.get("integration_readiness")
    if stage_rank >= STAGES["merge-ready"]:
        if not isinstance(integration, dict):
            gap(gaps, "integration_readiness must be an object for merge-ready or later claims")
        else:
            for key in ("base_fresh", "parallel_conflicts_checked"):
                if integration.get(key) is not True:
                    gap(gaps, f"integration_readiness.{key} must be true")
            if not evidence_ok(integration.get("evidence")):
                gap(gaps, "integration_readiness.evidence must contain at least one proof")

    release = payload.get("release_candidate")
    if stage_rank >= STAGES["release-candidate"]:
        if not isinstance(release, dict):
            gap(gaps, "release_candidate must be an object for release-candidate or later claims")
        else:
            require_text(gaps, release, "artifact_identity", "release_candidate")
            if not evidence_ok(release.get("evidence")):
                gap(gaps, "release_candidate.evidence must contain at least one proof")

    deployment = payload.get("deployment")
    if stage_rank >= STAGES["deployed"]:
        if not isinstance(deployment, dict):
            gap(gaps, "deployment must be an object for deployed or later claims")
        else:
            for key in ("environment", "release_identity", "rollout", "rollback_or_forward_repair"):
                require_text(gaps, deployment, key, "deployment")
            if not evidence_ok(deployment.get("evidence")):
                gap(gaps, "deployment.evidence must contain at least one proof")

    production = payload.get("production_verification")
    if stage_rank >= STAGES["production-verified"]:
        if not isinstance(production, dict):
            gap(gaps, "production_verification must be an object for production-verified claims")
        else:
            for key in ("release_identity", "observed_at", "user_visible_result"):
                require_text(gaps, production, key, "production_verification")
            if not evidence_ok(production.get("evidence")):
                gap(gaps, "production_verification.evidence must contain at least one proof")

    temporary = payload.get("temporary_mechanisms", [])
    temporary_count = validate_closed_rows(gaps, temporary, "temporary_mechanisms", require_postconditions=False)

    passed = not gaps
    output = {
        "passed": passed,
        "completion_stage": stage,
        "transition_count": transition_count,
        "companion_count": companion_count,
        "consumer_count": consumer_count,
        "temporary_mechanism_count": temporary_count,
        "gaps": gaps,
        "note": "Completeness/claim-level aid only; repository/runtime evidence still determines correctness and truth.",
    }
    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print("# Delivery slice gate")
        print("status:", "PASS" if passed else "FAIL")
        print("completion_stage:", stage)
        for item in gaps:
            print("-", item)
        print("note:", output["note"])
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
