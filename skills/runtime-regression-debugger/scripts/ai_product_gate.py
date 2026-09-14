#!/usr/bin/env python3
"""Validate machine-checkable AI execution invariants.

This gate deliberately does not score prose completeness, model quality, policy
compliance, privacy design, fallback quality, or rollout strategy. Those require
real product/repository evidence and semantic review.
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

    model = payload.get("model")
    if not isinstance(model, dict):
        add(blockers, "MODEL_REQUIRED", "model must bind provider, model_id, and config_version", "model")
        model = {}
    for key in ("provider", "model_id", "config_version"):
        if not nonempty(model.get(key)):
            add(blockers, "MODEL_IDENTITY_REQUIRED", f"model.{key} must be a non-empty string", f"model.{key}")

    tools = payload.get("tools", [])
    if not isinstance(tools, list):
        add(blockers, "TOOLS_INVALID", "tools must be an array", "tools")
        tools = []
    tool_ids = set()
    consequential_tools = 0
    for index, tool in enumerate(tools):
        path = f"tools[{index}]"
        if not isinstance(tool, dict):
            add(blockers, "TOOL_INVALID", "tool must be an object", path)
            continue
        tool_id = tool.get("id")
        if not nonempty(tool_id):
            add(blockers, "TOOL_ID_REQUIRED", "tool id must be a non-empty string", f"{path}.id")
        elif tool_id in tool_ids:
            add(blockers, "TOOL_ID_DUPLICATE", f"duplicate tool id {tool_id}", f"{path}.id")
        else:
            tool_ids.add(tool_id)

        consequential = tool.get("consequential", False)
        if not isinstance(consequential, bool):
            add(blockers, "TOOL_CONSEQUENTIAL_INVALID", "tool consequential must be boolean when provided", f"{path}.consequential")
        elif consequential:
            consequential_tools += 1
            if not nonempty(tool.get("confirmation_boundary")):
                add(blockers, "CONSEQUENTIAL_TOOL_CONFIRMATION_REQUIRED", "consequential tools require confirmation_boundary", f"{path}.confirmation_boundary")

    limits = payload.get("limits")
    if not isinstance(limits, dict):
        add(blockers, "LIMITS_REQUIRED", "limits must define bounded execution", "limits")
        limits = {}
    for key in ("timeout_ms", "max_steps", "max_tool_calls"):
        value = limits.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            add(blockers, "LIMIT_INVALID", f"limits.{key} must be a positive integer", f"limits.{key}")

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {"tools": len(tools), "consequential_tools": consequential_tools},
        "note": "Checks executable AI identity, tool identity/confirmation, and bounded execution only; substantive product quality requires real evidence.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
