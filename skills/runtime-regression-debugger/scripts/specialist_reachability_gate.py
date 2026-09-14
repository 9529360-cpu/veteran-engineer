#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

from context_router_integrity_gate import parse_router, validate as validate_router
from reference_link_integrity_gate import candidate_target, strip_fences, INLINE_RE, validate as validate_links


def validate(skill_root: Path):
    router_path = skill_root / "scripts" / "engineering_context_router.py"
    router_result = validate_router(skill_root, router_path)
    link_result = validate_links(skill_root)
    blockers = []
    if not router_result["gate_passed"]:
        blockers.append({
            "code": "ROUTER_INTEGRITY_REQUIRED",
            "path": "scripts/engineering_context_router.py",
            "message": "router integrity must pass before reachability can be trusted",
        })
    if not link_result["gate_passed"]:
        blockers.append({
            "code": "REFERENCE_LINK_INTEGRITY_REQUIRED",
            "path": "references",
            "message": "reference-link integrity must pass before reachability can be trusted",
        })

    core, routes, _aliases, parse_blockers = parse_router(router_path)
    if parse_blockers and not any(item["code"] == "ROUTER_INTEGRITY_REQUIRED" for item in blockers):
        blockers.append({
            "code": "ROUTER_PARSE_BLOCKED",
            "path": "scripts/engineering_context_router.py",
            "message": "router topology could not be parsed deterministically",
        })

    refs_dir = skill_root / "references"
    reference_files = sorted(refs_dir.glob("*.md")) if refs_dir.is_dir() else []
    specialists = sorted(f"references/{path.name}" for path in reference_files if path.name.endswith("-product-engineering.md"))
    if not specialists:
        blockers.append({
            "code": "SPECIALISTS_MISSING",
            "path": "references",
            "message": "no *-product-engineering.md specialist references found",
        })

    graph = {f"references/{path.name}": set() for path in reference_files}
    refs_root = refs_dir.resolve()
    for source in reference_files:
        try:
            text = strip_fences(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeError):
            continue
        source_key = f"references/{source.name}"
        for match in INLINE_RE.finditer(text):
            token = match.group(1).strip()
            candidate = candidate_target(skill_root, source, token)
            if candidate is None:
                continue
            target, _kind = candidate
            target = target.resolve()
            if target.parent == refs_root and target.is_file():
                graph[source_key].add(f"references/{target.name}")

    roots = []
    for ref in core:
        if isinstance(ref, str) and ref.startswith("references/"):
            roots.append(ref)
    for refs in routes.values():
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if isinstance(ref, str) and ref.startswith("references/"):
                roots.append(ref)

    reachable = set()
    queue = deque(dict.fromkeys(roots))
    while queue:
        current = queue.popleft()
        if current in reachable:
            continue
        reachable.add(current)
        for target in sorted(graph.get(current, ())):
            if target not in reachable:
                queue.append(target)

    unreachable = [ref for ref in specialists if ref not in reachable]
    for ref in unreachable:
        blockers.append({
            "code": "SPECIALIST_UNREACHABLE",
            "path": ref,
            "message": "specialist is not reachable from CORE/ROUTES through explicit local reference links",
        })

    return {
        "skill_root": str(skill_root),
        "specialist_count": len(specialists),
        "reachable_specialists": [ref for ref in specialists if ref in reachable],
        "unreachable_specialists": unreachable,
        "root_reference_count": len(set(roots)),
        "gate_passed": not blockers,
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate product-engineering specialist reachability from the context router")
    parser.add_argument("--skill-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = validate(Path(args.skill_root).resolve())
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"specialists={result['specialist_count']} unreachable={len(result['unreachable_specialists'])}")
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
