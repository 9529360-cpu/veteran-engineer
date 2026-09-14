#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED_SCENARIOS = {
    "token-drift",
    "duplicate-primitive",
    "variant-semantic-drift",
    "shared-primitive-regression",
    "long-content-pressure",
    "responsive-layout",
    "keyboard-focus",
    "accessibility-semantics",
    "legacy-consumer-migration",
    "intentional-exception",
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


def require_string_list(obj, owner, field, blockers):
    value = obj.get(field)
    if not isinstance(value, list) or not value or not all(nonempty(item) for item in value):
        add(blockers, "STRING_LIST_REQUIRED", f"{owner}.{field}", f"{owner}.{field} must be a non-empty list of non-empty strings")
        return []
    return value


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

    scope = section(doc, "scope", blockers)
    require_fields(
        scope,
        "scope",
        ("design_language_owner", "user_impact", "change_class", "non_goals"),
        blockers,
    )
    product_surfaces = require_string_list(scope, "scope", "product_surfaces", blockers)

    inventory = section(doc, "inventory", blockers)
    require_fields(
        inventory,
        "inventory",
        ("token_sources", "primitive_sources", "product_component_sources", "legacy_or_one_off_surfaces"),
        blockers,
    )

    authority = section(doc, "authority", blockers)
    require_fields(
        authority,
        "authority",
        ("token_owner", "primitive_owner", "product_wrapper_owner", "exception_owner"),
        blockers,
    )

    semantics = section(doc, "semantics", blockers)
    require_fields(
        semantics,
        "semantics",
        ("state_model", "variant_contract", "content_constraints", "accessibility_contract"),
        blockers,
    )

    consistency = section(doc, "consistency", blockers)
    require_fields(
        consistency,
        "consistency",
        ("drift_evidence", "canonical_pattern", "intentional_exception_policy", "duplicate_primitive_policy"),
        blockers,
    )

    migration = section(doc, "migration", blockers)
    require_fields(
        migration,
        "migration",
        ("adoption_sequence", "mixed_old_new_behavior", "legacy_cleanup", "rollback_or_forward_repair"),
        blockers,
    )

    verification = section(doc, "verification", blockers)
    representative_surfaces = require_string_list(verification, "verification", "representative_surfaces", blockers)
    require_fields(
        verification,
        "verification",
        ("viewport_state_content_boundary", "accessibility_checks", "rendered_evidence", "visual_quality_boundary", "regression_oracle"),
        blockers,
    )

    lifecycle = section(doc, "lifecycle", blockers)
    require_fields(
        lifecycle,
        "lifecycle",
        ("versioning_or_change_communication", "deprecation_owner", "removal_condition"),
        blockers,
    )

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
        add(blockers, "TEST_ORACLE_REQUIRED", "tests.oracle", "tests.oracle must state the authoritative shared-UI consistency postcondition")

    if product_surfaces and representative_surfaces:
        undeclared = sorted(set(representative_surfaces) - set(product_surfaces))
        if undeclared:
            add(
                blockers,
                "REPRESENTATIVE_SURFACE_SCOPE_INVALID",
                "verification.representative_surfaces",
                f"representative surfaces must come from scope.product_surfaces; undeclared: {', '.join(undeclared)}",
            )

    return {
        "gate_passed": not blockers,
        "surface_count": len(product_surfaces),
        "representative_surface_count": len(representative_surfaces),
        "scenario_count": len(scenarios),
        "required_scenarios": sorted(REQUIRED_SCENARIOS),
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate a design-system and UI consistency engineering contract")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load(args.manifest)
    if doc is None:
        result = {
            "gate_passed": False,
            "surface_count": 0,
            "representative_surface_count": 0,
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
        print(
            f"surfaces={result['surface_count']} representative={result['representative_surface_count']} scenarios={result['scenario_count']}"
        )
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
