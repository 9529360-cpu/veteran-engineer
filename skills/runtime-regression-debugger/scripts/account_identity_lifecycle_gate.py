#!/usr/bin/env python3
"""Validate account and identity lifecycle product-engineering completeness."""
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
    require_strings(product, "product", ["user_outcome", "account_model", "visible_states"], blockers)
    if not string_list(product.get("credential_classes")):
        add(blockers, "CREDENTIAL_CLASSES_REQUIRED", "product.credential_classes must be a non-empty array of strings", "product.credential_classes")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", [
        "account_owner", "contact_verification_owner", "credential_owner", "session_owner",
        "recovery_owner", "identity_link_owner"
    ], blockers)

    registration = require_object(payload, "registration", blockers)
    require_strings(registration, "registration", [
        "signup_identity", "contact_verification", "duplicate_account", "enumeration_resistance", "activation"
    ], blockers)

    credentials = require_object(payload, "credentials", blockers)
    require_strings(credentials, "credentials", [
        "password_change", "passkey_webauthn", "mfa_enrollment", "recovery_codes", "credential_rotation"
    ], blockers)

    recovery = require_object(payload, "recovery", blockers)
    require_strings(recovery, "recovery", [
        "initiation", "proof", "step_up", "revocation_cooldown", "post_recovery"
    ], blockers)

    linking = require_object(payload, "linking", blockers)
    require_strings(linking, "linking", [
        "provider_binding", "reauthentication", "collision_merge", "unlink_last_factor", "tenant_scope"
    ], blockers)

    sessions = require_object(payload, "sessions", blockers)
    require_strings(sessions, "sessions", [
        "generation", "device_visibility", "revocation", "sensitive_reauth", "token_rotation"
    ], blockers)

    closure = require_object(payload, "closure", blockers)
    require_strings(closure, "closure", [
        "account_close", "membership_resource_handoff", "credential_provider_cleanup", "data_lifecycle", "final_signout"
    ], blockers)

    tests = require_object(payload, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios must be a non-empty array of strings", "tests.scenarios")
    else:
        required = {
            "duplicate-signup",
            "expired-verification",
            "account-enumeration",
            "mfa-enrollment-race",
            "lost-primary-factor",
            "recovery-token-replay",
            "recovery-session-revocation",
            "passkey-replacement",
            "provider-link-collision",
            "unlink-last-factor",
            "stale-session-after-password-change",
            "cross-account-recovery",
            "account-closure-with-active-session",
        }
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "TEST_SCENARIOS_INCOMPLETE", f"tests.scenarios missing required classes: {', '.join(missing)}", "tests.scenarios")
    require_strings(tests, "tests", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", [
        "identity_transition_correlation", "recovery_risk", "session_credential_drift", "redaction_policy"
    ], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", [
        "mixed_version_behavior", "credential_migration", "identity_provider_migration", "rollback_external_effects"
    ], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "credential_classes": len(product.get("credential_classes", [])) if isinstance(product.get("credential_classes"), list) else 0,
            "test_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks account/identity lifecycle engineering completeness; it does not invent authentication assurance, recovery, identity-provider, or legal policy.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
