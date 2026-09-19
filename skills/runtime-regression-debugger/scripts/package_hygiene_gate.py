#!/usr/bin/env python3
"""Fail on transient/local artifacts that should never ship in a Skill source tree or ZIP."""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path, PurePosixPath

BAD_DIRS = {'.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache', '.coverage_cache', '.idea', '.vscode'}
BAD_NAMES = {'.DS_Store', 'Thumbs.db', '.coverage'}
BAD_SUFFIXES = {'.pyc', '.pyo', '.swp', '.swo', '.tmp'}


def is_bad(parts: tuple[str, ...], name: str, suffix: str) -> bool:
    return (
        any(part in BAD_DIRS for part in parts)
        or name in BAD_NAMES
        or suffix in BAD_SUFFIXES
        or name.endswith('~')
    )


def scan_directory(root: Path) -> list[str]:
    bad: list[str] = []
    for p in root.rglob('*'):
        rel = p.relative_to(root).as_posix()
        if is_bad(tuple(p.relative_to(root).parts), p.name, p.suffix):
            bad.append(rel)
    return sorted(set(bad))


def parse_frontmatter_name(text: str) -> str | None:
    match = re.match(r"\A---\s*\n(.*?)\n---(?:\s*\n|\Z)", text, flags=re.DOTALL)
    if not match:
        return None
    for line in match.group(1).splitlines():
        if line.lstrip().startswith("name:"):
            value = line.split(":", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            return value or None
    return None


def scan_zip(path: Path) -> tuple[list[str], list[str], list[str]]:
    bad: list[str] = []
    unsafe_paths: list[str] = []
    identity_errors: list[str] = []
    with zipfile.ZipFile(path) as zf:
        top_levels: set[str] = set()
        entrypoints: list[str] = []
        for info in zf.infolist():
            raw = info.filename
            p = PurePosixPath(raw)
            parts = tuple(part for part in p.parts if part not in ('', '/'))
            if raw.startswith('/') or '..' in parts:
                unsafe_paths.append(raw)
            if not parts:
                continue
            top_levels.add(parts[0])
            if len(parts) == 2 and parts[1] == 'SKILL.md' and not info.is_dir():
                entrypoints.append(raw)
            name = parts[-1]
            suffix = PurePosixPath(name).suffix
            if is_bad(parts, name, suffix):
                bad.append(raw)

        if len(top_levels) != 1:
            identity_errors.append(
                'archive must contain exactly one top-level Skill directory; found: '
                + ', '.join(sorted(top_levels))
            )
        if len(entrypoints) != 1:
            identity_errors.append(
                f'archive must contain exactly one top-level SKILL.md entrypoint; found {len(entrypoints)}'
            )
        elif len(top_levels) == 1:
            entrypoint = entrypoints[0]
            try:
                skill_text = zf.read(entrypoint).decode('utf-8')
            except UnicodeDecodeError:
                identity_errors.append('packaged SKILL.md must be UTF-8 text')
            else:
                skill_name = parse_frontmatter_name(skill_text)
                if not skill_name:
                    identity_errors.append('packaged SKILL.md must declare frontmatter name')
                else:
                    top_level = next(iter(top_levels))
                    if top_level != skill_name:
                        identity_errors.append(
                            f'archive top-level directory {top_level!r} does not match Skill name {skill_name!r}'
                        )
    return sorted(set(bad)), sorted(set(unsafe_paths)), sorted(set(identity_errors))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('target', help='Skill source directory or packaged .zip artifact')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    target = Path(a.target).resolve()

    error = None
    unsafe_paths: list[str] = []
    identity_errors: list[str] = []
    if target.is_dir():
        mode = 'directory'
        bad = scan_directory(target)
    elif target.is_file() and target.suffix.lower() == '.zip':
        mode = 'zip'
        try:
            bad, unsafe_paths, identity_errors = scan_zip(target)
        except zipfile.BadZipFile as exc:
            bad = []
            error = f'bad zip: {exc}'
    else:
        mode = 'unknown'
        bad = []
        error = 'target must be an existing Skill directory or .zip file'

    passed = not bad and not unsafe_paths and not identity_errors and error is None
    payload = {
        'status': 'pass' if passed else 'fail',
        'mode': mode,
        'artifacts': bad,
        'unsafe_paths': unsafe_paths,
        'package_identity_errors': identity_errors,
    }
    if error is not None:
        payload['error'] = error

    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print('PASS' if passed else 'FAIL')
        for item in bad:
            print('- transient: ' + item)
        for item in unsafe_paths:
            print('- unsafe-path: ' + item)
        for item in identity_errors:
            print('- package-identity: ' + item)
        if error:
            print('- ' + error)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
