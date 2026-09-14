#!/usr/bin/env python3
"""Validate organization/workspace membership lifecycle engineering completeness."""
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

    product = require_object(payload, "product", blockers)
    require_strings(product, "product", ["user_outcome", "organization_model", "visible_states"], blockers)
    if not string_list(product.get("membership_classes")):
        add(blockers, "MEMBERSHIP_CLASSES_REQUIRED", "product.membership_classes must be a non-empty array of strings", "product.membership_classes")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", [
        "identity_owner", "organization_owner", "membership_owner", "role_policy_owner",
        "directory_sync_owner", "resource_ownership_owner"
    ], blockers)

    invitation = require_object(payload, "invitation", blockers)
    require_strings(invitation, "invitation", [
        "invitation_identity", "recipient_binding", "role_scope", "expiry_revocation", "acceptance_recheck"
    ], blockers)

    membership = require_object(payload, "membership", blockers)
    require_strings(membership, "membership", [
        "stable_identity", "state_machine", "role_change", "suspend_remove", "guest_expiry", "reactivation"
    ], blockers)

    ownership = require_object(payload, "ownership", blockers)
    require_strings(ownership, "ownership", [
        "owner_transfer", "last_owner_guard", "resource_transfer", "orphan_policy"
    ], blockers)

    authorization = require_object(payload, "authorization", blockers)
    require_strings(authorization, "authorization", [
        "membership_generation", "request_authorization", "cache_invalidation", "job_reauthorization", "session_revocation"
    ], blockers)

    provisioning = require_object(payload, "provisioning", blockers)
    require_strings(provisioning, "provisioning", [
        "external_identity", "group_mapping", "source_precedence", "deprovision", "reconciliation"
    ], blockers)

    tests = require_object(payload, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios must be a non-empty array of strings", "tests.scenarios")
    else:
        required = {
            "duplicate-invite-accept",
            "revoked-invite",
            "expired-invite",
            "cross-tenant-invite",
            "role-change-stale-session",
            "remove-member-stale-job",
            "last-owner-removal",
            "resource-transfer-on-removal",
            "scim-out-of-order",
            "scim-reactivation",
            "group-mapping-change",
            "guest-expiry",
        }
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "TEST_SCENARIOS_INCOMPLETE", f"tests.scenarios missing required classes: {', '.join(missing)}", "tests.scenarios")
    require_strings(tests, "tests", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", [
        "membership_transition_correlation", "authorization_staleness", "provisioning_drift", "redaction_policy"
    ], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", [
        "mixed_version_behavior", "membership_schema_migration", "directory_migration", "rollback_external_effects"
    ], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "membership_classes": len(product.get("membership_classes", [])) if isinstance(product.get("membership_classes"), list) else 0,
            "test_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks organization/workspace membership lifecycle engineering completeness; it does not define business role policy or identity-provider policy.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
