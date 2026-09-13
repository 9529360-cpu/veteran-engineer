#!/usr/bin/env python3
"""Scan an Electron/web runtime repo for cross-boundary regression hotspots.

Usage: trace_runtime_boundaries.py <repo-root> [--scan-dir PATH] [--max-per-category N]

Static, standard-library-only scan. It does not execute project code. The output
is a triage index, not proof of a bug.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

TEXT_SUFFIXES = {
    '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.vue',
    '.svelte', '.css', '.json', '.py', '.yml', '.yaml',
}
SKIP_DIRS = {
    '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next',
    '.cache', 'vendor',
}
PATTERNS = {
    'ipc-bridge': re.compile(r'ipcMain\.(?:on|once|handle|handleOnce|removeHandler|removeListener|off)|ipcRenderer\.(?:on|once|invoke|send|removeListener|off)|contextBridge\.exposeInMainWorld|contextIsolation'),
    'window-document-lifecycle': re.compile(r'BrowserWindow|WebContentsView|BrowserView|webContents|<webview|did-start-navigation|did-navigate|did-finish-load|dom-ready|render-process-gone|unresponsive|destroyed|isDestroyed|reload\s*\('),
    'listener-cleanup': re.compile(r'addEventListener|removeEventListener|useEffect|StrictMode|subscribe\s*\(|unsubscribe\s*\(|\.on\s*\(|\.off\s*\(|cleanup|dispose'),
    'async-generation': re.compile(r'AbortController|await\b|Promise\b|\.then\s*\(|requestId|request_id|sequence|generation|epoch|version|accountId|account_id|profileId|profile_id|sessionId|session_id|windowId|window_id'),
    'hydration-persistence': re.compile(r'hydrate|rehydrate|restore|loadState|load_state|persist|saveState|save_state|initialize|initialise|bootstrap|accountData'),
    'session-cache': re.compile(r'session\.fromPartition|session\.fromPath|partition|localStorage|sessionStorage|indexedDB|serviceWorker|serviceWorkers|CacheStorage|clearCache|clearStorageData|flushStorageData|cookies'),
    'remote-embedding-security': re.compile(r'will-attach-webview|setPermissionRequestHandler|setPermissionCheckHandler|setWindowOpenHandler|will-navigate|will-frame-navigate|nodeIntegration|contextIsolation|sandbox|webSecurity|allowRunningInsecureContent|allowpopups'),
    'service-adapter-injection': re.compile(r'executeJavaScript|preload|contextBridge|inject|injection|recipe|adapter|bridge'),
    'packaging-provenance': re.compile(r'app\.isPackaged|app\.getAppPath|app\.getPath|process\.resourcesPath|process\.execPath|\.asar\b|asarUnpack|__dirname|loadFile\s*\(|loadURL\s*\('),
    'release-promotion': re.compile(r'electron-updater|latest\.(?:yml|yaml|json)|blockmap|rollback|sha256|sha-256|release[-_ ]version|attest|artifact|publish|promotion'),
    'dom-replacement': re.compile(r'cloneNode|replaceWith|replaceChild|innerHTML|outerHTML|removeChild|\.remove\s*\(|createRoot|unmount|render\s*\('),
}


def iter_files(root: pathlib.Path):
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('repo_root')
    parser.add_argument('--scan-dir', default='.')
    parser.add_argument('--max-per-category', type=int, default=80)
    args = parser.parse_args()

    repo = pathlib.Path(args.repo_root).resolve()
    root = (repo / args.scan_dir).resolve()
    try:
        root.relative_to(repo)
    except ValueError:
        print('error: --scan-dir must remain inside repository', file=sys.stderr)
        return 2
    if not repo.is_dir() or not root.is_dir():
        print(f'error: scan directory not found: {root}', file=sys.stderr)
        return 2

    hits: dict[str, list[tuple[pathlib.Path, int, str]]] = {name: [] for name in PATTERNS}
    for path in iter_files(root):
        try:
            lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        except OSError:
            continue
        for line_no, text in enumerate(lines, 1):
            for category, pattern in PATTERNS.items():
                if pattern.search(text):
                    hits[category].append((path, line_no, text.strip()))

    print('# Runtime boundary trace')
    print('scan_root:', root)
    total = 0
    for category, items in hits.items():
        print(f'\n## {category} ({len(items)} hits)')
        for path, line_no, text in items[: max(1, args.max_per_category)]:
            print(f'{path.relative_to(repo)}:{line_no}: {text[:240]}')
            total += 1
        if len(items) > args.max_per_category:
            print(f'... {len(items) - args.max_per_category} more hits omitted')
    if total == 0:
        print('\nNo known runtime-boundary markers found.')
    print('\nThis output is a hypothesis index only; prove ownership and runtime behavior before patching.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
