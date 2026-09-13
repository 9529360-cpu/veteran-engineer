#!/usr/bin/env python3
"""Validate an accessibility product-engineering contract.

This gate checks engineering completeness across semantics, navigation, feedback,
visual/motion behavior, input alternatives, content, validation, and compatibility.
It does not certify conformance to a particular accessibility standard by itself.
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
    require_strings(experience, "experience", ["user_outcome", "degraded_behavior"], blockers)
    if not string_list(experience.get("surfaces")):
        add(blockers, "ACCESSIBILITY_SURFACES_REQUIRED", "experience.surfaces must be a non-empty array of strings", "experience.surfaces")
    if not string_list(experience.get("assistive_modes")):
        add(blockers, "ASSISTIVE_MODES_REQUIRED", "experience.assistive_modes must be a non-empty array of strings", "experience.assistive_modes")

    semantics = require_object(payload, "semantics", blockers)
    require_strings(semantics, "semantics", ["native_control_policy", "name_role_state", "structure_relationships"], blockers)

    navigation = require_object(payload, "navigation", blockers)
    require_strings(navigation, "navigation", ["keyboard_operation", "focus_order", "focus_transitions"], blockers)

    feedback = require_object(payload, "feedback", blockers)
    require_strings(feedback, "feedback", ["status_updates", "error_feedback", "loading_progress"], blockers)

    visual_motion = require_object(payload, "visual_motion", blockers)
    require_strings(visual_motion, "visual_motion", ["non_color_cues", "zoom_reflow", "contrast_policy", "motion_policy"], blockers)

    input_access = require_object(payload, "input", blockers)
    require_strings(input_access, "input", ["pointer_touch", "gesture_alternatives", "timing_policy"], blockers)

    content = require_object(payload, "content", blockers)
    require_strings(content, "content", ["form_labels_errors", "media_alternatives"], blockers)

    validation = require_object(payload, "validation", blockers)
    if not string_list(validation.get("representative_modes")):
        add(blockers, "VALIDATION_MODES_REQUIRED", "validation.representative_modes must be a non-empty array of strings", "validation.representative_modes")
    scenarios = validation.get("scenarios")
    if not string_list(scenarios):
        add(blockers, "VALIDATION_SCENARIOS_REQUIRED", "validation.scenarios must be a non-empty array of strings", "validation.scenarios")
    else:
        required = {"keyboard-only", "screen-reader", "focus-transition", "dynamic-update", "zoom-reflow", "non-color-cue"}
        missing = sorted(required.difference(scenarios))
        if missing:
            add(blockers, "VALIDATION_SCENARIOS_INCOMPLETE", f"validation.scenarios missing required classes: {', '.join(missing)}", "validation.scenarios")
    require_strings(validation, "validation", ["automated_oracle", "manual_oracle"], blockers)

    compatibility = require_object(payload, "compatibility", blockers)
    require_strings(compatibility, "compatibility", ["component_contract", "platform_differences", "rollback"], blockers)

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "surfaces": len(experience.get("surfaces", [])) if isinstance(experience.get("surfaces"), list) else 0,
            "assistive_modes": len(experience.get("assistive_modes", [])) if isinstance(experience.get("assistive_modes"), list) else 0,
            "validation_scenarios": len(validation.get("scenarios", [])) if isinstance(validation.get("scenarios"), list) else 0,
        },
        "note": "This gate checks accessibility engineering completeness; it is not a standards-certification oracle by itself.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
