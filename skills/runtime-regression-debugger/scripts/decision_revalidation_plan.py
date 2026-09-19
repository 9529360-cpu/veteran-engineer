#!/usr/bin/env python3
"""Plan minimal decision recomputation/revalidation from provenance.

This module turns the immutable decision dependency graph into an execution plan.
It does not decide whether evidence is semantically sufficient. Instead it classifies
work after one or more decisions become stale:

- stale roots must be recomputed/replaced;
- semantic dependents are revalidated in dependency waves;
- proof-backed preservation barriers prune downstream work;
- semantically equivalent replacements prune propagation mechanically;
- unaffected decisions remain reusable.

The plan is advisory execution metadata. Owner-transition authority remains in
``owner_transition_gate.py`` and proof sufficiency remains an engineering judgment.
"""
from __future__ import annotations

import argparse
import copy
import json
import pathlib
import sys
from collections import deque
from typing import Any

from decision_dependency_graph import (
    canonical_json,
    hash_json,
    normalize_decision_records,
    reverse_affected_closure,
    validate_decision_records,
    validate_graph,
)

PLAN_SCHEMA_VERSION = 1


def _string_list(value: Any, path: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{path}[{index}] must be a non-empty string")
        item = item.strip()
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _active_nodes(graph: dict) -> dict[str, dict]:
    return {
        decision_id: node
        for decision_id, node in graph["nodes"].items()
        if node.get("status") == "active"
    }


def _reverse_by_key(graph: dict) -> dict[str, list[str]]:
    nodes = graph["nodes"]
    reverse: dict[str, list[str]] = {}
    for decision_id, node in _active_nodes(graph).items():
        for dep_id in node.get("depends_on_decision_ids", []):
            dep_key = nodes[dep_id]["decision_key"]
            reverse.setdefault(dep_key, []).append(decision_id)
    for rows in reverse.values():
        rows.sort()
    return reverse


def _waves(graph: dict, roots: list[str], allowed: set[str]) -> list[list[str]]:
    """Return deterministic reverse-dependency waves starting after roots."""
    if not roots:
        return []
    nodes = graph["nodes"]
    reverse = _reverse_by_key(graph)
    distance: dict[str, int] = {decision_id: 0 for decision_id in roots}
    queue: deque[str] = deque(roots)
    while queue:
        current = queue.popleft()
        current_distance = distance[current]
        current_key = nodes[current]["decision_key"]
        for dependent in reverse.get(current_key, []):
            if dependent not in allowed:
                continue
            candidate_distance = current_distance + 1
            previous = distance.get(dependent)
            if previous is None or candidate_distance < previous:
                distance[dependent] = candidate_distance
                queue.append(dependent)
    grouped: dict[int, list[str]] = {}
    for decision_id, value in distance.items():
        if value <= 0 or decision_id not in allowed:
            continue
        grouped.setdefault(value, []).append(decision_id)
    return [sorted(grouped[index]) for index in sorted(grouped)]




def _reason_paths(graph: dict, roots: list[str], targets: set[str]) -> dict[str, list[str]]:
    """Return one deterministic shortest semantic-dependency path per target."""
    if not roots or not targets:
        return {}
    nodes = graph["nodes"]
    reverse = _reverse_by_key(graph)
    queue: deque[str] = deque(roots)
    paths: dict[str, list[str]] = {decision_id: [decision_id] for decision_id in roots}
    while queue:
        current = queue.popleft()
        current_key = nodes[current]["decision_key"]
        for dependent in reverse.get(current_key, []):
            candidate = paths[current] + [dependent]
            prior = paths.get(dependent)
            if prior is None or (len(candidate), candidate) < (len(prior), prior):
                paths[dependent] = candidate
                queue.append(dependent)
    return {decision_id: paths[decision_id] for decision_id in sorted(targets) if decision_id in paths}

def _normalize_replacements(graph: dict, replacement_records: Any) -> dict[str, dict]:
    if replacement_records is None:
        return {}
    records = validate_decision_records(replacement_records)
    nodes = graph["nodes"]
    by_old: dict[str, dict] = {}
    for record in records:
        old_id = record.get("replaces_decision_id")
        if not old_id:
            raise ValueError("replacement_records must name replaces_decision_id")
        if old_id not in nodes:
            raise ValueError(f"replacement references unknown decision: {old_id}")
        if old_id in by_old:
            raise ValueError(f"multiple replacements supplied for decision: {old_id}")
        if record["decision_key"] != nodes[old_id]["decision_key"]:
            raise ValueError(f"replacement decision_key mismatch for {old_id}")
        by_old[old_id] = copy.deepcopy(record)
    return by_old


def _owner_worksets(graph: dict, recompute: list[str], revalidate_waves: list[list[str]]) -> list[dict]:
    nodes = graph["nodes"]
    ordered_actions: list[tuple[str, str, int]] = []
    for decision_id in recompute:
        ordered_actions.append((decision_id, "recompute", 0))
    for wave_index, wave in enumerate(revalidate_waves, 1):
        for decision_id in wave:
            ordered_actions.append((decision_id, "revalidate", wave_index))

    buckets: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []
    for decision_id, action, wave in ordered_actions:
        node = nodes[decision_id]
        key = (node["owner_signal"], node["owner_authority_identity"])
        if key not in buckets:
            order.append(key)
            buckets[key] = {
                "owner_signal": key[0],
                "owner_authority_identity": key[1],
                "recompute_decision_ids": [],
                "revalidate_decision_ids": [],
                "first_wave": wave,
            }
        bucket = buckets[key]
        if action == "recompute":
            bucket["recompute_decision_ids"].append(decision_id)
        else:
            bucket["revalidate_decision_ids"].append(decision_id)
        bucket["first_wave"] = min(bucket["first_wave"], wave)
    return [buckets[key] for key in order]


def build_revalidation_plan(
    graph: dict,
    stale_decision_ids: list[str],
    *,
    preserved_decision_ids: list[str] | None = None,
    replacement_records: list[dict] | None = None,
) -> dict:
    """Build a minimal incremental revalidation plan.

    Equivalent replacements are detected by semantic hash. A stale root with an
    explicitly supplied replacement whose semantic hash is unchanged is still
    replaced, but it does not dirty semantic dependents. Changed or unresolved
    roots propagate to dependent decisions. Preservation barriers require proof
    outside this function and prune propagation exactly like the owner gate.
    """
    validate_graph(graph)
    stale = _string_list(stale_decision_ids, "stale_decision_ids")
    if not stale:
        raise ValueError("stale_decision_ids must not be empty")
    preserved = _string_list(preserved_decision_ids or [], "preserved_decision_ids")
    nodes = graph["nodes"]
    for decision_id in stale:
        if decision_id not in nodes or nodes[decision_id].get("status") != "active":
            raise ValueError(f"stale decision must be active: {decision_id}")
    if set(stale) & set(preserved):
        raise ValueError("stale decisions cannot be preservation barriers")

    replacements = _normalize_replacements(graph, replacement_records)
    unknown_replacements = sorted(set(replacements) - set(stale))
    if unknown_replacements:
        raise ValueError(f"replacement supplied for non-stale decision(s): {unknown_replacements}")

    equivalent_roots: list[str] = []
    changed_or_unresolved_roots: list[str] = []
    root_actions: list[dict] = []
    for decision_id in stale:
        replacement = replacements.get(decision_id)
        if replacement is not None and replacement["semantic_hash"] == nodes[decision_id]["semantic_hash"]:
            equivalent_roots.append(decision_id)
            classification = "replace-equivalent"
        else:
            changed_or_unresolved_roots.append(decision_id)
            classification = "replace-changed" if replacement is not None else "recompute"
        root_actions.append(
            {
                "decision_id": decision_id,
                "decision_key": nodes[decision_id]["decision_key"],
                "owner_signal": nodes[decision_id]["owner_signal"],
                "owner_authority_identity": nodes[decision_id]["owner_authority_identity"],
                "action": classification,
                "replacement_decision_id": replacement.get("decision_id") if replacement else None,
            }
        )

    full_affected: list[str] = []
    effective_affected: list[str] = []
    if changed_or_unresolved_roots:
        full_affected = reverse_affected_closure(graph, changed_or_unresolved_roots)
        unrelated_preserved = [decision_id for decision_id in preserved if decision_id not in set(full_affected)]
        if unrelated_preserved:
            raise ValueError(f"preservation barriers are outside affected closure: {unrelated_preserved}")
        effective_affected = reverse_affected_closure(
            graph,
            changed_or_unresolved_roots,
            preserved_decision_ids=preserved,
        )
    elif preserved:
        raise ValueError("preservation barriers are unnecessary when every stale replacement is equivalent")

    effective_set = set(effective_affected)
    root_set = set(changed_or_unresolved_roots)
    revalidate_set = effective_set - root_set
    revalidate_waves = _waves(graph, changed_or_unresolved_roots, revalidate_set)
    revalidation_reason_paths = _reason_paths(graph, changed_or_unresolved_roots, revalidate_set)

    full_set = set(full_affected)
    preserved_set = set(preserved)
    pruned_descendants = sorted(full_set - effective_set - preserved_set)
    active_ids = set(_active_nodes(graph))
    reuse_unaffected = sorted(active_ids - full_set - set(stale))
    reuse_change_pruned = sorted(preserved_set | set(pruned_descendants))

    worksets = _owner_worksets(graph, changed_or_unresolved_roots, revalidate_waves)
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "stale_decision_ids": stale,
        "root_actions": root_actions,
        "recompute_decision_ids": changed_or_unresolved_roots,
        "revalidate_waves": revalidate_waves,
        "revalidation_reason_paths": revalidation_reason_paths,
        "preservation_barrier_decision_ids": preserved,
        "change_pruned_root_decision_ids": equivalent_roots,
        "pruned_downstream_decision_ids": pruned_descendants,
        "reuse_change_pruned_decision_ids": reuse_change_pruned,
        "reuse_unaffected_decision_ids": reuse_unaffected,
        "owner_worksets": worksets,
        "full_affected_decision_ids": full_affected,
        "effective_affected_decision_ids": effective_affected,
    }
    plan["plan_hash"] = hash_json(plan)
    return plan


def validate_plan(plan: Any) -> dict:
    if not isinstance(plan, dict):
        raise ValueError("impact plan must be an object")
    if plan.get("schema_version") != PLAN_SCHEMA_VERSION:
        raise ValueError(f"impact plan schema_version must be {PLAN_SCHEMA_VERSION}")
    expected = copy.deepcopy(plan)
    supplied_hash = expected.pop("plan_hash", None)
    if supplied_hash != hash_json(expected):
        raise ValueError("impact plan hash mismatch")
    return plan


def _read_json(path: str) -> Any:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("graph")
    parser.add_argument("--stale", required=True)
    parser.add_argument("--preserve", default="")
    parser.add_argument("--replacements")
    args = parser.parse_args()
    try:
        graph = _read_json(args.graph)
        stale = [item.strip() for item in args.stale.split(",") if item.strip()]
        preserved = [item.strip() for item in args.preserve.split(",") if item.strip()]
        replacements = _read_json(args.replacements) if args.replacements else None
        plan = build_revalidation_plan(
            graph,
            stale,
            preserved_decision_ids=preserved,
            replacement_records=replacements,
        )
        validate_plan(plan)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(plan, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
