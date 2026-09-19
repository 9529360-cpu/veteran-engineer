#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

HOT_REFERENCE_ROUTE_COUNT = 8
HOT_REFERENCE_MAX_BYTES = 20 * 1024


def blocker(items, code, path, message):
    items.append({"code": code, "path": path, "message": message})


def string_literal(node):
    try:
        value = ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError):
        return None
    return value if isinstance(value, str) else None


def read_dict_literal(node, name, out, blockers):
    if not isinstance(node, ast.Dict):
        blocker(blockers, f"{name}_DICT_REQUIRED", name.lower(), f"{name} must be a dict literal")
        return
    seen_local = set()
    for key_node, value_node in zip(node.keys, node.values):
        key = string_literal(key_node) if key_node is not None else None
        if not key or not key.strip():
            blocker(blockers, f"{name}_KEY_INVALID", name.lower(), "keys must be non-empty string literals")
            continue
        key = key.strip()
        if key in seen_local or key in out:
            blocker(blockers, f"{name}_DUPLICATE", f"{name.lower()}.{key}", f"duplicate {name.lower()} key: {key}")
            continue
        seen_local.add(key)
        try:
            value = ast.literal_eval(value_node)
        except (ValueError, TypeError, SyntaxError):
            blocker(blockers, f"{name}_VALUE_LITERAL_REQUIRED", f"{name.lower()}.{key}", "value must be a literal")
            continue
        out[key] = value


def read_list_literal(node, name, blockers):
    try:
        value = ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError):
        blocker(blockers, f"{name}_LIST_REQUIRED", name.lower(), f"{name} must be a list literal")
        return []
    if not isinstance(value, list):
        blocker(blockers, f"{name}_LIST_REQUIRED", name.lower(), f"{name} must be a list literal")
        return []
    return value


def parse_router(router_path):
    blockers = []
    try:
        source = router_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(router_path))
    except (OSError, UnicodeError, SyntaxError) as exc:
        return [], {}, {}, [{"code": "ROUTER_UNREADABLE", "path": str(router_path), "message": str(exc)}]

    core = None
    routes = {}
    aliases = {}
    saw_routes = False
    saw_aliases = False

    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
            if target == "CORE":
                if core is not None:
                    blocker(blockers, "CORE_DUPLICATE", "core", "CORE is assigned more than once")
                else:
                    core = read_list_literal(node.value, "CORE", blockers)
            elif target == "ROUTES":
                if saw_routes:
                    blocker(blockers, "ROUTES_ASSIGNMENT_DUPLICATE", "routes", "ROUTES is assigned more than once")
                else:
                    saw_routes = True
                    read_dict_literal(node.value, "ROUTE", routes, blockers)
            elif target == "ALIASES":
                if saw_aliases:
                    blocker(blockers, "ALIASES_ASSIGNMENT_DUPLICATE", "aliases", "ALIASES is assigned more than once")
                else:
                    saw_aliases = True
                    read_dict_literal(node.value, "ALIAS", aliases, blockers)
            continue

        if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call):
            continue
        call = node.value
        if not isinstance(call.func, ast.Attribute) or call.func.attr != "update":
            continue
        if not isinstance(call.func.value, ast.Name) or call.func.value.id not in {"ROUTES", "ALIASES"}:
            continue
        owner = call.func.value.id
        if len(call.args) != 1 or call.keywords:
            blocker(blockers, f"{owner}_UPDATE_INVALID", owner.lower(), f"{owner}.update must receive exactly one dict literal")
            continue
        read_dict_literal(call.args[0], "ROUTE" if owner == "ROUTES" else "ALIAS", routes if owner == "ROUTES" else aliases, blockers)

    if core is None:
        blocker(blockers, "CORE_MISSING", "core", "CORE assignment is missing")
        core = []
    if not saw_routes:
        blocker(blockers, "ROUTES_MISSING", "routes", "ROUTES assignment is missing")
    if not saw_aliases:
        blocker(blockers, "ALIASES_MISSING", "aliases", "ALIASES assignment is missing")
    return core, routes, aliases, blockers


