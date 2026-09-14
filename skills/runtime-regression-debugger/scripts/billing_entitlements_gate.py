#!/usr/bin/env python3
"""Validate subscription, billing, and entitlement product-engineering completeness.

This gate checks commercial/subscription authority, catalog versioning, lifecycle,
monetary handoff, entitlement projection, usage metering, provider reconciliation,
observability, validation, and mixed-version behavior. It does not invent pricing,
tax, accounting, legal, or provider policy.
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

    product = require_object(payload, "product", blockers)
    require_strings(product, "product", ["user_outcome", "commercial_model", "visible_states"], blockers)
    if not string_list(product.get("subscription_classes")):
        add(blockers, "SUBSCRIPTION_CLASSES_REQUIRED", "product.subscription_classes must be a non-empty array of strings", "product.subscription_classes")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", ["catalog_owner", "subscription_owner", "entitlement_owner", "payment_owner", "provider_projection_owner"], blockers)

    identity = require_object(payload, "identity", blockers)
    require_strings(identity, "identity", ["account_scope", "subscription_identity", "change_request_identity", "billing_period_identity", "entitlement_generation"], blockers)

    catalog = require_object(payload, "catalog", blockers)
    require_strings(catalog, "catalog", ["plan_versioning", "feature_mapping", "price_currency_tax", "grandfathering"], blockers)

    lifecycle = require_object(payload, "lifecycle", blockers)
    require_strings(lifecycle, "lifecycle", ["trial", "activation", "renewal", "cancel_end_period", "grace_dunning", "upgrade_downgrade"], blockers)

    money = require_object(payload, "money", blockers)
    require_strings(money, "money", ["quote_authority", "proration", "invoice_payment_handoff", "refund_credit_handoff"], blockers)

    entitlements = require_object(payload, "entitlements", blockers)
    require_strings(entitlements, "entitlements", ["projection_source", "effective_time", "seat_scope", "revocation", "cache_freshness"], blockers)

    metering = require_object(payload, "metering", blockers)
    require_strings(metering, "metering", ["usage_identity", "aggregation_window", "late_duplicate_events", "corrections", "billing_cutoff"], blockers)

    provider = require_object(payload, "provider", blockers)
    require_strings(provider, "provider", ["webhook_auth", "dedupe_ordering", "unknown_outcome", "reconciliation", "provider_migration"], blockers)

    tests = require_object(payload, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios must be a non-empty array of strings", "tests.scenarios")
    else:
        required = {
            "duplicate-provider-event",
            "out-of-order-webhook",
            "unknown-plan-change-outcome",
            "trial-expiry",
            "cancel-at-period-end",
            "payment-failure-grace",
            "upgrade-proration",
            "downgrade-effective-time",
            "seat-overage-race",
            "late-usage-event",
            "cross-tenant-entitlement",
            "provider-reconciliation-drift",
        }
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "TEST_SCENARIOS_INCOMPLETE", f"tests.scenarios missing required classes: {', '.join(missing)}", "tests.scenarios")
    require_strings(tests, "tests", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["transition_correlation", "billing_entitlement_drift", "metering_health", "redaction_policy"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["mixed_version_behavior", "catalog_migration", "provider_migration", "rollback_external_effects"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "subscription_classes": len(product.get("subscription_classes", [])) if isinstance(product.get("subscription_classes"), list) else 0,
            "test_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks subscription/billing-entitlement engineering completeness; it does not define pricing, tax, accounting, legal, or provider policy.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
