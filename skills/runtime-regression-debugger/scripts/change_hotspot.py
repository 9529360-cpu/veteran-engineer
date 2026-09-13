#!/usr/bin/env python3
"""Prioritize changed files using Git history plus path-level engineering risk.

Uses only Git metadata, file paths, and commit subjects. It never opens source files
and never reports author identity. The score is a triage heuristic, not a probability.

Usage:
  change_hotspot.py <repo-root>
  change_hotspot.py <repo-root> --base origin/main
  change_hotspot.py <repo-root> --base origin/main --window 500 --json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from collections import defaultdict

try:
    from change_impact_map import HIGH_RISK_SURFACES, MEDIUM_RISK_SURFACES, classify
except Exception as exc:
    raise SystemExit(f"cannot import change_impact_map.py from the same scripts directory: {exc}")

FIX_WORDS = (
    "fix", "bug", "regression", "revert", "rollback", "hotfix", "incident",
    "race", "deadlock", "leak", "corrupt", "crash", "timeout", "retry",
)


def git(root: pathlib.Path, *args: str, allow_failure: bool = False) -> str:
    p = subprocess.run(
        ["git", "-C", str(root), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if p.returncode and not allow_failure:
        raise RuntimeError(p.stderr.strip() or p.stdout.strip() or "git command failed")
    return p.stdout if p.returncode == 0 else ""


def changed_paths(root: pathlib.Path, base: str | None) -> list[str]:
    paths: set[str] = set()
    if base:
        out = git(root, "diff", "--name-only", f"{base}...HEAD", allow_failure=True)
        paths.update(x.strip() for x in out.splitlines() if x.strip())
    for args in (("diff", "--name-only"), ("diff", "--cached", "--name-only")):
        out = git(root, *args, allow_failure=True)
        paths.update(x.strip() for x in out.splitlines() if x.strip())
    out = git(root, "ls-files", "--others", "--exclude-standard", allow_failure=True)
    paths.update(x.strip() for x in out.splitlines() if x.strip())
    return sorted(paths)


def history(root: pathlib.Path, window: int) -> tuple[dict[str, int], dict[str, int]]:
    raw = git(root, "log", f"-n{window}", "--format=@@%s", "--name-only", "--no-renames")
    touches: dict[str, int] = defaultdict(int)
    fixes: dict[str, int] = defaultdict(int)
    subject = ""
    seen_in_commit: set[str] = set()

    def flush() -> None:
        if not subject:
            return
        is_fix = any(word in subject.lower() for word in FIX_WORDS)
        for path in seen_in_commit:
            touches[path] += 1
            if is_fix:
                fixes[path] += 1

    for line in raw.splitlines():
        if line.startswith("@@"):
            flush()
            subject = line[2:]
            seen_in_commit = set()
        else:
            path = line.strip()
            if path:
                seen_in_commit.add(path)
    flush()
    return dict(touches), dict(fixes)


def score(path: str, touches: int, fixes: int) -> tuple[float, list[str], str]:
    surfaces = sorted(classify(path))
    if any(s in HIGH_RISK_SURFACES for s in surfaces):
        risk = "high"
        surface_points = 4.0
    elif any(s in MEDIUM_RISK_SURFACES for s in surfaces):
        risk = "medium"
        surface_points = 2.0
    else:
        risk = "other"
        surface_points = 0.5 if surfaces else 0.0
    points = min(touches, 12) * 0.5 + min(fixes, 6) * 1.5 + surface_points
    if len(surfaces) > 1:
        points += min(len(surfaces) - 1, 5) * 0.25
    return round(points, 2), surfaces, risk


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--base")
    ap.add_argument("--window", type=int, default=300)
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = pathlib.Path(args.repo).resolve()
    if not root.exists():
        raise SystemExit(f"repo does not exist: {root}")
    if args.window < 1 or args.limit < 1:
        raise SystemExit("--window and --limit must be positive")
    git(root, "rev-parse", "--is-inside-work-tree")

    changed = changed_paths(root, args.base)
    touches, fixes = history(root, args.window)
    rows = []
    for path in changed:
        pts, surfaces, risk = score(path, touches.get(path, 0), fixes.get(path, 0))
        rows.append({
            "path": path,
            "triage_score": pts,
            "risk_band": risk,
            "history_touches": touches.get(path, 0),
            "fix_like_commits": fixes.get(path, 0),
            "surfaces": surfaces,
        })
    rows.sort(key=lambda r: (-r["triage_score"], -r["fix_like_commits"], -r["history_touches"], r["path"]))
    rows = rows[: args.limit]

    report = {
        "repo": str(root),
        "base": args.base,
        "history_window_commits": args.window,
        "note": "Triage heuristic only; read the actual diff and active callers before judging risk.",
        "hotspots": rows,
    }
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print("Changed-file historical hotspots")
        print(report["note"])
        if not rows:
            print("- No changed paths found.")
        for r in rows:
            surf = ",".join(r["surfaces"]) or "unclassified"
            print(
                f"- {r['path']}: score={r['triage_score']} band={r['risk_band']} "
                f"touches={r['history_touches']} fix-like={r['fix_like_commits']} surfaces={surf}"
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
