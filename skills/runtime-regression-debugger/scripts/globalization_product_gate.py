#!/usr/bin/env python3
"""Validate a globalization / internationalization product engineering contract.

This checks engineering completeness for locale, translation, formatting, directionality,
input, compatibility, and validation boundaries. It does not prove linguistic quality.
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
    require_strings(experience, "experience", ["user_outcome", "fallback_locale", "unsupported_locale_behavior"], blockers)
    if not string_list(experience.get("supported_locales")):
        add(blockers, "SUPPORTED_LOCALES_REQUIRED", "experience.supported_locales must be a non-empty array of strings", "experience.supported_locales")
    elif nonempty(experience.get("fallback_locale")) and experience["fallback_locale"] not in experience["supported_locales"]:
        add(blockers, "FALLBACK_LOCALE_UNSUPPORTED", "experience.fallback_locale must be listed in experience.supported_locales", "experience.fallback_locale")

    authority = require_object(payload, "authority", blockers)
    require_strings(authority, "authority", ["locale_resolution", "translation_catalog", "formatting_owner", "persistence_scope"], blockers)

    text = require_object(payload, "text", blockers)
    require_strings(text, "text", ["message_key_policy", "interpolation_policy", "pluralization_policy", "fallback_policy"], blockers)

    time = require_object(payload, "time", blockers)
    require_strings(time, "time", ["timestamp_storage", "timezone_source", "dst_policy", "calendar_policy"], blockers)

    layout_input = require_object(payload, "layout_input", blockers)
    require_strings(layout_input, "layout_input", ["directionality_policy", "rtl_validation", "ime_composition_policy", "unicode_policy"], blockers)

    data = require_object(payload, "data", blockers)
    require_strings(data, "data", ["locale_independent_identifiers", "server_client_format_boundary", "sorting_search_policy"], blockers)

    validation = require_object(payload, "validation", blockers)
    if not string_list(validation.get("representative_locales")):
        add(blockers, "VALIDATION_LOCALES_REQUIRED", "validation.representative_locales must be a non-empty array of strings", "validation.representative_locales")
    scenarios = validation.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "VALIDATION_SCENARIOS_REQUIRED", "validation.scenarios must be a non-empty array of strings", "validation.scenarios")
    else:
        required_scenarios = {"fallback", "rtl", "dst-transition", "long-translation", "ime-composition"}
        missing = sorted(required_scenarios.difference(scenarios))
        if missing:
            add(blockers, "VALIDATION_SCENARIOS_INCOMPLETE", f"validation.scenarios missing required classes: {', '.join(missing)}", "validation.scenarios")
    if not nonempty(validation.get("oracle")):
        add(blockers, "VALIDATION_ORACLE_REQUIRED", "validation.oracle must be non-empty", "validation.oracle")

    observability = require_object(payload, "observability", blockers)
    require_strings(observability, "observability", ["missing_translation", "formatting_failure", "fallback_usage"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["old_client_behavior", "catalog_rollout", "rollback"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "supported_locales": len(experience.get("supported_locales", [])) if isinstance(experience.get("supported_locales"), list) else 0,
            "representative_locales": len(validation.get("representative_locales", [])) if isinstance(validation.get("representative_locales"), list) else 0,
            "validation_scenarios": len(validation.get("scenarios", [])) if isinstance(validation.get("scenarios"), list) else 0,
        },
        "note": "This gate checks globalization engineering completeness, not translation quality or cultural appropriateness by itself.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
