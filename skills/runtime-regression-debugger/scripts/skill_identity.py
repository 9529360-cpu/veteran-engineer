#!/usr/bin/env python3
"""Compute a deterministic content identity for an Agent Skill directory.

The digest binds relative file paths and bytes while ignoring transient cache/build
artifacts. It intentionally ignores mtimes, permissions, and absolute paths so the
same Skill bytes copied to another installation path keep the same identity.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

IGNORED_DIRS = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
}
IGNORED_FILES = {".DS_Store"}


def included_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        rel = path.relative_to(root)
        if any(part in IGNORED_DIRS for part in rel.parts):
            continue
        if path.name in IGNORED_FILES or not path.is_file() or path.is_symlink():
            continue
        files.append(path)
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())


def compute_identity(root: Path) -> tuple[str, int, int]:
    h = hashlib.sha256()
    count = 0
    byte_count = 0
    for path in included_files(root):
        rel = path.relative_to(root).as_posix().encode("utf-8")
        data = path.read_bytes()
        h.update(len(rel).to_bytes(8, "big"))
        h.update(rel)
        h.update(len(data).to_bytes(8, "big"))
        h.update(data)
        count += 1
        byte_count += len(data)
    return h.hexdigest(), count, byte_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_root", nargs="?", default=".")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = Path(args.skill_root).resolve()
    if not (root / "SKILL.md").is_file():
        parser.error(f"not a Skill root (missing SKILL.md): {root}")

    digest, count, byte_count = compute_identity(root)
    payload = {
        "algorithm": "sha256",
        "content_hash": digest,
        "file_count": count,
        "byte_count": byte_count,
    }
    if args.json:
        print(json.dumps(payload, sort_keys=True))
    else:
        print(f"sha256:{digest} files={count} bytes={byte_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
