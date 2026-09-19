#!/usr/bin/env python3
"""Converge incremental decision revalidation worker results safely.

The gate classifies a result against an immutable revalidation plan as:

- green: fresh proof says the decision's semantic output is unchanged;
- red: fresh proof says the semantic output changed, but downstream work remains
  blocked until a replacement decision is committed to the decision graph;
- pending: proof/dependency prerequisites are not sufficient yet;
- stale-plan: the result is bound to a different plan/task authority.

This is a metadata/state gate. It cannot determine whether a worker's declared
semantic output is truthful. The proof bundle and repository/runtime evidence still
require engineering judgment.
"""
from __future__ import annotations

import argparse
import copy
import json
import pathlib
import sys
from typing import Any

from decision_dependency_graph import graph_hash, hash_json, validate_graph
from decision_revalidation_mission import scaffold_revalidation_mission
from decision_revalidation_plan import validate_plan
from proof_bundle_gate import validate_bundle

RESULT_SESSION_SCHEMA_VERSION = 1


def _require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def expected_result_change_identity(plan_hash: str, decision_id: str, owner_authority_identity: str) -> str:
    return f"revalidation:{plan_hash}:{decision_id}:{owner_authority_identity}"


def _session_hash_payload(session: dict) -> dict:
    payload = copy.deepcopy(session)
    payload.pop("session_hash", None)
    return payload


def _seal(session: dict) -> dict:
    session["ready_decision_ids"] = sorted(
        decision_id for decision_id, task in session["tasks"].items() if task["status"] == "ready"
    )
    session["pending_commit_decision_ids"] = sorted(
        decision_id for decision_id, task in session["tasks"].items() if task["status"] == "red-awaiting-commit"
    )
    session["terminal_decision_ids"] = sorted(
        decision_id
        for decision_id, task in session["tasks"].items()
        if task["status"] in {"green", "red", "pruned"}
    )
    session["completed"] = len(session["terminal_decision_ids"]) == len(session["tasks"])
    session["session_hash"] = hash_json(_session_hash_payload(session))
    return session


def validate_session(session: Any) -> dict:
    if not isinstance(session, dict):
        raise ValueError("revalidation result session must be an object")
    if session.get("schema_version") != RESULT_SESSION_SCHEMA_VERSION:
        raise ValueError(f"session schema_version must be {RESULT_SESSION_SCHEMA_VERSION}")
    _require_string(session.get("source_plan_hash"), "session.source_plan_hash")
    _require_string(session.get("source_graph_hash"), "session.source_graph_hash")
    _require_string(session.get("latest_graph_hash"), "session.latest_graph_hash")
    tasks = session.get("tasks")
    if not isinstance(tasks, dict):
        raise ValueError("session.tasks must be an object")
    valid_statuses = {"blocked", "ready", "green", "red-awaiting-commit", "red", "pruned"}
    for decision_id, task in tasks.items():
        if not isinstance(task, dict):
            raise ValueError(f"session.tasks[{decision_id}] must be an object")
        if task.get("decision_id") != decision_id:
            raise ValueError(f"session task key mismatch: {decision_id}")
        if task.get("status") not in valid_statuses:
            raise ValueError(f"session task status invalid: {decision_id}")
        _require_string(task.get("decision_key"), f"session.tasks[{decision_id}].decision_key")
        _require_string(task.get("owner_authority_identity"), f"session.tasks[{decision_id}].owner_authority_identity")
        _require_string(task.get("original_semantic_hash"), f"session.tasks[{decision_id}].original_semantic_hash")
        deps = task.get("depends_on_decision_ids", [])
        if not isinstance(deps, list) or not all(isinstance(dep, str) and dep for dep in deps):
            raise ValueError(f"session.tasks[{decision_id}].depends_on_decision_ids must be a string list")
        dependency_keys = task.get("dependency_keys", [])
        if not isinstance(dependency_keys, list) or not all(isinstance(key, str) and key for key in dependency_keys):
            raise ValueError(f"session.tasks[{decision_id}].dependency_keys must be a string list")
        for dep in deps:
            if dep not in tasks:
                raise ValueError(f"session task {decision_id} references unknown work dependency {dep}")
    supplied_hash = session.get("session_hash")
    expected_hash = hash_json(_session_hash_payload(session))
    if supplied_hash != expected_hash:
        raise ValueError("revalidation result session hash mismatch")
    return session


