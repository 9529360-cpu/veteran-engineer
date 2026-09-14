#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED_SCENARIOS = {
    "first-time-user",
    "resume-after-exit",
    "duplicate-submit",
    "cross-device-resume",
    "cross-tenant-isolation",
    "invited-existing-workspace",
    "permission-role-change",
    "async-prerequisite-failure",
    "timeout-after-success",
    "existing-user-migration",
    "empty-vs-not-configured",
    "reentry-after-prerequisite-loss",
}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def add(blockers, code, path, message):
    blockers.append({"code": code, "path": path, "message": message})


def section(doc, name, blockers):
    value = doc.get(name)
    if not isinstance(value, dict):
        add(blockers, "SECTION_OBJECT_REQUIRED", name, f"{name} must be an object")
        return {}
    return value


def require_fields(obj, owner, fields, blockers):
    for field in fields:
        if not nonempty(obj.get(field)):
            add(blockers, "FIELD_REQUIRED", f"{owner}.{field}", f"{owner}.{field} must be a non-empty string")


def load(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": str(path), "message": str(exc)}]
    if not isinstance(value, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest must be a JSON object"}]
    return value, []


def validate(doc):
    blockers = []

    experience = section(doc, "experience", blockers)
    require_fields(experience, "experience", ("target_population", "first_value", "completion_semantics", "next_destination"), blockers)

    scope = section(doc, "scope", blockers)
    require_fields(scope, "scope", ("subject_scope", "eligibility_owner", "onboarding_version"), blockers)

    authority = section(doc, "authority", blockers)
    require_fields(authority, "authority", ("progress_owner", "completion_owner", "activation_owner", "client_projection"), blockers)

    steps = section(doc, "steps", blockers)
    require_fields(
        steps,
        "steps",
        ("required_optional_policy", "prerequisite_model", "alternate_paths", "skip_dismiss_policy_source"),
        blockers,
    )

    continuity = section(doc, "continuity", blockers)
    require_fields(
        continuity,
        "continuity",
        ("stable_identity", "resume_reentry", "cross_device", "cross_tenant"),
        blockers,
    )

    recovery = section(doc, "recovery", blockers)
    require_fields(
        recovery,
        "recovery",
        ("duplicate_retry", "timeout_after_success", "async_prerequisite", "reset_safety"),
        blockers,
    )

    compatibility = section(doc, "compatibility", blockers)
    require_fields(
        compatibility,
        "compatibility",
        ("existing_user_migration", "mixed_client_behavior", "role_permission_change"),
        blockers,
    )

    measurement = section(doc, "measurement", blockers)
    require_fields(
        measurement,
        "measurement",
        ("activation_event_or_fact", "time_to_value", "progress_events", "guardrails"),
        blockers,
    )

    quality = section(doc, "quality", blockers)
    require_fields(quality, "quality", ("accessibility", "localization", "empty_state_semantics"), blockers)

    lifecycle = section(doc, "lifecycle", blockers)
    require_fields(lifecycle, "lifecycle", ("reentry_condition", "cleanup_owner", "deprecated_version_cleanup"), blockers)

    tests = section(doc, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not isinstance(scenarios, list) or not all(nonempty(item) for item in scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios", "tests.scenarios must be a list of non-empty scenario names")
        scenarios = []
    scenario_set = set(scenarios)
    missing = sorted(REQUIRED_SCENARIOS - scenario_set)
    if missing:
        add(blockers, "REQUIRED_SCENARIOS_MISSING", "tests.scenarios", f"missing required scenarios: {', '.join(missing)}")
    if not nonempty(tests.get("oracle")):
        add(blockers, "TEST_ORACLE_REQUIRED", "tests.oracle", "tests.oracle must state the authoritative first-value/progress postcondition")

    return {
        "gate_passed": not blockers,
        "onboarding_version": scope.get("onboarding_version") if nonempty(scope.get("onboarding_version")) else None,
        "scenario_count": len(scenarios),
        "required_scenarios": sorted(REQUIRED_SCENARIOS),
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate a user onboarding and activation engineering contract")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load(args.manifest)
    if doc is None:
        result = {"gate_passed": False, "onboarding_version": None, "scenario_count": 0, "required_scenarios": sorted(REQUIRED_SCENARIOS), "blockers": blockers}
    else:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"version={result['onboarding_version']} scenarios={result['scenario_count']}")
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
