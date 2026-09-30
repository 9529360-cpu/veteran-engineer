#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCHEMA = "veteran-repository-continuation-v1"
RUNG_ORDER = [
    "implemented",
    "focused-validated",
    "PR-ready",
    "exact-head-green",
    "merged",
    "main-validated",
    "released/deployed",
    "public-verified",
    "consumer/workspace-synced",
]
RUNG_SET = set(RUNG_ORDER)
USER_INTENTS = {"status", "continue-development", "release", "stop"}
CLAIM_KINDS = {"status-only", "continue", "stop", "done"}
NEXT_ACTION_KINDS = {
    "collect-main-validation",
    "create-branch",
    "update-pr",
    "open-pr",
    "release",
    "stop",
}


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def blocker(items: list[dict[str, str]], code: str, path: str, message: str) -> None:
    items.append({"code": code, "path": path, "message": message})


def validate(payload: dict[str, Any]) -> dict[str, Any]:
    blockers: list[dict[str, str]] = []

    if payload.get("schema") != SCHEMA:
        blocker(blockers, "SCHEMA_INVALID", "schema", f"schema must be {SCHEMA}")

    user_intent = payload.get("user_intent")
    if user_intent not in USER_INTENTS:
        blocker(
            blockers,
            "USER_INTENT_INVALID",
            "user_intent",
            f"user_intent must be one of: {', '.join(sorted(USER_INTENTS))}",
        )

    repository = payload.get("repository")
    if not isinstance(repository, dict):
        blocker(blockers, "REPOSITORY_OBJECT_REQUIRED", "repository", "repository must be an object")
        repository = {}
    for key in ("full_name", "default_branch", "default_head"):
        if not nonempty(repository.get(key)):
            blocker(blockers, "REPOSITORY_IDENTITY_REQUIRED", f"repository.{key}", f"{key} must be non-empty")
    default_head_refreshed = repository.get("default_head_refreshed")
    if default_head_refreshed is not True:
        blocker(
            blockers,
            "DEFAULT_HEAD_REFRESH_REQUIRED",
            "repository.default_head_refreshed",
            "refresh the default-branch head before selecting the next repository slice",
        )
    main_validated = repository.get("main_validated") is True

    previous = payload.get("previous_slice")
    if not isinstance(previous, dict):
        blocker(blockers, "PREVIOUS_SLICE_OBJECT_REQUIRED", "previous_slice", "previous_slice must be an object")
        previous = {}
    previous_rung = previous.get("strongest_rung")
    if previous_rung not in RUNG_SET:
        blocker(blockers, "PREVIOUS_RUNG_INVALID", "previous_slice.strongest_rung", "previous_slice strongest_rung is not in the repository closure ladder")

    actions = payload.get("material_next_actions")
    if actions is None:
        actions = []
    if not isinstance(actions, list):
        blocker(blockers, "NEXT_ACTIONS_ARRAY_REQUIRED", "material_next_actions", "material_next_actions must be an array")
        actions = []
    valid_actions: list[dict[str, Any]] = []
    for index, action in enumerate(actions):
        path = f"material_next_actions[{index}]"
        if not isinstance(action, dict):
            blocker(blockers, "NEXT_ACTION_OBJECT_REQUIRED", path, "each material next action must be an object")
            continue
        if not nonempty(action.get("id")):
            blocker(blockers, "NEXT_ACTION_ID_REQUIRED", f"{path}.id", "next action id must be non-empty")
        if not nonempty(action.get("description")):
            blocker(blockers, "NEXT_ACTION_DESCRIPTION_REQUIRED", f"{path}.description", "next action needs a concrete repository-local description")
        if action.get("material") is not True:
            blocker(blockers, "NEXT_ACTION_MATERIAL_REQUIRED", f"{path}.material", "next action must be marked material before it can justify continuation")
        if action.get("reversible") is not True and action.get("authorization") != "explicit":
            blocker(
                blockers,
                "NEXT_ACTION_AUTHORIZATION_REQUIRED",
                f"{path}.authorization",
                "non-reversible next actions need explicit authorization",
            )
        valid_actions.append(action)

    claim = payload.get("claim")
    if not isinstance(claim, dict):
        blocker(blockers, "CLAIM_OBJECT_REQUIRED", "claim", "claim must be an object")
        claim = {}
    claim_kind = claim.get("kind")
    if claim_kind not in CLAIM_KINDS:
        blocker(blockers, "CLAIM_KIND_INVALID", "claim.kind", f"claim kind must be one of: {', '.join(sorted(CLAIM_KINDS))}")
    claim_rung = claim.get("strongest_rung")
    if claim_rung not in RUNG_SET:
        blocker(blockers, "CLAIM_RUNG_INVALID", "claim.strongest_rung", "claim strongest_rung is not in the repository closure ladder")

    proposed = payload.get("proposed_next_action")
    if proposed is None:
        proposed = {}
    if not isinstance(proposed, dict):
        blocker(blockers, "PROPOSED_ACTION_OBJECT_REQUIRED", "proposed_next_action", "proposed_next_action must be an object")
        proposed = {}
    proposed_kind = proposed.get("kind")
    if proposed_kind not in NEXT_ACTION_KINDS:
        blocker(
            blockers,
            "PROPOSED_ACTION_KIND_INVALID",
            "proposed_next_action.kind",
            f"proposed action kind must be one of: {', '.join(sorted(NEXT_ACTION_KINDS))}",
        )

    if user_intent == "continue-development":
        if valid_actions and claim_kind == "status-only":
            blocker(
                blockers,
                "STATUS_ONLY_WHILE_NEXT_ACTION_EXISTS",
                "claim.kind",
                "a continuation request with material safe work must not stop at a status-only report",
            )
        if valid_actions and proposed_kind in (None, "stop"):
            blocker(
                blockers,
                "PROPOSED_CONTINUATION_ACTION_REQUIRED",
                "proposed_next_action.kind",
                "choose the next foreground repository action or record a stop reason",
            )
        if not valid_actions and not nonempty(payload.get("stop_reason")):
            blocker(
                blockers,
                "CONTINUATION_FRONTIER_REQUIRED",
                "stop_reason",
                "when no material next action is available, record why continuation must stop",
            )
        if previous_rung == "merged" and not main_validated and proposed_kind != "collect-main-validation":
            blocker(
                blockers,
                "MAIN_VALIDATION_REQUIRED_BEFORE_NEXT_SLICE",
                "proposed_next_action.kind",
                "after merge, collect refreshed main validation before starting a new implementation slice",
            )
        if proposed_kind == "create-branch":
            base_sha = proposed.get("base_sha")
            if not nonempty(base_sha):
                blocker(blockers, "BRANCH_BASE_SHA_REQUIRED", "proposed_next_action.base_sha", "new repository slices need an explicit branch base SHA")
            elif base_sha != repository.get("default_head"):
                blocker(
                    blockers,
                    "NEXT_SLICE_BASE_STALE",
                    "proposed_next_action.base_sha",
                    "new continuation branches must start from the refreshed default-branch head",
                )

    return {
        "schema": SCHEMA,
        "status": "fail" if blockers else "pass",
        "blockers": blockers,
        "summary": {
            "user_intent": user_intent,
            "previous_rung": previous_rung,
            "claim_kind": claim_kind,
            "claim_rung": claim_rung,
            "proposed_next_action": proposed_kind,
            "material_next_actions": len(valid_actions),
        },
    }


def load(path: str) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": path, "message": str(exc)}]
    if not isinstance(payload, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest root must be an object"}]
    return payload, []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate foreground continuation after repository closure.")
    parser.add_argument("manifest", help="Path to a veteran-repository-continuation-v1 JSON manifest")
    args = parser.parse_args(argv)

    payload, errors = load(args.manifest)
    if errors:
        result = {"schema": SCHEMA, "status": "fail", "blockers": errors}
    else:
        assert payload is not None
        result = validate(payload)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if result["blockers"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
