#!/usr/bin/env python3
"""Deterministic clause/decision provenance graph for selective invalidation.

The graph is a materialized projection of immutable transition receipts. Semantic
`depends_on_decision_ids` edges participate in reverse invalidation. Observational
`observes_decision_ids` edges are provenance links only and never cause invalidation.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import pathlib
import sys
from collections import deque
from typing import Any

GRAPH_SCHEMA_VERSION = 1


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def hash_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def _string_list(value: Any, path: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        item = _require_string(item, f"{path}[{index}]")
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def empty_graph() -> dict:
    return {
        "schema_version": GRAPH_SCHEMA_VERSION,
        "nodes": {},
    }


def graph_hash(graph: dict) -> str:
    validate_graph(graph)
    return hash_json(graph)


def normalize_decision_records(
    value: Any,
    *,
    owner_signal: str,
    owner_authority_identity: str,
    default_clause_ids: list[str] | None = None,
    default_evidence_ids: list[str] | None = None,
) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("decision_records must be a list")
    owner_signal = _require_string(owner_signal, "owner_signal")
    owner_authority_identity = _require_string(owner_authority_identity, "owner_authority_identity")
    defaults_clauses = _string_list(default_clause_ids or [], "default_clause_ids")
    defaults_evidence = _string_list(default_evidence_ids or [], "default_evidence_ids")
    out: list[dict] = []
    seen: set[str] = set()
    for index, raw in enumerate(value):
        path = f"decision_records[{index}]"
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must be an object")
        decision_id = _require_string(raw.get("decision_id"), f"{path}.decision_id")
        if decision_id in seen:
            raise ValueError(f"duplicate decision_id in receipt: {decision_id}")
        seen.add(decision_id)
        decision_key = _require_string(raw.get("decision_key"), f"{path}.decision_key")
        if "semantic_value" not in raw:
            raise ValueError(f"{path}.semantic_value is required")
        semantic_value = copy.deepcopy(raw.get("semantic_value"))
        semantic_hash = hash_json({"decision_key": decision_key, "semantic_value": semantic_value})
        depends_on = _string_list(raw.get("depends_on_decision_ids", []), f"{path}.depends_on_decision_ids")
        observes = _string_list(raw.get("observes_decision_ids", []), f"{path}.observes_decision_ids")
        if decision_id in depends_on or decision_id in observes:
            raise ValueError(f"{path} cannot reference itself")
        replaces = raw.get("replaces_decision_id")
        if replaces is not None:
            replaces = _require_string(replaces, f"{path}.replaces_decision_id")
            if replaces == decision_id:
                raise ValueError(f"{path}.replaces_decision_id cannot equal decision_id")
        clause_ids = _string_list(raw.get("clause_ids", defaults_clauses), f"{path}.clause_ids")
        evidence_ids = _string_list(raw.get("evidence_ids", defaults_evidence), f"{path}.evidence_ids")
        out.append(
            {
                "decision_id": decision_id,
                "decision_key": decision_key,
                "semantic_value": semantic_value,
                "semantic_hash": semantic_hash,
                "owner_signal": owner_signal,
                "owner_authority_identity": owner_authority_identity,
                "clause_ids": clause_ids,
                "evidence_ids": evidence_ids,
                "depends_on_decision_ids": depends_on,
                "observes_decision_ids": observes,
                "replaces_decision_id": replaces,
            }
        )
    return out




def validate_decision_records(records: Any) -> list[dict]:
    if records is None:
        return []
    if not isinstance(records, list):
        raise ValueError("decision_records must be a list")
    out: list[dict] = []
    seen: set[str] = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"decision_records[{index}] must be an object")
        decision_id = _require_string(record.get("decision_id"), f"decision_records[{index}].decision_id")
        if decision_id in seen:
            raise ValueError(f"duplicate decision_id in receipt: {decision_id}")
        seen.add(decision_id)
        decision_key = _require_string(record.get("decision_key"), f"decision_records[{index}].decision_key")
        if "semantic_value" not in record:
            raise ValueError(f"decision_records[{index}].semantic_value is required")
        expected_hash = hash_json({"decision_key": decision_key, "semantic_value": record.get("semantic_value")})
        if record.get("semantic_hash") != expected_hash:
            raise ValueError(f"decision_records[{index}].semantic_hash mismatch")
        _require_string(record.get("owner_signal"), f"decision_records[{index}].owner_signal")
        _require_string(record.get("owner_authority_identity"), f"decision_records[{index}].owner_authority_identity")
        _string_list(record.get("clause_ids", []), f"decision_records[{index}].clause_ids")
        _string_list(record.get("evidence_ids", []), f"decision_records[{index}].evidence_ids")
        _string_list(record.get("depends_on_decision_ids", []), f"decision_records[{index}].depends_on_decision_ids")
        _string_list(record.get("observes_decision_ids", []), f"decision_records[{index}].observes_decision_ids")
        replaces = record.get("replaces_decision_id")
        if replaces is not None:
            _require_string(replaces, f"decision_records[{index}].replaces_decision_id")
        out.append(copy.deepcopy(record))
    return out

def _validate_node(node: Any, path: str) -> dict:
    if not isinstance(node, dict):
        raise ValueError(f"{path} must be an object")
    decision_id = _require_string(node.get("decision_id"), f"{path}.decision_id")
    decision_key = _require_string(node.get("decision_key"), f"{path}.decision_key")
    semantic_hash = _require_string(node.get("semantic_hash"), f"{path}.semantic_hash")
    if "semantic_value" in node:
        expected_hash = hash_json({"decision_key": decision_key, "semantic_value": node.get("semantic_value")})
        if semantic_hash != expected_hash:
            raise ValueError(f"{path}.semantic_hash mismatch")
    _require_string(node.get("owner_signal"), f"{path}.owner_signal")
    _require_string(node.get("owner_authority_identity"), f"{path}.owner_authority_identity")
    _string_list(node.get("clause_ids", []), f"{path}.clause_ids")
    _string_list(node.get("evidence_ids", []), f"{path}.evidence_ids")
    _string_list(node.get("depends_on_decision_ids", []), f"{path}.depends_on_decision_ids")
    _string_list(node.get("observes_decision_ids", []), f"{path}.observes_decision_ids")
    replaces = node.get("replaces_decision_id")
    if replaces is not None:
        _require_string(replaces, f"{path}.replaces_decision_id")
    status = _require_string(node.get("status"), f"{path}.status")
    if status not in {"active", "invalidated", "superseded"}:
        raise ValueError(f"{path}.status is invalid")
    superseded_by = node.get("superseded_by")
    if superseded_by is not None:
        _require_string(superseded_by, f"{path}.superseded_by")
    if node.get("decision_id") != decision_id:
        raise ValueError(f"{path}.decision_id is invalid")
    return node


def validate_graph(graph: Any) -> dict:
    if not isinstance(graph, dict):
        raise ValueError("decision graph must be an object")
    if graph.get("schema_version") != GRAPH_SCHEMA_VERSION:
        raise ValueError(f"decision graph schema_version must be {GRAPH_SCHEMA_VERSION}")
    nodes = graph.get("nodes")
    if not isinstance(nodes, dict):
        raise ValueError("decision graph nodes must be an object")
    active_by_key: dict[str, str] = {}
    for decision_id, node in nodes.items():
        if decision_id != _require_string(decision_id, "decision graph node key"):
            raise ValueError("decision graph node key is invalid")
        _validate_node(node, f"nodes[{decision_id}]")
        if node["decision_id"] != decision_id:
            raise ValueError(f"node key does not match decision_id: {decision_id}")
        for ref in node.get("depends_on_decision_ids", []) + node.get("observes_decision_ids", []):
            if ref not in nodes:
                raise ValueError(f"decision {decision_id} references unknown decision {ref}")
        replaces = node.get("replaces_decision_id")
        if replaces is not None:
            if replaces not in nodes:
                raise ValueError(f"decision {decision_id} replaces unknown decision {replaces}")
            if nodes[replaces].get("decision_key") != node.get("decision_key"):
                raise ValueError(f"decision {decision_id} must replace the same decision_key")
        if node["status"] == "active":
            key = node["decision_key"]
            if key in active_by_key:
                raise ValueError(f"multiple active decisions share decision_key {key}")
            active_by_key[key] = decision_id
        if node["status"] == "superseded":
            target = node.get("superseded_by")
            if not target or target not in nodes:
                raise ValueError(f"superseded decision {decision_id} must name superseded_by")

    # Only semantic dependencies participate in the DAG and must be acyclic.
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(decision_id: str) -> None:
        if decision_id in visited:
            return
        if decision_id in visiting:
            raise ValueError(f"semantic decision dependency cycle detected at {decision_id}")
        visiting.add(decision_id)
        for dep in nodes[decision_id].get("depends_on_decision_ids", []):
            visit(dep)
        visiting.remove(decision_id)
        visited.add(decision_id)

    for decision_id in nodes:
        visit(decision_id)
    return graph


def apply_changes(
    graph: dict,
    *,
    decision_records: list[dict] | None = None,
    invalidated_decision_ids: list[str] | None = None,
) -> dict:
    validate_graph(graph)
    result = copy.deepcopy(graph)
    nodes = result["nodes"]
    records = copy.deepcopy(decision_records or [])
    invalidated = _string_list(invalidated_decision_ids or [], "invalidated_decision_ids")

    # Insert first so same-receipt dependencies can resolve, then validate statuses.
    for record in records:
        decision_id = _require_string(record.get("decision_id"), "decision_record.decision_id")
        if decision_id in nodes:
            raise ValueError(f"decision_id already exists: {decision_id}")
        node = copy.deepcopy(record)
        # The immutable receipt retains semantic_value; the materialized graph
        # stores only its hash so owner-state stays compact over long missions.
        node.pop("semantic_value", None)
        node["status"] = "active"
        node["superseded_by"] = None
        nodes[decision_id] = node

    for record in records:
        decision_id = record["decision_id"]
        replaces = record.get("replaces_decision_id")
        if replaces is not None:
            if replaces not in nodes:
                raise ValueError(f"decision {decision_id} replaces unknown decision {replaces}")
            prior = nodes[replaces]
            if prior.get("decision_key") != record.get("decision_key"):
                raise ValueError(f"decision {decision_id} must replace the same decision_key")
            if prior.get("status") not in {"active", "invalidated"}:
                raise ValueError(f"decision {decision_id} can only replace an active or invalidated decision")
            prior["status"] = "superseded"
            prior["superseded_by"] = decision_id

    # New decisions must be based on currently valid semantic inputs. Existing
    # dependents may remain active across an invalidation only when the caller
    # computed the invalidation closure with an explicit preservation barrier.
    for record in records:
        decision_id = record["decision_id"]
        for dep in nodes[decision_id].get("depends_on_decision_ids", []):
            if nodes[dep].get("status") != "active":
                raise ValueError(f"new decision {decision_id} depends on non-active decision {dep}")

    for decision_id in invalidated:
        if decision_id not in nodes:
            raise ValueError(f"cannot invalidate unknown decision {decision_id}")
        node = nodes[decision_id]
        if node.get("status") != "active":
            raise ValueError(f"cannot invalidate non-active decision {decision_id}")
        node["status"] = "invalidated"

    validate_graph(result)
    return result


def reverse_affected_closure(graph: dict, stale_decision_ids: list[str], *, preserved_decision_ids: list[str] | None = None) -> list[str]:
    validate_graph(graph)
    stale = _string_list(stale_decision_ids, "stale_decision_ids")
    preserved = set(_string_list(preserved_decision_ids or [], "preserved_decision_ids"))
    nodes = graph["nodes"]
    if not stale:
        raise ValueError("stale_decision_ids must not be empty")
    for decision_id in stale:
        if decision_id not in nodes or nodes[decision_id].get("status") != "active":
            raise ValueError(f"stale decision must be active: {decision_id}")
    if set(stale) & preserved:
        raise ValueError("stale decisions cannot be preserved")
    for decision_id in preserved:
        if decision_id not in nodes or nodes[decision_id].get("status") != "active":
            raise ValueError(f"preserved decision must be active: {decision_id}")

    # Exact decision ids preserve historical provenance, but invalidation
    # propagates by the stable logical decision_key. A dependent that was
    # preserved across D@1 -> D@2 must still be reconsidered if D@2 changes
    # later, even though its immutable provenance still names D@1.
    reverse_by_key: dict[str, list[str]] = {}
    for decision_id, node in nodes.items():
        if node.get("status") != "active":
            continue
        for dep in node.get("depends_on_decision_ids", []):
            dep_key = nodes[dep].get("decision_key")
            reverse_by_key.setdefault(dep_key, []).append(decision_id)

    affected: list[str] = []
    seen: set[str] = set()
    queue: deque[str] = deque(stale)
    while queue:
        decision_id = queue.popleft()
        if decision_id in seen:
            continue
        seen.add(decision_id)
        affected.append(decision_id)
        decision_key = nodes[decision_id].get("decision_key")
        for dependent in reverse_by_key.get(decision_key, []):
            if dependent in preserved:
                continue
            queue.append(dependent)
    return affected


def authorities_for_decisions(graph: dict, decision_ids: list[str]) -> list[str]:
    validate_graph(graph)
    out: list[str] = []
    seen: set[str] = set()
    for decision_id in decision_ids:
        node = graph["nodes"].get(decision_id)
        if node is None:
            raise ValueError(f"unknown decision: {decision_id}")
        authority = node["owner_authority_identity"]
        if authority not in seen:
            seen.add(authority)
            out.append(authority)
    return out


def replay_receipts(receipts: list[dict]) -> dict:
    graph = empty_graph()
    for index, receipt in enumerate(receipts, 1):
        graph = apply_changes(
            graph,
            decision_records=receipt.get("decision_records", []),
            invalidated_decision_ids=receipt.get("invalidated_decision_ids", []),
        )
        expected = receipt.get("decision_graph_hash_after")
        actual = graph_hash(graph)
        if expected is not None and expected != actual:
            raise ValueError(f"receipt {index} decision graph hash mismatch")
    return graph


def graph_summary(graph: dict) -> dict:
    validate_graph(graph)
    active = []
    invalidated = []
    superseded = []
    by_clause: dict[str, list[str]] = {}
    for decision_id, node in graph["nodes"].items():
        status = node["status"]
        (active if status == "active" else invalidated if status == "invalidated" else superseded).append(decision_id)
        for clause_id in node.get("clause_ids", []):
            by_clause.setdefault(clause_id, []).append(decision_id)
    return {
        "graph_hash": graph_hash(graph),
        "node_count": len(graph["nodes"]),
        "active_decision_ids": active,
        "invalidated_decision_ids": invalidated,
        "superseded_decision_ids": superseded,
        "decisions_by_clause": by_clause,
    }


def _read_json(path: str) -> Any:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("graph")
    affected = sub.add_parser("affected")
    affected.add_argument("graph")
    affected.add_argument("--stale", required=True)
    affected.add_argument("--preserve", default="")
    args = parser.parse_args()
    try:
        graph = _read_json(args.graph)
        if args.command == "verify":
            payload = {"status": "pass", **graph_summary(graph)}
        else:
            stale = [item.strip() for item in args.stale.split(",") if item.strip()]
            preserved = [item.strip() for item in args.preserve.split(",") if item.strip()]
            payload = {
                "status": "pass",
                "affected_decision_ids": reverse_affected_closure(graph, stale, preserved_decision_ids=preserved),
            }
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
