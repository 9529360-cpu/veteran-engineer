#!/usr/bin/env python3
"""Validate notification and outbound-delivery product engineering completeness.

This gate checks identity, eligibility/preferences, rendering, scheduling, delivery,
receipts/failure semantics, observability, validation, and compatibility. It does
not choose providers or certify legal/compliance requirements.
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

    experience = require_object(payload, "experience", blockers)
    require_strings(experience, "experience", ["user_outcome", "purpose", "visible_states"], blockers)
    if not string_list(experience.get("notification_classes")):
        add(blockers, "NOTIFICATION_CLASSES_REQUIRED", "experience.notification_classes must be a non-empty array of strings", "experience.notification_classes")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", ["trigger_owner", "recipient_owner", "preference_policy_owner", "send_time_freshness"], blockers)

    identity = require_object(payload, "identity", blockers)
    require_strings(identity, "identity", ["logical_intent", "dedupe_key", "attempt_identity", "version_or_generation"], blockers)

    rendering = require_object(payload, "rendering", blockers)
    require_strings(rendering, "rendering", ["template_version", "locale_fallback", "action_target", "sensitive_content_policy"], blockers)

    scheduling = require_object(payload, "scheduling", blockers)
    require_strings(scheduling, "scheduling", ["schedule_authority", "timezone_quiet_hours", "expiry_staleness", "cancel_reschedule"], blockers)

    delivery = require_object(payload, "delivery", blockers)
    require_strings(delivery, "delivery", ["channel_policy", "provider_handoff", "retry_unknown_outcome", "rate_limit_backpressure", "failover_or_fallback", "endpoint_security"], blockers)

    outcomes = require_object(payload, "outcomes", blockers)
    require_strings(outcomes, "outcomes", ["provider_receipts", "permanent_destination_failure", "partial_fanout", "user_visible_completion"], blockers)

    tests = require_object(payload, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios must be a non-empty array of strings", "tests.scenarios")
    else:
        required = {
            "duplicate-trigger",
            "unknown-provider-outcome",
            "provider-throttle",
            "permanent-destination-failure",
            "preference-revoked-before-send",
            "stale-scheduled-notification",
            "partial-fanout",
            "out-of-order-receipt",
            "template-version-rollout",
            "cross-tenant-recipient",
        }
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "TEST_SCENARIOS_INCOMPLETE", f"tests.scenarios missing required classes: {', '.join(missing)}", "tests.scenarios")
    require_strings(tests, "tests", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["intent_attempt_correlation", "provider_outcomes", "queue_suppression_health", "redaction_policy"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["mixed_version_behavior", "template_or_provider_migration", "rollback_external_effects"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "notification_classes": len(experience.get("notification_classes", [])) if isinstance(experience.get("notification_classes"), list) else 0,
            "test_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks notification/outbound-delivery engineering completeness; it does not choose a provider or define jurisdiction-specific communication policy.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