def initialize_result_session(graph: dict, plan: dict) -> dict:
    validate_graph(graph)
    validate_plan(plan)
    scaffold = scaffold_revalidation_mission(graph, plan)
    tasks: dict[str, dict] = {}
    for raw in scaffold["tasks"]:
        decision_id = raw["decision_id"]
        node = graph["nodes"][decision_id]
        tasks[decision_id] = {
            "decision_id": decision_id,
            "decision_key": node["decision_key"],
            "action": raw["action"],
            "owner_signal": node["owner_signal"],
            "owner_authority_identity": node["owner_authority_identity"],
            "original_semantic_hash": node["semantic_hash"],
            "depends_on_decision_ids": list(raw["depends_on_decision_ids"]),
            "dependency_keys": sorted(
                graph["nodes"][dep]["decision_key"] for dep in node.get("depends_on_decision_ids", [])
            ),
            "status": "blocked" if raw["depends_on_decision_ids"] else "ready",
            "classification": None,
            "result_hash": None,
            "observed_semantic_hash": None,
            "committed_replacement_decision_id": None,
        }
    session = {
        "schema_version": RESULT_SESSION_SCHEMA_VERSION,
        "source_plan_hash": plan["plan_hash"],
        "source_graph_hash": graph_hash(graph),
        "latest_graph_hash": graph_hash(graph),
        "tasks": tasks,
    }
    return _seal(session)


def _result_hash(result: dict) -> str:
    return hash_json(result)


def _proof_verdict(result: dict, expected_identity: str, *, now=None) -> tuple[dict | None, list[str]]:
    proof = result.get("proof_bundle")
    if not isinstance(proof, dict):
        return None, ["missing_proof_bundle"]
    try:
        verdict = validate_bundle(proof, now=now)
    except ValueError as exc:
        return None, [f"invalid_proof_bundle:{exc}"]
    blockers: list[str] = []
    if verdict["change_identity"] != expected_identity:
        blockers.append("proof_change_identity_mismatch")
    if not verdict["gate_passed"]:
        blockers.extend(f"proof:{item}" for item in verdict["blockers"])
    return verdict, blockers


def _propagate(session: dict) -> tuple[list[str], list[str]]:
    """Unlock dirty dependents and prune clean branches to a fixed point."""
    unlocked: list[str] = []
    pruned: list[str] = []
    changed = True
    while changed:
        changed = False
        for decision_id in sorted(session["tasks"]):
            task = session["tasks"][decision_id]
            if task["status"] != "blocked":
                continue
            deps = [session["tasks"][dep] for dep in task["depends_on_decision_ids"]]
            if not deps:
                task["status"] = "ready"
                unlocked.append(decision_id)
                changed = True
                continue
            if not all(dep["status"] in {"green", "red", "pruned"} for dep in deps):
                continue
            if task.get("action") == "recompute" or any(dep["status"] == "red" for dep in deps):
                task["status"] = "ready"
                unlocked.append(decision_id)
            else:
                task["status"] = "pruned"
                task["classification"] = "green"
                task["result_hash"] = "change-pruned"
                pruned.append(decision_id)
            changed = True
    return unlocked, pruned


def evaluate_result(session: dict, result: dict, *, now=None) -> dict:
    validate_session(session)
    if not isinstance(result, dict):
        raise ValueError("worker result must be an object")
    next_session = copy.deepcopy(session)
    blockers: list[str] = []

    source_plan_hash = result.get("source_plan_hash")
    if source_plan_hash != session["source_plan_hash"]:
        return {
            "classification": "stale-plan",
            "blockers": ["source_plan_hash_mismatch"],
            "next_session": None,
        }
    decision_id = result.get("decision_id")
    if not isinstance(decision_id, str) or decision_id not in session["tasks"]:
        return {"classification": "stale-plan", "blockers": ["decision_not_in_plan"], "next_session": None}
    task = next_session["tasks"][decision_id]
    if result.get("owner_authority_identity") != task["owner_authority_identity"]:
        return {"classification": "stale-plan", "blockers": ["owner_authority_mismatch"], "next_session": None}

    incoming_hash = _result_hash(result)
    if task["status"] in {"green", "red", "pruned"}:
        if task.get("result_hash") == incoming_hash:
            return {
                "classification": task["classification"] or ("green" if task["status"] != "red" else "red"),
                "blockers": [],
                "idempotent_replay": True,
                "next_session": session,
            }
        return {"classification": "stale-plan", "blockers": ["task_already_converged"], "next_session": None}
    if task["status"] == "red-awaiting-commit":
        return {"classification": "pending", "blockers": ["replacement_commit_required"], "next_session": session}
    if task["status"] != "ready":
        return {"classification": "pending", "blockers": ["dependencies_not_converged"], "next_session": session}

    expected_identity = expected_result_change_identity(
        session["source_plan_hash"], decision_id, task["owner_authority_identity"]
    )
    proof_verdict, proof_blockers = _proof_verdict(result, expected_identity, now=now)
    if proof_blockers:
        return {
            "classification": "pending",
            "blockers": sorted(set(proof_blockers)),
            "proof": proof_verdict,
            "next_session": session,
        }
    if "semantic_value" not in result:
        return {
            "classification": "pending",
            "blockers": ["semantic_value_required"],
            "proof": proof_verdict,
            "next_session": session,
        }

    observed_hash = hash_json({"decision_key": task["decision_key"], "semantic_value": result["semantic_value"]})
    task["observed_semantic_hash"] = observed_hash
    task["result_hash"] = incoming_hash
    task["proof_change_identity"] = expected_identity
    if observed_hash == task["original_semantic_hash"]:
        task["status"] = "green"
        task["classification"] = "green"
        unlocked, pruned = _propagate(next_session)
        _seal(next_session)
        return {
            "classification": "green",
            "blockers": [],
            "proof": proof_verdict,
            "unlocked_decision_ids": unlocked,
            "pruned_decision_ids": pruned,
            "next_session": next_session,
            "note": "Semantic output is declared unchanged; downstream work is pruned unless another dirty dependency still reaches it.",
        }

    task["status"] = "red-awaiting-commit"
    task["classification"] = "red"
    _seal(next_session)
    return {
        "classification": "red",
        "blockers": ["replacement_decision_must_be_committed_before_downstream_unlock"],
        "proof": proof_verdict,
        "replacement_required": True,
        "observed_semantic_hash": observed_hash,
        "replacement_dependency_keys": list(task.get("dependency_keys", [])),
        "next_session": next_session,
        "note": "Semantic output changed. The result is red, but downstream work stays blocked until the replacement decision is committed to the authoritative decision graph.",
    }


