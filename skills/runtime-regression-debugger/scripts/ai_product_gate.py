#!/usr/bin/env python3
"""Validate an AI/LLM product engineering contract.

This checks engineering completeness, not model quality or policy compliance by itself.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def add(blockers, code, message, path=None):
    item = {"code": code, "message": message}
    if path:
        item["path"] = path
    blockers.append(item)


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

    feature = payload.get("feature")
    if not isinstance(feature, dict):
        add(blockers, "FEATURE_REQUIRED", "feature must be an object")
        feature = {}
    for key in ("user_outcome", "model_step", "visible_result"):
        if not nonempty(feature.get(key)):
            add(blockers, "FEATURE_FIELD_REQUIRED", f"feature.{key} must be non-empty", f"feature.{key}")

    authority = payload.get("authority")
    if not isinstance(authority, dict):
        add(blockers, "AUTHORITY_REQUIRED", "authority must be an object")
        authority = {}
    for key in ("deterministic_owner", "authorization_boundary", "validation_before_effect"):
        if not nonempty(authority.get(key)):
            add(blockers, "AUTHORITY_FIELD_REQUIRED", f"authority.{key} must be non-empty", f"authority.{key}")

    model = payload.get("model")
    if not isinstance(model, dict):
        add(blockers, "MODEL_REQUIRED", "model must be an object")
        model = {}
    for key in ("provider", "model_id", "config_version"):
        if not nonempty(model.get(key)):
            add(blockers, "MODEL_FIELD_REQUIRED", f"model.{key} must be non-empty", f"model.{key}")

    context = payload.get("context")
    if not isinstance(context, dict):
        add(blockers, "CONTEXT_REQUIRED", "context must be an object")
        context = {}
    for key in ("sources", "trust_boundary", "privacy_policy"):
        value = context.get(key)
        if key == "sources":
            if not isinstance(value, list) or not value or not all(nonempty(item) for item in value):
                add(blockers, "CONTEXT_SOURCES_REQUIRED", "context.sources must be a non-empty array of strings", "context.sources")
        elif not nonempty(value):
            add(blockers, "CONTEXT_FIELD_REQUIRED", f"context.{key} must be non-empty", f"context.{key}")

    output = payload.get("output")
    if not isinstance(output, dict):
        add(blockers, "OUTPUT_REQUIRED", "output must be an object")
        output = {}
    if not nonempty(output.get("contract")):
        add(blockers, "OUTPUT_CONTRACT_REQUIRED", "output.contract must be non-empty", "output.contract")
    if not nonempty(output.get("semantic_validation")):
        add(blockers, "OUTPUT_VALIDATION_REQUIRED", "output.semantic_validation must be non-empty", "output.semantic_validation")

    tools = payload.get("tools", [])
    if not isinstance(tools, list):
        add(blockers, "TOOLS_INVALID", "tools must be an array")
        tools = []
    tool_ids = set()
    for index, tool in enumerate(tools):
        path = f"tools[{index}]"
        if not isinstance(tool, dict):
            add(blockers, "TOOL_INVALID", "tool must be an object", path)
            continue
        tid = tool.get("id")
        if not nonempty(tid):
            add(blockers, "TOOL_ID_REQUIRED", "tool id must be non-empty", f"{path}.id")
        elif tid in tool_ids:
            add(blockers, "TOOL_ID_DUPLICATE", f"duplicate tool id {tid}", f"{path}.id")
        else:
            tool_ids.add(tid)
        for key in ("purpose", "authorization", "side_effect", "retry_policy"):
            if not nonempty(tool.get(key)):
                add(blockers, "TOOL_FIELD_REQUIRED", f"{path}.{key} must be non-empty", f"{path}.{key}")
        if tool.get("consequential") is True and not nonempty(tool.get("confirmation_boundary")):
            add(blockers, "CONSEQUENTIAL_TOOL_CONFIRMATION_REQUIRED", "consequential tools require confirmation_boundary", f"{path}.confirmation_boundary")

    limits = payload.get("limits")
    if not isinstance(limits, dict):
        add(blockers, "LIMITS_REQUIRED", "limits must be an object")
        limits = {}
    for key in ("timeout_ms", "max_steps", "max_tool_calls"):
        value = limits.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            add(blockers, "LIMIT_INVALID", f"limits.{key} must be a positive integer", f"limits.{key}")
    if not nonempty(limits.get("cost_policy")):
        add(blockers, "COST_POLICY_REQUIRED", "limits.cost_policy must be non-empty", "limits.cost_policy")

    failures = payload.get("failure_fallback")
    if not isinstance(failures, list) or not failures:
        add(blockers, "FAILURE_FALLBACK_REQUIRED", "at least one failure/fallback row is required")
        failures = []
    for index, row in enumerate(failures):
        path = f"failure_fallback[{index}]"
        if not isinstance(row, dict) or not nonempty(row.get("failure")) or not nonempty(row.get("fallback")) or not nonempty(row.get("visible_state")):
            add(blockers, "FAILURE_FALLBACK_INVALID", "failure row requires failure, fallback, and visible_state", path)

    evals = payload.get("evaluation")
    if not isinstance(evals, dict):
        add(blockers, "EVALUATION_REQUIRED", "evaluation must be an object")
        evals = {}
    cases = evals.get("case_classes")
    if not isinstance(cases, list) or not cases or not all(nonempty(item) for item in cases):
        add(blockers, "EVAL_CASES_REQUIRED", "evaluation.case_classes must be a non-empty array of strings", "evaluation.case_classes")
    for key in ("oracle", "release_threshold", "regression_policy"):
        if not nonempty(evals.get(key)):
            add(blockers, "EVALUATION_FIELD_REQUIRED", f"evaluation.{key} must be non-empty", f"evaluation.{key}")

    rollout = payload.get("rollout")
    if not isinstance(rollout, dict):
        add(blockers, "ROLLOUT_REQUIRED", "rollout must be an object")
        rollout = {}
    for key in ("strategy", "rollback", "identity_binding"):
        if not nonempty(rollout.get(key)):
            add(blockers, "ROLLOUT_FIELD_REQUIRED", f"rollout.{key} must be non-empty", f"rollout.{key}")

    privacy = payload.get("privacy")
    if not isinstance(privacy, dict):
        add(blockers, "PRIVACY_REQUIRED", "privacy must be an object")
        privacy = {}
    for key in ("data_minimization", "retention", "trace_redaction"):
        if not nonempty(privacy.get(key)):
            add(blockers, "PRIVACY_FIELD_REQUIRED", f"privacy.{key} must be non-empty", f"privacy.{key}")

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {"tools": len(tools), "failure_fallback": len(failures)},
        "note": "This gate checks AI product engineering completeness, not substantive model quality, safety, or causal product impact.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
