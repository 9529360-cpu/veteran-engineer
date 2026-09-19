#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

UI_KINDS = {"ui", "web-ui", "desktop-ui", "mobile-ui"}
UI_CHECKS = (
    "visual_hierarchy",
    "interaction_states",
    "responsive",
    "accessibility",
    "copy_content",
    "design_consistency",
)

# Candidate categories are intentionally product/risk oriented. They are not a
# requirement to inspect every category on every sweep.
CATEGORIES = {
    "correctness",
    "experience",
    "accessibility",
    "content",
    "performance",
    "reliability",
    "maintainability",
    "design-system",
    "security",
    "data-integrity",
    "observability",
    "operability",
    "cost-efficiency",
    "developer-experience",
    "onboarding",
    "delivery",
}
BASE_ACTIONS = {"fix", "defer", "no-change"}
HEALTH_ACTIONS = BASE_ACTIONS | {"probe", "refactor", "remove"}
ACTIVE_ACTIONS = {"fix", "probe", "refactor", "remove"}
CONFIDENCE = {"confirmed", "supported", "hypothesis"}
URGENCY = {"now", "soon", "later"}
HEALTH_DIMENSIONS = {
    "correctness-data-security",
    "product-completeness-onboarding",
    "ux-accessibility-content",
    "visual-responsive-design-system",
    "performance-cost-efficiency",
    "reliability-recovery-observability",
    "delivery-operability",
    "developer-experience-test-confidence",
}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def string_list(value):
    return isinstance(value, list) and all(nonempty(item) for item in value)


def add(blockers, code, path, message):
    blockers.append({"code": code, "path": path, "message": message})