def commit_red_result(session: dict, decision_id: str, updated_graph: dict, replacement_decision_id: str) -> dict:
    validate_session(session)
    validate_graph(updated_graph)
    decision_id = _require_string(decision_id, "decision_id")
    replacement_decision_id = _require_string(replacement_decision_id, "replacement_decision_id")
    if decision_id not in session["tasks"]:
        raise ValueError("decision_id is not part of this revalidation session")
    next_session = copy.deepcopy(session)
    task = next_session["tasks"][decision_id]
    if task["status"] != "red-awaiting-commit":
        raise ValueError("decision is not awaiting a red replacement commit")
    nodes = updated_graph["nodes"]
    replacement = nodes.get(replacement_decision_id)
    original = nodes.get(decision_id)
    if replacement is None or original is None:
        raise ValueError("updated graph must contain both original and replacement decisions")
    if replacement.get("status") != "active":
        raise ValueError("replacement decision must be active")
    if original.get("status") != "superseded":
        raise ValueError("original decision must be superseded by the committed replacement")
    if replacement.get("replaces_decision_id") != decision_id or original.get("superseded_by") != replacement_decision_id:
        raise ValueError("replacement/original supersession linkage mismatch")
    if replacement.get("decision_key") != task["decision_key"]:
        raise ValueError("replacement decision_key mismatch")
    replacement_dependency_keys = sorted(
        nodes[dep]["decision_key"] for dep in replacement.get("depends_on_decision_ids", [])
    )
    if replacement_dependency_keys != sorted(task.get("dependency_keys", [])):
        raise ValueError("replacement dependency topology changed; build a fresh revalidation plan")
    if any(nodes[dep].get("status") != "active" for dep in replacement.get("depends_on_decision_ids", [])):
        raise ValueError("replacement dependencies must resolve to active decision versions")
    if replacement.get("semantic_hash") != task.get("observed_semantic_hash"):
        raise ValueError("replacement semantic hash does not match the red worker result")

    task["status"] = "red"
    task["committed_replacement_decision_id"] = replacement_decision_id
    next_session["latest_graph_hash"] = graph_hash(updated_graph)
    unlocked, pruned = _propagate(next_session)
    _seal(next_session)
    return {
        "classification": "red",
        "replacement_committed": True,
        "unlocked_decision_ids": unlocked,
        "pruned_decision_ids": pruned,
        "next_session": next_session,
    }


def _read_json(path: str) -> dict:
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} root must be an object")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("graph")
    init.add_argument("plan")
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("session")
    evaluate.add_argument("result")
    commit = sub.add_parser("commit-red")
    commit.add_argument("session")
    commit.add_argument("graph")
    commit.add_argument("--decision", required=True)
    commit.add_argument("--replacement", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init":
            payload = initialize_result_session(_read_json(args.graph), _read_json(args.plan))
        elif args.command == "evaluate":
            payload = evaluate_result(_read_json(args.session), _read_json(args.result))
        else:
            payload = commit_red_result(
                _read_json(args.session), args.decision, _read_json(args.graph), args.replacement
            )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
