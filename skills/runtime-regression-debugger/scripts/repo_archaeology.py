#!/usr/bin/env python3
"""Summarize Git maintenance hotspots without reading application source contents.

Usage:
  repo_archaeology.py <repo-root>
  repo_archaeology.py <repo-root> --since "24 months ago" --top 25
  repo_archaeology.py <repo-root> --json

Privacy/safety:
- Reads Git commit metadata, paths, and numstat only.
- Does not print author identities or commit subjects.
- Does not read .env files, secrets, or application source contents.
- Treats hotspot scores as triage hints, never as developer performance metrics.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

FIX_RE = re.compile(r"\b(fix|bug|revert|rollback|hotfix|regression|incident|repair)\b", re.I)
REVERT_RE = re.compile(r"\b(revert|rollback)\b", re.I)
SKIP_PARTS = {
    "node_modules", "vendor", "dist", "build", "out", "coverage", ".next", ".nuxt",
    "target", "Pods", "__pycache__", ".venv", "venv", ".cache",
}
GENERATED_SUFFIXES = {
    ".min.js", ".min.css", ".map", ".lock", ".sum",
}
HIGH_RISK_WORDS = {
    "auth", "security", "tenant", "billing", "payment", "migration", "migrations",
    "schema", "release", "deploy", "workflow", "infra", "terraform", "k8s", "kubernetes",
    "session", "permission", "policy", "crypto", "secrets",
}


@dataclass
class FileStat:
    touches: int = 0
    additions: int = 0
    deletions: int = 0
    fix_touches: int = 0
    authors: set[str] = field(default_factory=set)
    first_seen: str | None = None
    last_seen: str | None = None

    @property
    def churn(self) -> int:
        return self.additions + self.deletions


@dataclass
class Commit:
    author_key: str
    date: str
    subject: str


def git(root: pathlib.Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def author_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:16]


def should_skip(path_text: str) -> bool:
    path = pathlib.PurePosixPath(path_text.replace("\\", "/"))
    if any(part in SKIP_PARTS for part in path.parts):
        return True
    lower = path_text.lower()
    if lower.endswith(tuple(GENERATED_SUFFIXES)):
        return True
    if lower.endswith(("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "cargo.lock")):
        return True
    return False


def parse_log(lines: Iterable[str]) -> tuple[dict[str, FileStat], int, int, int]:
    stats: dict[str, FileStat] = defaultdict(FileStat)
    current: Commit | None = None
    commit_count = 0
    fix_commit_count = 0
    revert_commit_count = 0

    for raw in lines:
        line = raw.rstrip("\n")
        if line.startswith("@@COMMIT@@\t"):
            parts = line.split("\t", 4)
            if len(parts) < 5:
                current = None
                continue
            _, _sha, author, date, subject = parts
            current = Commit(author_key(author), date, subject)
            commit_count += 1
            if FIX_RE.search(subject):
                fix_commit_count += 1
            if REVERT_RE.search(subject):
                revert_commit_count += 1
            continue

        if current is None or not line or "\t" not in line:
            continue

        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        add_raw, del_raw, path_text = parts
        if should_skip(path_text):
            continue

        try:
            additions = int(add_raw) if add_raw != "-" else 0
            deletions = int(del_raw) if del_raw != "-" else 0
        except ValueError:
            continue

        item = stats[path_text]
        item.touches += 1
        item.additions += additions
        item.deletions += deletions
        item.authors.add(current.author_key)
        if FIX_RE.search(current.subject):
            item.fix_touches += 1
        if item.first_seen is None or current.date < item.first_seen:
            item.first_seen = current.date
        if item.last_seen is None or current.date > item.last_seen:
            item.last_seen = current.date

    return stats, commit_count, fix_commit_count, revert_commit_count


def percentile(values: list[int], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    pos = (len(ordered) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return float(ordered[lo])
    frac = pos - lo
    return ordered[lo] * (1 - frac) + ordered[hi] * frac


def is_high_risk_path(path_text: str) -> bool:
    tokens = set(re.split(r"[^a-z0-9]+", path_text.lower()))
    return bool(tokens & HIGH_RISK_WORDS)


def parse_date(raw: str | None) -> dt.datetime | None:
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def notes_for(path: str, item: FileStat, touch_p75: float, churn_p75: float) -> list[str]:
    notes: list[str] = []
    if item.touches >= max(5, touch_p75):
        notes.append("high-touch")
    if item.churn >= max(250, churn_p75):
        notes.append("high-churn")
    if item.fix_touches >= 2 and item.fix_touches / max(item.touches, 1) >= 0.30:
        notes.append("repeated-fix")
    if item.touches >= 5 and len(item.authors) <= 1:
        notes.append("knowledge-concentration")
    if is_high_risk_path(path):
        notes.append("sensitive-surface")
    return notes


def score_for(path: str, item: FileStat, notes: list[str]) -> float:
    score = item.touches * 2.0 + math.log1p(item.churn) + item.fix_touches * 2.5
    if "knowledge-concentration" in notes:
        score += 4.0
    if "sensitive-surface" in notes:
        score += 3.0
    if "repeated-fix" in notes:
        score += 3.0
    return round(score, 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root")
    parser.add_argument("--since", default="18 months ago", help="git --since expression")
    parser.add_argument("--max-commits", type=int, default=1500)
    parser.add_argument("--top", type=int, default=30)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = pathlib.Path(args.repo_root).resolve()
    if not root.is_dir():
        print(f"error: repository not found: {root}", file=sys.stderr)
        return 2

    inside = git(root, ["rev-parse", "--is-inside-work-tree"])
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        print(f"error: not a Git work tree: {root}", file=sys.stderr)
        return 2

    shallow = git(root, ["rev-parse", "--is-shallow-repository"])
    is_shallow = shallow.returncode == 0 and shallow.stdout.strip() == "true"

    log = git(root, [
        "log",
        f"--since={args.since}",
        f"--max-count={max(1, args.max_commits)}",
        "--no-renames",
        "--date=iso-strict",
        "--format=@@COMMIT@@%x09%H%x09%aN <%aE>%x09%aI%x09%s",
        "--numstat",
    ])
    if log.returncode != 0:
        print(log.stderr.strip() or "error: git log failed", file=sys.stderr)
        return 2

    stats, commit_count, fix_commit_count, revert_commit_count = parse_log(log.stdout.splitlines())
    touch_values = [s.touches for s in stats.values()]
    churn_values = [s.churn for s in stats.values()]
    touch_p75 = percentile(touch_values, 0.75)
    churn_p75 = percentile(churn_values, 0.75)

    rows = []
    for path, item in stats.items():
        notes = notes_for(path, item, touch_p75, churn_p75)
        rows.append({
            "path": path,
            "touches": item.touches,
            "churn": item.churn,
            "additions": item.additions,
            "deletions": item.deletions,
            "fix_touches": item.fix_touches,
            "author_count": len(item.authors),
            "first_seen_in_window": item.first_seen,
            "last_seen": item.last_seen,
            "signals": notes,
            "score": score_for(path, item, notes),
        })
    rows.sort(key=lambda r: (-r["score"], -r["touches"], r["path"]))
    rows = rows[: max(1, args.top)]

    report = {
        "root": str(root),
        "window": args.since,
        "max_commits": args.max_commits,
        "sampled_commits": commit_count,
        "files_seen": len(stats),
        "fix_like_commits": fix_commit_count,
        "revert_like_commits": revert_commit_count,
        "shallow_repository": is_shallow,
        "privacy": "Git metadata/path/numstat only; author identities and commit subjects are not emitted",
        "hotspots": rows,
        "caveats": [
            "Hotspot scores are relative triage hints, not code-quality or developer-performance scores.",
            "Renames are not followed; shallow/truncated history can hide older ownership and churn.",
            "Combine history with active callers, production traffic, tests, incidents, and product criticality.",
        ],
    }

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    print("# Repository archaeology")
    print(f"root: {root}")
    print(f"window: {args.since}; sampled commits: {commit_count}; files seen: {len(stats)}")
    print(f"fix-like commits: {fix_commit_count}; revert-like commits: {revert_commit_count}")
    print(f"shallow repository: {'yes' if is_shallow else 'no'}")
    print("privacy: Git metadata/path/numstat only; author identities and commit subjects are not emitted")

    print("\n## Maintenance hotspots")
    if not rows:
        print("- no file history found in the selected window")
    for row in rows:
        signals = ", ".join(row["signals"]) if row["signals"] else "none"
        print(
            f"- {row['path']}: score={row['score']}; touches={row['touches']}; "
            f"churn={row['churn']}; fix_touches={row['fix_touches']}; "
            f"author_count={row['author_count']}; signals={signals}"
        )

    print("\n## Interpretation")
    print("- Inspect relevant high-touch/repeated-fix/sensitive surfaces before broad refactors or incident patches.")
    print("- Treat knowledge concentration as a documentation/review/ownership risk, not as blame.")
    print("- Use active callers, runtime evidence, tests, and issue/PR history to explain why a hotspot exists.")
    if is_shallow:
        print("- History is shallow; do not infer long-term ownership or stability from this sample.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