def validate_reference(skill_root, ref, path, blockers):
    if not isinstance(ref, str) or not ref.strip():
        blocker(blockers, "REFERENCE_INVALID", path, "reference must be a non-empty string")
        return
    ref = ref.strip()
    if not ref.startswith("references/") or not ref.endswith(".md"):
        blocker(blockers, "REFERENCE_PATH_INVALID", path, f"reference must be references/*.md: {ref}")
        return
    rel = Path(ref)
    if rel.is_absolute() or len(rel.parts) != 2 or any(part in {"", ".", ".."} for part in rel.parts):
        blocker(blockers, "REFERENCE_PATH_ESCAPE", path, f"reference must stay one level under references/: {ref}")
        return
    target = (skill_root / rel).resolve()
    reference_root = (skill_root / "references").resolve()
    if target.parent != reference_root:
        blocker(blockers, "REFERENCE_PATH_ESCAPE", path, f"reference escapes references root: {ref}")
        return
    if not target.is_file():
        blocker(blockers, "REFERENCE_MISSING", path, f"referenced file does not exist: {ref}")


def validate(skill_root, router_path):
    core, routes, aliases, blockers = parse_router(router_path)
    redundant_aliases = []
    route_usage = {}

    # Cross-project process invariants live in SKILL.md. Deep references must be
    # routed by an explicit mechanism rather than reserved in every route budget.
    if core:
        blocker(
            blockers,
            "CORE_DEEP_REFERENCE_FORBIDDEN",
            "core",
            "CORE must remain empty; route deep control references only for explicit mechanisms",
        )
    seen_core = set()
    for index, ref in enumerate(core):
        if ref in seen_core:
            blocker(blockers, "CORE_REFERENCE_DUPLICATE", f"core[{index}]", f"duplicate CORE reference: {ref}")
        seen_core.add(ref)
        validate_reference(skill_root, ref, f"core[{index}]", blockers)

    for route, refs in routes.items():
        if not isinstance(refs, list) or not refs:
            blocker(blockers, "ROUTE_REFERENCES_REQUIRED", f"routes.{route}", "route must contain one or more references")
            continue
        seen_refs = set()
        for index, ref in enumerate(refs):
            if ref in seen_refs:
                blocker(blockers, "ROUTE_REFERENCE_DUPLICATE", f"routes.{route}[{index}]", f"duplicate route reference: {ref}")
            seen_refs.add(ref)
            validate_reference(skill_root, ref, f"routes.{route}[{index}]", blockers)
            if isinstance(ref, str):
                route_usage[ref] = route_usage.get(ref, 0) + 1

    hot_references = []
    for ref, route_count in sorted(route_usage.items()):
        target = skill_root / ref
        if not target.is_file():
            continue
        size = target.stat().st_size
        if route_count >= HOT_REFERENCE_ROUTE_COUNT:
            hot_references.append({"path": ref, "routes": route_count, "bytes": size})
            if size > HOT_REFERENCE_MAX_BYTES:
                blocker(
                    blockers,
                    "HOT_REFERENCE_OVERSIZE",
                    ref,
                    f"reference is used by {route_count} direct routes and is {size} bytes; split hot references above {HOT_REFERENCE_MAX_BYTES} bytes by decision owner",
                )

    for alias, target in aliases.items():
        if not isinstance(target, str) or not target.strip():
            blocker(blockers, "ALIAS_TARGET_INVALID", f"aliases.{alias}", "alias target must be a non-empty route name")
            continue
        target = target.strip()
        if alias in routes and target == alias:
            redundant_aliases.append(alias)
            continue
        if alias in routes:
            blocker(blockers, "ALIAS_SHADOWS_ROUTE", f"aliases.{alias}", "alias key must not shadow a direct route with different semantics")
        if target == alias:
            blocker(blockers, "ALIAS_SELF_REFERENCE", f"aliases.{alias}", "self alias is valid only when the same canonical direct route exists")
        if target not in routes:
            blocker(blockers, "ALIAS_TARGET_MISSING", f"aliases.{alias}", f"alias target is not a direct route: {target}")

    return {
        "router": str(router_path),
        "core_references": len(core),
        "route_count": len(routes),
        "alias_count": len(aliases),
        "redundant_aliases": sorted(redundant_aliases),
        "hot_reference_route_count": HOT_REFERENCE_ROUTE_COUNT,
        "hot_reference_max_bytes": HOT_REFERENCE_MAX_BYTES,
        "hot_references": sorted(hot_references, key=lambda item: (-item["routes"], -item["bytes"], item["path"])),
        "gate_passed": not blockers,
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate engineering context router integrity and hot-reference context budgets")
    default_skill_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--skill-root", default=str(default_skill_root))
    parser.add_argument("--router")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    skill_root = Path(args.skill_root).resolve()
    router_path = Path(args.router).resolve() if args.router else skill_root / "scripts" / "engineering_context_router.py"
    result = validate(skill_root, router_path)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(f"routes={result['route_count']} aliases={result['alias_count']} core={result['core_references']}")
        if result["redundant_aliases"]:
            print("redundant aliases:", ", ".join(result["redundant_aliases"]))
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
