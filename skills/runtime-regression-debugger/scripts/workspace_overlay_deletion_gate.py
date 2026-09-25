#!/usr/bin/env python3
"""Fail when Workspace-shipped Skill deletions are not overlay-safe."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from export_plugin_bundle import WORKSPACE_OVERLAY_TOMBSTONES  # noqa: E402

RUNTIME_PREFIX = PurePosixPath("skills/runtime-regression-debugger")
FRONTEND_PREFIX = PurePosixPath("skills/frontend-design-builder")
RUNTIME_STARTER_PREFIX = RUNTIME_PREFIX / "assets" / "plugin-runtime-starter"


def _is_under(path: PurePosixPath, prefix: PurePosixPath) -> bool:
    try:
        path.relative_to(prefix)
        return True
    except ValueError:
        return False


def is_workspace_shipped_source(path: str) -> bool:
    rel = PurePosixPath(path)
    if _is_under(rel, RUNTIME_STARTER_PREFIX):
        return False
    return _is_under(rel, RUNTIME_PREFIX) or _is_under(rel, FRONTEND_PREFIX)


def classify_deleted_paths(paths: list[str]) -> dict:
    shipped = sorted({path for path in paths if is_workspace_shipped_source(path)})
    identity_deletions = [
        path for path in shipped
        if PurePosixPath(path).name == "SKILL.md"
    ]
    tombstoned = sorted(path for path in shipped if path in WORKSPACE_OVERLAY_TOMBSTONES)
    missing_tombstones = sorted(
        path for path in shipped
        if path not in WORKSPACE_OVERLAY_TOMBSTONES and path not in identity_deletions
    )
    return {
        "workspace_shipped_deletions": shipped,
        "identity_deletions": identity_deletions,
        "tombstoned_deletions": tombstoned,
        "missing_tombstones": missing_tombstones,
        "status": "PASS" if not identity_deletions and not missing_tombstones else "FAIL",
    }


def git_deleted_paths(repo_root: Path, base: str, head: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--diff-filter=D", "--name-only", base, head, "--"],
        cwd=repo_root,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "git diff failed")
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo_root")
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    payload = classify_deleted_paths(git_deleted_paths(root, args.base, args.head))
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(payload["status"])
        for path in payload["identity_deletions"]:
            print(f"blocked Skill identity deletion: {path}")
        for path in payload["missing_tombstones"]:
            print(f"missing Workspace overlay tombstone: {path}")
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
