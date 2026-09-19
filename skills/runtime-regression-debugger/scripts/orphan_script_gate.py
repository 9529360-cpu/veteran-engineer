#!/usr/bin/env python3
"""Fail when a top-level Skill script has no discoverable inbound package reference.

A script may be reached from SKILL.md, a specialist reference, another script, or the
bundled runtime. Tests and eval fixtures are evidence surfaces and do not count as
discoverability. The gate protects against detached executable sediment without
requiring every helper to be named in the main Skill.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

TEXT_SUFFIXES = {'.md', '.py', '.mjs', '.js', '.cjs', '.json', '.yaml', '.yml', '.toml', '.sh'}
IGNORE_PARTS = {'.git', '__pycache__', '.pytest_cache', 'node_modules', 'tests', 'evals'}


def readable_files(root: Path):
    for path in root.rglob('*'):
        if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
            continue
        if any(part in IGNORE_PARTS for part in path.parts):
            continue
        yield path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('skill_root')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    root = Path(args.skill_root).resolve()
    scripts_dir = root / 'scripts'
    scripts = sorted(p for p in scripts_dir.iterdir() if p.is_file()) if scripts_dir.is_dir() else []
    corpus = []
    for path in readable_files(root):
        try:
            corpus.append((path, path.read_text(encoding='utf-8', errors='ignore')))
        except OSError:
            pass

    rows = []
    orphans = []
    for script in scripts:
        rel = script.relative_to(root).as_posix()
        refs = []
        for path, text in corpus:
            if path == script:
                continue
            if script.name in text or rel in text:
                refs.append(path.relative_to(root).as_posix())
        rows.append({'script': rel, 'inbound_count': len(refs), 'sample_inbound': refs[:8]})
        if not refs:
            orphans.append(rel)

    payload = {'status': 'pass' if not orphans else 'fail', 'scripts': len(scripts), 'orphans': orphans, 'rows': rows}
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"scripts: {len(scripts)}")
        if orphans:
            print('FAIL')
            for item in orphans:
                print(f'- {item}')
        else:
            print('PASS')
    return 0 if not orphans else 1


if __name__ == '__main__':
    raise SystemExit(main())
