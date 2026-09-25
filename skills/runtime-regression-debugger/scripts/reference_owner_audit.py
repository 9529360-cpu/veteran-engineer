#!/usr/bin/env python3
"""Audit reference ownership and progressive-loading entry points.

This is a maintenance aid for Veteran Engineer. It derives its view from the
actual control plane instead of maintaining a second reference registry:

- SKILL.md direct reference links
- scripts/engineering_context_router.py ROUTES
- scripts/stack_fingerprint.py REFERENCE_RULES
- reference-to-reference links

It reports unreachable references and task-router references with identical
non-empty route signatures. Identical route signatures are a consolidation
signal: if two documents always enter through the same task signals, maintainers
should either merge the owner or make the decision/loading boundary explicit.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
from collections import defaultdict, deque
from pathlib import Path

OVERLAY_TOMBSTONE_MARKER = "<!-- veteran-overlay-tombstone -->"

INTENTIONAL_ROUTE_BUNDLES = {
    frozenset({
        "dogfood-skill-evolution.md",
        "skill-architecture-map.md",
        "skill-evolution-sourcebook.md",
    }): "Skill evolution deliberately co-loads the maintenance process, architecture map, and adoption/rejection evidence ledger; they share a trigger but own different decisions.",
}


def literal_mapping(path: Path, name: str) -> dict:
    """Read a top-level dict assignment plus literal `.update({...})` calls without importing the module."""
    module = ast.parse(path.read_text(encoding="utf-8"))
    value: dict = {}
    found = False
    for node in module.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            candidate = ast.literal_eval(node.value)
            if not isinstance(candidate, dict):
                raise RuntimeError(f"{name} in {path} is not a dict")
            value = dict(candidate)
            found = True
            continue
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute)
            and node.value.func.attr == "update"
            and isinstance(node.value.func.value, ast.Name)
            and node.value.func.value.id == name
        ):
            if len(node.value.args) != 1 or node.value.keywords:
                raise RuntimeError(f"unsupported {name}.update shape in {path}")
            candidate = ast.literal_eval(node.value.args[0])
            if not isinstance(candidate, dict):
                raise RuntimeError(f"{name}.update in {path} is not a dict")
            value.update(candidate)
            found = True
    if not found:
        raise RuntimeError(f"{name} not found in {path}")
    return value


def mentioned_references(text: str, names: set[str]) -> set[str]:
    found: set[str] = set()
    for name in names:
        if f"references/{name}" in text or re.search(rf"(?<![A-Za-z0-9_.-]){re.escape(name)}(?![A-Za-z0-9_.-])", text):
            found.add(name)
    return found


def audit(root: Path) -> dict:
    refs_dir = root / "references"
    all_refs = sorted(refs_dir.glob("*.md"))
    overlay_tombstones = sorted(
        ref for ref in all_refs
        if OVERLAY_TOMBSTONE_MARKER in ref.read_text(encoding="utf-8", errors="ignore")
    )
    refs = [ref for ref in all_refs if ref not in overlay_tombstones]
    names = {p.name for p in refs}

    routes = literal_mapping(root / "scripts" / "engineering_context_router.py", "ROUTES")
    stack_rules = literal_mapping(root / "scripts" / "stack_fingerprint.py", "REFERENCE_RULES")

    route_signals: dict[str, set[str]] = defaultdict(set)
    for signal, paths in routes.items():
        for rel in paths:
            name = Path(rel).name
            if name in names:
                route_signals[name].add(signal)

    stack_selectors: dict[str, set[str]] = defaultdict(set)
    for selector, rel in stack_rules.items():
        name = Path(rel).name
        if name in names:
            stack_selectors[name].add(selector)

    skill_direct = mentioned_references((root / "SKILL.md").read_text(encoding="utf-8"), names)

    edges: dict[str, set[str]] = {}
    inbound: dict[str, set[str]] = defaultdict(set)
    for ref in refs:
        linked = mentioned_references(ref.read_text(encoding="utf-8"), names) - {ref.name}
        edges[ref.name] = linked
        for target in linked:
            inbound[target].add(ref.name)

    roots = set(skill_direct) | set(route_signals) | set(stack_selectors)
    reachable = set(roots)
    queue = deque(sorted(roots))
    while queue:
        current = queue.popleft()
        for target in edges.get(current, set()):
            if target not in reachable:
                reachable.add(target)
                queue.append(target)

    unreachable = sorted(names - reachable)

    by_signature: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for name, signals in route_signals.items():
        if signals:
            by_signature[tuple(sorted(signals))].append(name)
    exact_route_twins = []
    intentional_route_bundles = []
    for signature, group in sorted(by_signature.items()):
        if len(group) <= 1:
            continue
        group_key = frozenset(group)
        payload = {"signals": list(signature), "references": sorted(group)}
        if group_key in INTENTIONAL_ROUTE_BUNDLES:
            payload["rationale"] = INTENTIONAL_ROUTE_BUNDLES[group_key]
            intentional_route_bundles.append(payload)
        else:
            exact_route_twins.append(payload)

    entries = []
    for ref in refs:
        name = ref.name
        modes = []
        if name in skill_direct:
            modes.append("skill-control")
        if route_signals.get(name):
            modes.append("task-router")
        if stack_selectors.get(name):
            modes.append("stack-fingerprint")
        if inbound.get(name):
            modes.append("nested-reference")
        entries.append({
            "reference": name,
            "lines": len(ref.read_text(encoding="utf-8").splitlines()),
            "entry_modes": modes,
            "route_signals": sorted(route_signals.get(name, set())),
            "stack_selectors": sorted(stack_selectors.get(name, set())),
            "inbound_references": sorted(inbound.get(name, set())),
            "reachable": name in reachable,
        })

    return {
        "reference_count": len(all_refs),
        "active_reference_count": len(refs),
        "overlay_tombstones": [ref.name for ref in overlay_tombstones],
        "root_reference_count": len(roots),
        "reachable_reference_count": len(reachable),
        "unreachable_references": unreachable,
        "exact_route_twins": exact_route_twins,
        "intentional_route_bundles": intentional_route_bundles,
        "entries": entries,
        "status": "PASS" if not unreachable and not exact_route_twins else "REVIEW",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_root")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="fail on unreachable references or exact task-route twins")
    args = parser.parse_args()

    payload = audit(Path(args.skill_root).resolve())
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(f"references: {payload['reference_count']}")
        print(f"root references: {payload['root_reference_count']}")
        print(f"reachable references: {payload['reachable_reference_count']}")
        if payload["unreachable_references"]:
            print("unreachable references:")
            for name in payload["unreachable_references"]:
                print(f"- {name}")
        if payload["exact_route_twins"]:
            print("exact task-route twins:")
            for group in payload["exact_route_twins"]:
                print(f"- {', '.join(group['references'])}: {', '.join(group['signals'])}")
        print(payload["status"])

    if args.strict and (payload["unreachable_references"] or payload["exact_route_twins"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
