#!/usr/bin/env python3
"""Validate a privacy and data-lifecycle engineering contract.

This gate checks technical completeness for purpose, minimization, authority, copies,
retention/export/deletion, provider boundaries, validation, observability, and rollback.
It does not determine legal obligations or certify regulatory compliance.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value) -> bool:
    return isinstance(value, list) and bool(value) and all(nonempty(item) for item in value)


def add(blockers, code, message, path=None):
    item = {"code": code, "message": message}
    if path:
        item["path"] = path
    blockers.append(item)


def require_object(payload, key, blockers):
    value = payload.get(key)
    if not isinstance(value, dict):
        add(blockers, f"{key.upper()}_REQUIRED", f"{key} must be an object", key)
        return {}
    return value


def require_strings(section, section_name, keys, blockers):
    for key in keys:
        if not nonempty(section.get(key)):
            add(blockers, f"{section_name.upper()}_FIELD_REQUIRED", f"{section_name}.{key} must be non-empty", f"{section_name}.{key}")


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

    purpose = require_object(payload, "purpose", blockers)
    require_strings(purpose, "purpose", ["user_outcome", "approved_purpose", "data_categories", "minimization_policy"], blockers)

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", ["authorization_owner", "processing_policy_owner", "preference_or_consent_owner", "freshness_policy"], blockers)

    copies = require_object(payload, "copies", blockers)
    require_strings(copies, "copies", ["system_of_record", "derivative_inventory", "logs_and_evidence", "backup_restore_behavior"], blockers)

    lifecycle = require_object(payload, "lifecycle", blockers)
    require_strings(lifecycle, "lifecycle", ["retention_anchor", "retention_action", "revocation_behavior", "deletion_convergence"], blockers)

    user_flows = require_object(payload, "user_flows", blockers)
    require_strings(user_flows, "user_flows", ["access_or_export", "correction", "deletion_or_closure", "visible_terminal_states"], blockers)

    providers = require_object(payload, "providers", blockers)
    require_strings(providers, "providers", ["egress_boundary", "data_minimization", "revocation_or_deletion", "failure_behavior"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["lifecycle_status", "redaction_policy", "reconciliation_failures"], blockers)

    validation = require_object(payload, "validation", blockers)
    scenarios = validation.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "VALIDATION_SCENARIOS_REQUIRED", "validation.scenarios must be a non-empty array of strings", "validation.scenarios")
    else:
        required = {"minimization", "revocation", "export-isolation", "deletion-convergence", "partial-failure", "stale-work"}
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "VALIDATION_SCENARIOS_INCOMPLETE", f"validation.scenarios missing required classes: {', '.join(missing)}", "validation.scenarios")
    require_strings(validation, "validation", ["oracle"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["mixed_version_behavior", "migration", "rollback"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "validation_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks privacy/data-lifecycle engineering completeness; approved policy and legal obligations remain external authorities.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