def load_manifest(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": str(path), "message": str(exc)}]
    if not isinstance(value, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest must be a JSON object"}]
    return value, []


def validate(doc):
    blockers = []
    mode = doc.get("mode", "quality-sweep")
    if mode not in {"quality-sweep", "health-scan"}:
        add(blockers, "MODE_INVALID", "mode", "mode must be 'quality-sweep' or 'health-scan'")
        mode = "quality-sweep"
    health_mode = mode == "health-scan"

    for field in ("product_goal", "authorization_scope", "scope_boundary"):
        if not nonempty(doc.get(field)):
            add(blockers, "SWEEP_CONTEXT_INCOMPLETE", field, f"{field} must be a non-empty string")

    dimensions = doc.get("dimensions_inspected", [])
    if health_mode:
        if not string_list(dimensions) or not dimensions:
            add(blockers, "HEALTH_DIMENSIONS_REQUIRED", "dimensions_inspected", "health-scan mode must record one or more evidence-relevant dimensions actually inspected")
            dimensions = []
        else:
            for index, value in enumerate(dimensions):
                if value not in HEALTH_DIMENSIONS:
                    add(blockers, "HEALTH_DIMENSION_INVALID", f"dimensions_inspected[{index}]", f"unknown health dimension: {value}")
    elif dimensions and not string_list(dimensions):
        add(blockers, "HEALTH_DIMENSIONS_INVALID", "dimensions_inspected", "dimensions_inspected must be an array of non-empty strings when present")
        dimensions = []

    surfaces = doc.get("surfaces")
    if not isinstance(surfaces, list) or not surfaces:
        add(blockers, "SURFACE_INVENTORY_REQUIRED", "surfaces", "surfaces must contain at least one inspected product surface")
        surfaces = []

    surface_ids = set()
    ui_surface_count = 0
    for index, surface in enumerate(surfaces):
        path = f"surfaces[{index}]"
        if not isinstance(surface, dict):
            add(blockers, "SURFACE_OBJECT_REQUIRED", path, "surface must be an object")
            continue
        sid = surface.get("id")
        if not nonempty(sid):
            add(blockers, "SURFACE_ID_REQUIRED", f"{path}.id", "surface id is required")
        elif sid in surface_ids:
            add(blockers, "SURFACE_ID_DUPLICATE", f"{path}.id", f"duplicate surface id: {sid}")
        else:
            surface_ids.add(sid)
        for field in ("kind", "user_goal", "evidence"):
            if not nonempty(surface.get(field)):
                add(blockers, "SURFACE_EVIDENCE_INCOMPLETE", f"{path}.{field}", f"{field} must be non-empty")
        kind = surface.get("kind")
        if isinstance(kind, str) and kind.strip() in UI_KINDS:
            ui_surface_count += 1
            checks = surface.get("checks")
            if not isinstance(checks, dict):
                add(blockers, "UI_QUALITY_CHECKS_REQUIRED", f"{path}.checks", "UI surfaces require an explicit quality-check map")
                continue
            for field in UI_CHECKS:
                if not nonempty(checks.get(field)):
                    add(blockers, "UI_QUALITY_CHECK_INCOMPLETE", f"{path}.checks.{field}", f"UI quality sweep requires {field}; use an explicit not-applicable reason when necessary")

    candidates = doc.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        add(blockers, "CANDIDATES_REQUIRED", "candidates", "quality sweep must record at least one active, deferred, or evidence-backed no-change candidate")
        candidates = []

    candidate_by_id = {}
    active_ids = []
    allowed_actions = HEALTH_ACTIONS if health_mode else BASE_ACTIONS
    for index, candidate in enumerate(candidates):
        path = f"candidates[{index}]"
        if not isinstance(candidate, dict):
            add(blockers, "CANDIDATE_OBJECT_REQUIRED", path, "candidate must be an object")
            continue
        cid = candidate.get("id")
        if not nonempty(cid):
            add(blockers, "CANDIDATE_ID_REQUIRED", f"{path}.id", "candidate id is required")
        elif cid in candidate_by_id:
            add(blockers, "CANDIDATE_ID_DUPLICATE", f"{path}.id", f"duplicate candidate id: {cid}")
        else:
            candidate_by_id[cid] = candidate
        category = candidate.get("category")
        if category not in CATEGORIES:
            add(blockers, "CANDIDATE_CATEGORY_INVALID", f"{path}.category", f"category must be one of: {', '.join(sorted(CATEGORIES))}")
        action = candidate.get("action")
        if action not in allowed_actions:
            add(blockers, "CANDIDATE_ACTION_INVALID", f"{path}.action", f"action must be one of: {', '.join(sorted(allowed_actions))}")
        elif action in ACTIVE_ACTIONS and nonempty(cid):
            active_ids.append(cid)
        for field in ("evidence", "user_impact", "reason"):
            if not nonempty(candidate.get(field)):
                add(blockers, "CANDIDATE_EVIDENCE_INCOMPLETE", f"{path}.{field}", f"{field} must be non-empty")

        if health_mode:
            if candidate.get("confidence") not in CONFIDENCE:
                add(blockers, "CANDIDATE_CONFIDENCE_INVALID", f"{path}.confidence", f"confidence must be one of: {', '.join(sorted(CONFIDENCE))}")
            if candidate.get("urgency") not in URGENCY:
                add(blockers, "CANDIDATE_URGENCY_INVALID", f"{path}.urgency", f"urgency must be one of: {', '.join(sorted(URGENCY))}")
            if not nonempty(candidate.get("owner")):
                add(blockers, "CANDIDATE_OWNER_REQUIRED", f"{path}.owner", "health-scan candidates require the live owner/path or the next owner to prove")
            if not nonempty(candidate.get("falsifier")):
                add(blockers, "CANDIDATE_FALSIFIER_REQUIRED", f"{path}.falsifier", "health-scan candidates require the cheapest evidence that could disprove or characterize them")
            dependencies = candidate.get("dependencies", [])
            if not string_list(dependencies):
                add(blockers, "CANDIDATE_DEPENDENCIES_INVALID", f"{path}.dependencies", "dependencies must be an array of non-empty candidate/owner ids")

    if not nonempty(doc.get("prioritization_basis")):
        add(blockers, "PRIORITIZATION_BASIS_REQUIRED", "prioritization_basis", "state how consequence, evidence, dependency order, reversibility, and effort were weighed")

    selection = doc.get("selection")
    if not isinstance(selection, dict):
        add(blockers, "SELECTION_REQUIRED", "selection", "selection must explain the next product improvement decision")
        selection = {}
    next_id = selection.get("next_candidate_id")
    if active_ids:
        if not nonempty(next_id) or next_id not in candidate_by_id:
            add(blockers, "NEXT_CANDIDATE_INVALID", "selection.next_candidate_id", "next_candidate_id must name one recorded active candidate")
        elif candidate_by_id[next_id].get("action") not in ACTIVE_ACTIONS:
            add(blockers, "NEXT_CANDIDATE_NOT_ACTIVE", "selection.next_candidate_id", "selected next candidate must have an active action")
    else:
        if next_id != "none":
            add(blockers, "NO_CHANGE_SELECTION_REQUIRED", "selection.next_candidate_id", "when no active candidate exists, next_candidate_id must be 'none'")
        if not nonempty(selection.get("no_change_reason")):
            add(blockers, "NO_CHANGE_REASON_REQUIRED", "selection.no_change_reason", "evidence-backed no-change requires a reason")
    if not nonempty(selection.get("why_now")):
        add(blockers, "SELECTION_RATIONALE_REQUIRED", "selection.why_now", "selection must explain why this candidate outranks alternatives")

    validation = doc.get("validation")
    if not isinstance(validation, dict):
        add(blockers, "VALIDATION_REQUIRED", "validation", "validation must define focused and visible/real-boundary oracles")
        validation = {}
    for field in ("focused_oracle", "visible_or_boundary_oracle"):
        if not nonempty(validation.get(field)):
            add(blockers, "VALIDATION_ORACLE_REQUIRED", f"validation.{field}", f"{field} must be non-empty")

    if active_ids and nonempty(next_id) and next_id in candidate_by_id:
        selected = candidate_by_id[next_id]
        if selected.get("category") in {"experience", "accessibility", "content", "design-system", "onboarding"} and ui_surface_count == 0:
            add(blockers, "VISIBLE_SURFACE_EVIDENCE_REQUIRED", "surfaces", "selected user-experience work requires at least one inspected UI surface")

    return {
        "gate_passed": not blockers,
        "mode": mode,
        "counts": {
            "surfaces": len(surfaces),
            "ui_surfaces": ui_surface_count,
            "candidates": len(candidates),
            "active_candidates": len(active_ids),
            # Keep this compatibility field for existing consumers.
            "fix_candidates": sum(1 for candidate in candidates if isinstance(candidate, dict) and candidate.get("action") == "fix"),
            "dimensions_inspected": len(dimensions),
        },
        "blockers": blockers,
        "note": (
            "This gate validates the structure of an evidence-backed product sweep. It does not score project health, "
            "prove candidate truth, or require every health dimension on every run."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Validate an evidence-backed proactive product-quality sweep or health scan")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load_manifest(args.manifest)
    result = {
        "gate_passed": False,
        "mode": "unknown",
        "counts": {"surfaces": 0, "ui_surfaces": 0, "candidates": 0, "active_candidates": 0, "fix_candidates": 0, "dimensions_inspected": 0},
        "blockers": blockers,
        "note": "manifest could not be validated",
    }
    if doc is not None:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(
            f"mode={result['mode']} surfaces={result['counts']['surfaces']} ui_surfaces={result['counts']['ui_surfaces']} "
            f"candidates={result['counts']['candidates']} active={result['counts']['active_candidates']}"
        )
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
        print("note:", result["note"])
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
