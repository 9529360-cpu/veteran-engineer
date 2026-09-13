#!/usr/bin/env python3
"""Validate a collaboration/realtime product-engineering contract.

This checks engineering completeness for shared-state authority, operation identity,
ordering, optimistic reconciliation, presence, reconnect/offline behavior, permissions,
backpressure, validation, and mixed-version compatibility. It does not select a merge
algorithm or transport on the user's behalf.
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
    require_strings(experience, "experience", ["user_outcome", "shared_object_scope", "degraded_behavior"], blockers)
    if not string_list(experience.get("actors")):
        add(blockers, "ACTORS_REQUIRED", "experience.actors must be a non-empty array of strings", "experience.actors")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", ["durable_state_owner", "authorization_owner", "publication_owner"], blockers)

    operations = require_object(payload, "operations", blockers)
    require_strings(operations, "operations", ["operation_identity", "version_or_ordering", "duplicate_retry", "optimistic_reconciliation"], blockers)

    presence = require_object(payload, "presence", blockers)
    require_strings(presence, "presence", ["scope_and_identity", "expiry_policy", "multi_device_behavior"], blockers)

    connectivity = require_object(payload, "connectivity", blockers)
    require_strings(connectivity, "connectivity", ["reconnect_resume", "offline_policy", "stale_generation_policy"], blockers)

    conflicts = require_object(payload, "conflicts", blockers)
    require_strings(conflicts, "conflicts", ["concurrent_update_policy", "merge_or_reject_policy"], blockers)

    transport = require_object(payload, "transport", blockers)
    require_strings(transport, "transport", ["delivery_model", "backpressure_policy", "resync_policy"], blockers)

    validation = require_object(payload, "validation", blockers)
    scenarios = validation.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "VALIDATION_SCENARIOS_REQUIRED", "validation.scenarios must be a non-empty array of strings", "validation.scenarios")
    else:
        required = {"concurrent-write", "duplicate-retry", "lost-ack", "out-of-order", "reconnect-gap", "permission-revocation", "offline-stale", "presence-expiry"}
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "VALIDATION_SCENARIOS_INCOMPLETE", f"validation.scenarios missing required classes: {', '.join(missing)}", "validation.scenarios")
    require_strings(validation, "validation", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["operation_status", "connection_health", "reconciliation_failures"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["mixed_version_behavior", "schema_rollout", "rollback"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "actors": len(experience.get("actors", [])) if isinstance(experience.get("actors"), list) else 0,
            "validation_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks collaboration/realtime engineering completeness; it does not prescribe WebSocket, CRDT, OT, locks, or another transport/merge mechanism.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
