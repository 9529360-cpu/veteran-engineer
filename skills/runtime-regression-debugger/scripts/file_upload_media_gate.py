#!/usr/bin/env python3
"""Validate a file/upload/media product-engineering contract.

This gate checks engineering completeness for upload authority, transfer/finalization,
validation/processing, attachment/delivery, lifecycle cleanup, observability, and
compatibility. It does not select a storage provider, scanner, transcoder, or CDN.
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
    if not string_list(experience.get("file_categories")):
        add(blockers, "FILE_CATEGORIES_REQUIRED", "experience.file_categories must be a non-empty array of strings", "experience.file_categories")

    identity = require_object(payload, "identity", blockers)
    require_strings(identity, "identity", ["upload_intent", "object_version", "domain_attachment", "owner_scope"], blockers)

    transfer = require_object(payload, "transfer", blockers)
    require_strings(transfer, "transfer", ["method", "resume_retry", "finalization", "unknown_outcome", "abandon_cleanup"], blockers)

    validation = require_object(payload, "validation_processing", blockers)
    require_strings(validation, "validation_processing", ["trusted_validation", "quarantine_policy", "processing_state", "stale_transform_policy"], blockers)

    delivery = require_object(payload, "delivery", blockers)
    require_strings(delivery, "delivery", ["authorization", "preview_download", "signed_capability_policy", "cache_versioning"], blockers)

    lifecycle = require_object(payload, "lifecycle", blockers)
    require_strings(lifecycle, "lifecycle", ["attach_commit", "replacement_versioning", "delete_cleanup", "orphan_policy", "quota_policy"], blockers)

    tests = require_object(payload, "tests", blockers)
    scenarios = tests.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "TEST_SCENARIOS_REQUIRED", "tests.scenarios must be a non-empty array of strings", "tests.scenarios")
    else:
        required = {
            "cross-tenant-attach",
            "duplicate-finalize",
            "lost-finalize-ack",
            "interrupted-resume",
            "invalid-content",
            "processing-failure",
            "quarantine-bypass",
            "stale-transform",
            "delete-cleanup",
        }
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "TEST_SCENARIOS_INCOMPLETE", f"tests.scenarios missing required classes: {', '.join(missing)}", "tests.scenarios")
    require_strings(tests, "tests", ["oracle"], blockers)

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["transfer_status", "processing_status", "cleanup_status"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["mixed_version_behavior", "storage_or_recipe_migration", "rollback"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "file_categories": len(experience.get("file_categories", [])) if isinstance(experience.get("file_categories"), list) else 0,
            "test_scenarios": len(scenarios) if isinstance(scenarios, list) else 0,
        },
        "note": "This gate checks file/upload/media engineering completeness; it does not prescribe a storage provider, multipart threshold, scanner, transcoder, or CDN.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
