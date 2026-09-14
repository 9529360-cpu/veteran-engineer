#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED_SCENARIOS = {
    "stable-assignment",
    "cross-tenant",
    "stale-config",
    "kill-switch",
    "old-client-new-server",
    "server-client-divergence",
    "percentage-ramp",
    "flag-dependency",
    "full-rollout-cleanup",
}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def add(blockers, code, path, message):
    blockers.append({"code": code, "path": path, "message": message})


def require_object(doc, key, blockers):
    value = doc.get(key)
    if not isinstance(value, dict):
        add(blockers, "SECTION_OBJECT_REQUIRED", key, f"{key} must be an object")
        return {}
    return value


def require_fields(obj, section, fields, blockers):
    for field in fields:
        if not nonempty(obj.get(field)):
            add(blockers, "FIELD_REQUIRED", f"{section}.{field}", f"{section}.{field} must be a non-empty string")


def load_manifest(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": str(path), "message": str(exc)}]
    if not isinstance(value, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest must be a JSON object"}]
    return value, []


def validate(doc):
    blockers = []

    flag = require_object(doc, "flag", blockers)
    require_fields(flag, "flag", ("id", "purpose", "owner", "value_contract", "default_behavior"), blockers)

    evaluation = require_object(doc, "evaluation", blockers)
    require_fields(
        evaluation,
        "evaluation",
        ("authority", "subject_identity", "tenant_scope", "stickiness", "version_or_generation", "stale_config_behavior"),
        blockers,
    )

    rollout = require_object(doc, "rollout", blockers)
    require_fields(
        rollout,
        "rollout",
        ("advance_criteria", "pause_criteria", "rollback_criteria", "kill_switch", "kill_propagation"),
        blockers,
    )
    stages = rollout.get("stages")
    if not isinstance(stages, list) or not stages or not all(nonempty(stage) for stage in stages):
        add(blockers, "ROLLOUT_STAGES_REQUIRED", "rollout.stages", "rollout.stages must contain one or more non-empty stage names")

    compatibility = require_object(doc, "compatibility", blockers)
    require_fields(
        compatibility,
        "compatibility",
        ("old_client_new_server", "new_client_old_server", "mixed_worker_config", "data_schema_overlap"),
        blockers,
    )

    dependencies = require_object(doc, "dependencies", blockers)
    require_fields(dependencies, "dependencies", ("precedence", "invalid_or_missing_config"), blockers)

    lifecycle = require_object(doc, "lifecycle", blockers)
    require_fields(lifecycle, "lifecycle", ("full_adoption_condition", "removal_condition", "cleanup_owner"), blockers)

    observability = require_object(doc, "observability", blockers)
    require_fields(
        observability,
        "observability",
        ("decision_correlation", "distribution_health", "staleness_health", "override_audit"),
        blockers,
    )

    tests = require_object(doc, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not isinstance(scenarios, list) or not all(nonempty(item) for item in scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios", "tests.scenarios must be a list of non-empty scenario names")
        scenarios = []
    scenario_set = set(scenarios)
    missing = sorted(REQUIRED_SCENARIOS - scenario_set)
    if missing:
        add(blockers, "REQUIRED_SCENARIOS_MISSING", "tests.scenarios", f"missing required scenarios: {', '.join(missing)}")
    if not nonempty(tests.get("oracle")):
        add(blockers, "TEST_ORACLE_REQUIRED", "tests.oracle", "tests.oracle must state the runtime/product postcondition")

    return {
        "gate_passed": not blockers,
        "flag_id": flag.get("id") if nonempty(flag.get("id")) else None,
        "stage_count": len(stages) if isinstance(stages, list) else 0,
        "scenario_count": len(scenarios),
        "required_scenarios": sorted(REQUIRED_SCENARIOS),
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate a feature-flag progressive-delivery engineering contract")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load_manifest(args.manifest)
    if doc is None:
        result = {
            "gate_passed": False,
            "flag_id": None,
            "stage_count": 0,
            "scenario_count": 0,
            "required_scenarios": sorted(REQUIRED_SCENARIOS),
            "blockers": blockers,
        }
    else:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"flag={result['flag_id']} stages={result['stage_count']} scenarios={result['scenario_count']}")
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
