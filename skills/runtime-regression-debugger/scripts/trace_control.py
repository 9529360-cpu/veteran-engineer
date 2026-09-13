#!/usr/bin/env python3
"""Trace likely ownership/event/lifecycle references for a UI control ID.

Usage: trace_control.py <repo-root> <dom-id> [--ui-dir PATH]

By default scans the repository while skipping generated/vendor directories.
Uses only the Python standard library. It does not execute project code or read
binary files.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

TEXT_SUFFIXES = {
    '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css',
    '.vue', '.svelte', '.py',
}
SKIP_DIRS = {
    '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next',
    '.cache', 'vendor',
}
RISK_PATTERNS = {
    'event': re.compile(r'addEventListener|removeEventListener|\.onclick\s*=|closest\s*\(|matches\s*\('),
    'intercept': re.compile(r'preventDefault|stopImmediatePropagation|stopPropagation|capture'),
    'visibility': re.compile(r'display\s*[:=]|visibility|pointer-events|disabled|hidden|z-index'),
    'loader': re.compile(r'<script\b|loadScript\s*\(|appendChild\s*\(script|script\.src|DOMContentLoaded|dom-ready|did-finish-load'),
    'replacement': re.compile(r'cloneNode|replaceWith|replaceChild|innerHTML|outerHTML|removeChild|\.remove\s*\(|createRoot|unmount|render\s*\('),
    'ipc-lifecycle': re.compile(r'ipcMain\.|ipcRenderer\.|contextBridge|BrowserWindow|webContents|WebContentsView|BrowserView|<webview|did-navigate|render-process-gone|destroyed|reload\s*\('),
    'async-generation': re.compile(r'await\b|Promise\b|\.then\s*\(|AbortController|setTimeout|queueMicrotask|requestAnimationFrame|requestId|sequence|generation|version|accountId|activeAccount|profileId|sessionId|windowId'),
    'state-storage': re.compile(r'accountData|localStorage|sessionStorage|indexedDB|serviceWorker|saved|selected|persist|hydrate|rehydrate|restore|render'),
    'package-session': re.compile(r'app\.isPackaged|app\.getAppPath|process\.resourcesPath|process\.execPath|\.asar\b|session\.fromPartition|partition|clearCache|clearStorageData'),
}


def iter_text_files(root: pathlib.Path):
    for path in root.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            if path.stat().st_size <= 2_000_000:
                yield path
        except OSError:
            continue


def likely_runtime_file(path: pathlib.Path) -> bool:
    name = path.name.lower()
    markers = ('main', 'preload', 'renderer', 'ipc', 'window', 'webview', 'loader', 'app', 'store', 'persist')
    return any(marker in name for marker in markers)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('repo_root')
    parser.add_argument('dom_id')
    parser.add_argument('--ui-dir', default='.')
    parser.add_argument('--max-lines', type=int, default=300)
    args = parser.parse_args()

    repo = pathlib.Path(args.repo_root).resolve()
    scan_root = (repo / args.ui_dir).resolve()
    try:
        scan_root.relative_to(repo)
    except ValueError:
        print('error: --ui-dir must remain inside repository', file=sys.stderr)
        return 2
    if not repo.is_dir() or not scan_root.is_dir():
        print(f'error: repository/UI directory not found: {scan_root}', file=sys.stderr)
        return 2

    dom_id = args.dom_id.lstrip('#')
    files = list(iter_text_files(scan_root))
    direct_hits: dict[pathlib.Path, list[tuple[int, str]]] = {}

    for path in files:
        try:
            lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        except OSError:
            continue
        for idx, line in enumerate(lines, 1):
            if dom_id in line:
                direct_hits.setdefault(path, []).append((idx, line.strip()))

    print(f'# UI control trace: #{dom_id}')
    print('scan_root:', scan_root)
    if not direct_hits:
        print('No direct references found under', scan_root)
        return 1

    print('\n## Direct references')
    for path, hits in sorted(direct_hits.items(), key=lambda item: str(item[0])):
        rel = path.relative_to(repo)
        for line_no, text in hits:
            print(f'{rel}:{line_no}: {text[:240]}')

    candidate_files = set(direct_hits)
    candidate_files.update(path for path in files if likely_runtime_file(path))

    print('\n## Nearby runtime risk markers')
    print('Categories: event/interception, visibility, loader, replacement, IPC/lifecycle, async-generation, state/storage, package/session.')
    emitted = 0
    for path in sorted(candidate_files, key=str):
        try:
            lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        except OSError:
            continue
        hit_lines = [n for n, text in enumerate(lines, 1) if dom_id in text]
        windows: set[int] = set()
        for n in hit_lines:
            windows.update(range(max(1, n - 16), min(len(lines), n + 16) + 1))
        if likely_runtime_file(path):
            windows.update(
                n for n, text in enumerate(lines, 1)
                if any(pattern.search(text) for pattern in RISK_PATTERNS.values())
            )
        for n in sorted(windows):
            text = lines[n - 1].strip()
            categories = [name for name, pattern in RISK_PATTERNS.items() if pattern.search(text)]
            if not categories:
                continue
            print(f'{path.relative_to(repo)}:{n}: [{",".join(categories)}] {text[:220]}')
            emitted += 1
            if emitted >= max(1, args.max_lines):
                print(f'... output capped at {args.max_lines} risk-marker lines')
                return 0
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
