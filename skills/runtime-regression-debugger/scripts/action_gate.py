#!/usr/bin/env python3
"""Conservative authorization gate for agentic engineering actions.

This is a planning aid only. It does not grant permission and never overrides
platform policy, repository policy, user authorization, or engineering judgment.

Examples:
  action_gate.py --action test
  action_gate.py --action push --authorized remote-write
  action_gate.py --action merge-pr --authorized remote-write --downstream release,production
  action_gate.py --action deploy --target production --authorized production
"""

from __future__ import annotations

import argparse
import json

BASE_REQUIREMENTS = {
    "read": set(),
    "inspect": set(),
    "test": set(),
    "build": set(),
    "modify-source": {"repository-write"},
    "create-branch": {"repository-write"},
    "commit": {"repository-write"},
    "push": {"remote-write"},
    "open-pr": {"remote-write"},
    "merge-pr": {"remote-write"},
    "modify-ci": {"remote-write"},
    "trigger-ci": {"ci-execution"},
    "deploy": set(),
    "database-migrate": {"data-migration"},
    "delete-data": {"destructive"},
    "rotate-credential": {"secrets"},
    "money-effect": {"money"},
    "publish-release": {"release"},
    "change-access": {"access-control"},
    "change-repository-visibility": {"access-control"},
}

TARGET_REQUIREMENTS = {
    "local": set(),
    "staging": {"staging"},
    "production": {"production"},
}

READ_ONLY_ACTIONS = {"read", "inspect", "test", "build"}

DOWNSTREAM_SCOPES = {
    "release", "production", "staging", "data-migration", "destructive",
    "secrets", "money", "access-control",
}


def split_csv(value: str) -> set[str]:
    return {item.strip() for item in value.split(",") if item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=sorted(BASE_REQUIREMENTS))
    parser.add_argument("--target", choices=sorted(TARGET_REQUIREMENTS), default="local")
    parser.add_argument(
        "--authorized",
        default="",
        help="Comma-separated scopes explicitly established from the user's request/context",
    )
    parser.add_argument(
        "--downstream",
        default="",
        help="Comma-separated predictable downstream consequence scopes triggered by this action",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    authorized = split_csv(args.authorized)
    downstream = split_csv(args.downstream)
    unknown_downstream = sorted(downstream - DOWNSTREAM_SCOPES)
    if unknown_downstream:
        parser.error("unknown downstream scopes: " + ",".join(unknown_downstream))
    required = set(BASE_REQUIREMENTS[args.action])
    required.update(downstream)

    # Read-only/local evidence gathering should not require an invented write scope.
    # Consequential actions inherit the target environment requirement.
    if args.action not in READ_ONLY_ACTIONS:
        required.update(TARGET_REQUIREMENTS[args.target])

    missing = sorted(required - authorized)
    if not required:
        status = "autonomous-read-or-validation"
    elif missing:
        status = "blocked-needs-explicit-authorization"
    else:
        status = "authorized-by-declared-scope"

    payload = {
        "action": args.action,
        "target": args.target,
        "required_scopes": sorted(required),
        "declared_authorized_scopes": sorted(authorized),
        "declared_downstream_consequences": sorted(downstream),
        "missing_scopes": missing,
        "status": status,
        "allowed_by_this_tool": not missing,
        "note": (
            "Planning aid only. A PASS does not create permission; platform/user/repository policy "
            "and current engineering evidence still govern whether the action should be executed."
        ),
    }

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Agent action gate")
        print("action:", payload["action"])
        print("target:", payload["target"])
        print("required scopes:", ", ".join(payload["required_scopes"]) or "none")
        print("declared authorized scopes:", ", ".join(payload["declared_authorized_scopes"]) or "none")
        print("downstream consequences:", ", ".join(payload["declared_downstream_consequences"]) or "none")
        print("missing scopes:", ", ".join(payload["missing_scopes"]) or "none")
        print("status:", payload["status"])
        print("note:", payload["note"])
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
