#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PLATFORMS = {"web", "desktop", "mobile"}
CHANGE_DIMENSIONS = {"layout", "visual_style", "interaction", "functionality", "workflow", "responsive", "accessibility", "content"}
CASE_RESULTS = {"pass", "fail", "deferred"}
CLAIMS = {
    "implemented": 1,
    "focused-validated": 2,
    "rendered-validated": 3,
    "visual-regression-validated": 4,
    "end-to-end-validated": 5,
}
ACCEPTANCE_FIELDS = (
    "visual_hierarchy",
    "layout_density",
    "typography_color",
    "component_consistency",
    "interaction_feedback",
    "responsive_behavior",
    "accessibility_presentation",
    "copy_content",
)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def add(blockers, code, path, message):
    blockers.append({"code": code, "path": path, "message": message})


def object_section(doc, key, blockers):
    value = doc.get(key)
    if not isinstance(value, dict):
        add(blockers, "SECTION_OBJECT_REQUIRED", key, f"{key} must be an object")
        return {}
    return value


def string_list(value, path, blockers):
    if not isinstance(value, list) or not value or not all(nonempty(item) for item in value):
        add(blockers, "NONEMPTY_STRING_LIST_REQUIRED", path, f"{path} must be a non-empty list of non-empty strings")
        return []
    normalized = [item.strip() for item in value]
    if len(set(normalized)) != len(normalized):
        add(blockers, "DUPLICATE_COVERAGE_VALUE", path, f"{path} must not contain duplicate values")
    return normalized


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

    surface = object_section(doc, "surface", blockers)
    for field in ("id", "user_goal", "source_build", "design_system_or_baseline"):
        if not nonempty(surface.get(field)):
            add(blockers, "SURFACE_FIELD_REQUIRED", f"surface.{field}", f"surface.{field} must be a non-empty string")
    if surface.get("platform") not in PLATFORMS:
        add(blockers, "SURFACE_PLATFORM_INVALID", "surface.platform", f"platform must be one of: {', '.join(sorted(PLATFORMS))}")

    evidence = object_section(doc, "evidence", blockers)
    for field in ("data_or_fixture", "render_tool_or_boundary"):
        if not nonempty(evidence.get(field)):
            add(blockers, "EVIDENCE_FIELD_REQUIRED", f"evidence.{field}", f"evidence.{field} must be a non-empty string")
    rendered = evidence.get("rendered")
    if not isinstance(rendered, bool):
        add(blockers, "RENDERED_BOOLEAN_REQUIRED", "evidence.rendered", "evidence.rendered must be a JSON boolean")
        rendered = False
    visual_regression = evidence.get("visual_regression")
    if not isinstance(visual_regression, bool):
        add(blockers, "VISUAL_REGRESSION_BOOLEAN_REQUIRED", "evidence.visual_regression", "evidence.visual_regression must be a JSON boolean")
        visual_regression = False
    if rendered:
        for field in ("baseline", "result"):
            if not nonempty(evidence.get(field)):
                add(blockers, "RENDER_EVIDENCE_REQUIRED", f"evidence.{field}", f"rendered validation requires {field}")
    elif not nonempty(evidence.get("limitation")):
        add(blockers, "RENDER_LIMITATION_REQUIRED", "evidence.limitation", "state why rendered evidence is unavailable")
    if visual_regression and not nonempty(evidence.get("baseline_review")):
        add(blockers, "BASELINE_REVIEW_REQUIRED", "evidence.baseline_review", "visual regression evidence requires an explicit baseline review")

    coverage = object_section(doc, "coverage", blockers)
    dimensions = {
        "viewport": string_list(coverage.get("viewports"), "coverage.viewports", blockers),
        "state": string_list(coverage.get("states"), "coverage.states", blockers),
        "content_case": string_list(coverage.get("content_cases"), "coverage.content_cases", blockers),
        "input_mode": string_list(coverage.get("input_modes"), "coverage.input_modes", blockers),
    }

    matrix = doc.get("matrix")
    if not isinstance(matrix, list) or not matrix:
        add(blockers, "EVIDENCE_MATRIX_REQUIRED", "matrix", "matrix must contain one or more visual-QA cases")
        matrix = []
    seen = {key: set() for key in dimensions}
    for index, case in enumerate(matrix):
        path = f"matrix[{index}]"
        if not isinstance(case, dict):
            add(blockers, "MATRIX_CASE_OBJECT_REQUIRED", path, "matrix case must be an object")
            continue
        for key, allowed in dimensions.items():
            value = case.get(key)
            if not nonempty(value):
                add(blockers, "MATRIX_DIMENSION_REQUIRED", f"{path}.{key}", f"{key} must be a non-empty string")
            elif allowed and value not in allowed:
                add(blockers, "MATRIX_DIMENSION_UNDECLARED", f"{path}.{key}", f"{value} is not declared in coverage")
            else:
                seen[key].add(value)
        for field in ("evidence", "finding"):
            if not nonempty(case.get(field)):
                add(blockers, "MATRIX_EVIDENCE_REQUIRED", f"{path}.{field}", f"{field} must be non-empty")
        result = case.get("result")
        if result not in CASE_RESULTS:
            add(blockers, "MATRIX_RESULT_INVALID", f"{path}.result", f"result must be one of: {', '.join(sorted(CASE_RESULTS))}")
        elif result == "fail":
            add(blockers, "UNRESOLVED_VISUAL_FAILURE", path, "final visual-QA matrix must not contain unresolved fail cases")
        elif result == "deferred" and not nonempty(case.get("disposition")):
            add(blockers, "DEFERRED_DISPOSITION_REQUIRED", f"{path}.disposition", "deferred cases require an explicit disposition")

    for key, declared in dimensions.items():
        missing = sorted(set(declared) - seen[key])
        if missing:
            add(blockers, "COVERAGE_NOT_EVIDENCED", f"coverage.{key}", f"declared values missing from matrix: {', '.join(missing)}")

    change_scope = doc.get("change_scope")
    if change_scope is not None:
        if not isinstance(change_scope, dict):
            add(blockers, "CHANGE_SCOPE_OBJECT_REQUIRED", "change_scope", "change_scope must be an object when provided")
        else:
            requested = change_scope.get("requested")
            delivered = change_scope.get("delivered")
            evidence_by_dimension = change_scope.get("evidence_by_dimension")
            if not isinstance(requested, list) or not requested or not all(isinstance(item, str) and item in CHANGE_DIMENSIONS for item in requested):
                add(blockers, "REQUESTED_CHANGE_DIMENSIONS_INVALID", "change_scope.requested", f"requested must be a non-empty list from: {', '.join(sorted(CHANGE_DIMENSIONS))}")
                requested = []
            if not isinstance(delivered, list) or not delivered or not all(isinstance(item, str) and item in CHANGE_DIMENSIONS for item in delivered):
                add(blockers, "DELIVERED_CHANGE_DIMENSIONS_INVALID", "change_scope.delivered", f"delivered must be a non-empty list from: {', '.join(sorted(CHANGE_DIMENSIONS))}")
                delivered = []
            if len(set(requested)) != len(requested):
                add(blockers, "REQUESTED_CHANGE_DIMENSIONS_DUPLICATE", "change_scope.requested", "requested dimensions must be unique")
            if len(set(delivered)) != len(delivered):
                add(blockers, "DELIVERED_CHANGE_DIMENSIONS_DUPLICATE", "change_scope.delivered", "delivered dimensions must be unique")
            missing_dimensions = sorted(set(requested) - set(delivered))
            if missing_dimensions:
                add(blockers, "REQUESTED_CHANGE_DIMENSION_UNDELIVERED", "change_scope.delivered", f"requested dimensions missing from delivered: {', '.join(missing_dimensions)}")
            if not isinstance(evidence_by_dimension, dict):
                add(blockers, "CHANGE_DIMENSION_EVIDENCE_REQUIRED", "change_scope.evidence_by_dimension", "evidence_by_dimension must be an object")
                evidence_by_dimension = {}
            for dimension in requested:
                if not nonempty(evidence_by_dimension.get(dimension)):
                    add(blockers, "CHANGE_DIMENSION_EVIDENCE_MISSING", f"change_scope.evidence_by_dimension.{dimension}", f"requested dimension {dimension} requires evidence")

    acceptance = object_section(doc, "acceptance", blockers)
    for field in ACCEPTANCE_FIELDS:
        if not nonempty(acceptance.get(field)):
            add(blockers, "ACCEPTANCE_FIELD_REQUIRED", f"acceptance.{field}", f"acceptance.{field} must be a non-empty string")

    regression = object_section(doc, "regression", blockers)
    for field in ("focused_oracle", "visible_oracle", "real_boundary_oracle"):
        if not nonempty(regression.get(field)):
            add(blockers, "REGRESSION_ORACLE_REQUIRED", f"regression.{field}", f"regression.{field} must be a non-empty string")

    claim = doc.get("completion_claim")
    if claim not in CLAIMS:
        add(blockers, "COMPLETION_CLAIM_INVALID", "completion_claim", f"completion_claim must be one of: {', '.join(CLAIMS)}")
    else:
        if not rendered and CLAIMS[claim] >= CLAIMS["rendered-validated"]:
            add(blockers, "RENDERED_CLAIM_UNPROVEN", "completion_claim", "rendered evidence is required for rendered/end-to-end completion claims")
        if claim == "visual-regression-validated" and not visual_regression:
            add(blockers, "VISUAL_REGRESSION_CLAIM_UNPROVEN", "completion_claim", "visual_regression must be true for a visual-regression-validated claim")

    if not nonempty(doc.get("limitations")):
        add(blockers, "LIMITATIONS_REQUIRED", "limitations", "limitations must be explicit; use 'none known' when appropriate")

    return {
        "gate_passed": not blockers,
        "surface_id": surface.get("id") if nonempty(surface.get("id")) else None,
        "rendered": rendered,
        "visual_regression": visual_regression,
        "matrix_cases": len(matrix),
        "completion_claim": claim if claim in CLAIMS else None,
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate a visual UI quality-assurance evidence matrix")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load_manifest(args.manifest)
    if doc is None:
        result = {"gate_passed": False, "surface_id": None, "rendered": False, "visual_regression": False, "matrix_cases": 0, "completion_claim": None, "blockers": blockers}
    else:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"surface={result['surface_id']} rendered={result['rendered']} cases={result['matrix_cases']} claim={result['completion_claim']}")
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
