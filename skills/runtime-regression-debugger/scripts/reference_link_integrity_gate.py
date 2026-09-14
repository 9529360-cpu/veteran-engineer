#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FENCE_RE = re.compile(r"```.*?```|~~~.*?~~~", re.DOTALL)
INLINE_RE = re.compile(r"`([^`\n]+\.md)`")


def blocker(items, code, source, token, message):
    items.append({"code": code, "source": source, "token": token, "message": message})


def strip_fences(text: str) -> str:
    return FENCE_RE.sub("", text)


def candidate_target(skill_root: Path, source: Path, token: str):
    token = token.strip()
    if not token or "://" in token or token.startswith(("http:", "https:")):
        return None
    if token.startswith("references/"):
        return skill_root / Path(token), "explicit"
    if "/" not in token and "-" in token and source.parent.name == "references":
        return source.parent / token, "sibling"
    return None


def validate(skill_root: Path):
    blockers = []
    checked = []
    sources = []
    skill_md = skill_root / "SKILL.md"
    if skill_md.is_file():
        sources.append(skill_md)
    refs_dir = skill_root / "references"
    if refs_dir.is_dir():
        sources.extend(sorted(refs_dir.glob("*.md")))

    if not sources:
        blocker(blockers, "DOCUMENT_SOURCES_MISSING", str(skill_root), "", "SKILL.md and references/*.md are missing")
        return {"gate_passed": False, "checked_links": checked, "blockers": blockers}

    refs_root = refs_dir.resolve()
    for source in sources:
        try:
            text = strip_fences(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            blocker(blockers, "DOCUMENT_UNREADABLE", str(source), "", str(exc))
            continue
        for match in INLINE_RE.finditer(text):
            token = match.group(1).strip()
            candidate = candidate_target(skill_root, source, token)
            if candidate is None:
                continue
            target, kind = candidate
            target = target.resolve()
            source_rel = str(source.relative_to(skill_root))
            if target.parent != refs_root:
                blocker(blockers, "REFERENCE_LINK_ESCAPE", source_rel, token, "local reference link escapes references root")
                continue
            checked.append({"source": source_rel, "token": token, "kind": kind})
            if not target.is_file():
                blocker(blockers, "REFERENCE_LINK_MISSING", source_rel, token, "referenced markdown file does not exist")

    checked.sort(key=lambda row: (row["source"], row["token"]))
    blockers.sort(key=lambda row: (row["source"], row["token"], row["code"]))
    return {
        "skill_root": str(skill_root),
        "documents_scanned": len(sources),
        "links_checked": len(checked),
        "checked_links": checked,
        "gate_passed": not blockers,
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate explicit local markdown reference links inside the Skill package")
    parser.add_argument("--skill-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = validate(Path(args.skill_root).resolve())
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"documents={result['documents_scanned']} links={result['links_checked']}")
        for item in result["blockers"]:
            print(f"- {item['code']} {item['source']} {item['token']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
