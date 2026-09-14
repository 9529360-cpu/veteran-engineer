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
CATEGORIES = {
    "correctness",
    "experience",
    "accessibility",
    "content",
    "performance",
    "reliability",
    "maintainability",
    "design-system",
}
ACTIONS = {"fix", "defer", "no-change"}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


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

    for field in ("product_goal", "authorization_scope", "scope_boundary"):
        if not nonempty(doc.get(field)):
            add(blockers, "SWEEP_CONTEXT_INCOMPLETE", field, f"{field} must be a non-empty string")

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
        add(blockers, "CANDIDATES_REQUIRED", "candidates", "quality sweep must record at least one fix, defer, or evidence-backed no-change candidate")
        candidates = []

    candidate_by_id = {}
    fix_ids = []
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
        if action not in ACTIONS:
            add(blockers, "CANDIDATE_ACTION_INVALID", f"{path}.action", f"action must be one of: {', '.join(sorted(ACTIONS))}")
        elif action == "fix" and nonempty(cid):
            fix_ids.append(cid)
        for field in ("evidence", "user_impact", "reason"):
            if not nonempty(candidate.get(field)):
                add(blockers, "CANDIDATE_EVIDENCE_INCOMPLETE", f"{path}.{field}", f"{field} must be non-empty")

    if not nonempty(doc.get("prioritization_basis")):
        add(blockers, "PRIORITIZATION_BASIS_REQUIRED", "prioritization_basis", "state how user impact, evidence, reversibility, and effort were weighed")

    selection = doc.get("selection")
    if not isinstance(selection, dict):
        add(blockers, "SELECTION_REQUIRED", "selection", "selection must explain the next product improvement decision")
        selection = {}
    next_id = selection.get("next_candidate_id")
    if fix_ids:
        if not nonempty(next_id) or next_id not in candidate_by_id:
            add(blockers, "NEXT_CANDIDATE_INVALID", "selection.next_candidate_id", "next_candidate_id must name one recorded candidate when fix candidates exist")
        elif candidate_by_id[next_id].get("action") != "fix":
            add(blockers, "NEXT_CANDIDATE_NOT_FIX", "selection.next_candidate_id", "selected next candidate must have action=fix")
    else:
        if next_id != "none":
            add(blockers, "NO_CHANGE_SELECTION_REQUIRED", "selection.next_candidate_id", "when no fix candidate exists, next_candidate_id must be 'none'")
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

    if fix_ids and nonempty(next_id) and next_id in candidate_by_id:
        selected = candidate_by_id[next_id]
        if selected.get("category") in {"experience", "accessibility", "content", "design-system"} and ui_surface_count == 0:
            add(blockers, "VISIBLE_SURFACE_EVIDENCE_REQUIRED", "surfaces", "selected user-experience work requires at least one inspected UI surface")

    return {
        "gate_passed": not blockers,
        "counts": {
            "surfaces": len(surfaces),
            "ui_surfaces": ui_surface_count,
            "candidates": len(candidates),
            "fix_candidates": len(fix_ids),
        },
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate an evidence-backed proactive product-quality sweep")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load_manifest(args.manifest)
    result = {"gate_passed": False, "counts": {"surfaces": 0, "ui_surfaces": 0, "candidates": 0, "fix_candidates": 0}, "blockers": blockers}
    if doc is not None:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(
            f"surfaces={result['counts']['surfaces']} ui_surfaces={result['counts']['ui_surfaces']} "
            f"candidates={result['counts']['candidates']} fixes={result['counts']['fix_candidates']}"
        )
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
