#!/usr/bin/env python3
"""Fail when a reference markdown file has no discoverable inbound owner.

This is a structural maintenance gate, not a prose-quality checker. A reference
must be named from SKILL.md, a script/runtime file, or another reference. Tests
and eval fixtures are evidence surfaces and do not count as runtime discoverability. Files
with zero inbound mentions are dead package weight because progressive loaders
have no path to discover them.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

TEXT_SUFFIXES = {'.md', '.py', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml'}
IGNORE_PARTS = {'.git', '__pycache__', '.pytest_cache', 'tests', 'evals'}
OVERLAY_TOMBSTONE_MARKER = '<!-- veteran-overlay-tombstone -->'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('skill_root')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    root = Path(args.skill_root).resolve()
    all_refs = sorted((root / 'references').glob('*.md'))
    tombstones = [
        ref for ref in all_refs
        if OVERLAY_TOMBSTONE_MARKER in ref.read_text(encoding='utf-8', errors='ignore')
    ]
    refs = [ref for ref in all_refs if ref not in tombstones]
    files = [
        p for p in root.rglob('*')
        if p.is_file()
        and p.suffix in TEXT_SUFFIXES
        and p not in tombstones
        and not any(part in IGNORE_PARTS for part in p.parts)
    ]
    texts = {}
    for path in files:
        try:
            texts[path] = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            texts[path] = path.read_text(encoding='utf-8', errors='ignore')

    orphaned = []
    inbound = {}
    for ref in refs:
        rel = f'references/{ref.name}'
        users = []
        for path, text in texts.items():
            if path == ref:
                continue
            if rel in text or ref.name in text:
                users.append(str(path.relative_to(root)))
        inbound[ref.name] = users
        if not users:
            orphaned.append(ref.name)

    payload = {
        'reference_count': len(all_refs),
        'active_reference_count': len(refs),
        'overlay_tombstones': [ref.name for ref in tombstones],
        'orphaned': orphaned,
        'status': 'PASS' if not orphaned else 'FAIL',
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"references: {len(all_refs)} active: {len(refs)}")
        if orphaned:
            print('orphaned references:')
            for name in orphaned:
                print(f'- {name}')
        print(payload['status'])
    return 0 if not orphaned else 1


if __name__ == '__main__':
    raise SystemExit(main())
