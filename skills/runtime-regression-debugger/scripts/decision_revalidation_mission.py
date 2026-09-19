#!/usr/bin/env python3
"""Compile an incremental decision revalidation plan into a mission work graph.

Dependency independence is not execution safety. This adapter therefore has two
modes:

- scaffold: expose the dependency-derived task skeleton and the execution
  profiles still required;
- compile: require an explicit write set, risk class, and validation oracle for
  every task before emitting a `work_graph.py` compatible mission.

The adapter does not infer repository write scopes or risk from decision
provenance. Those remain repository/runtime facts and engineering judgment.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

from decision_dependency_graph import validate_graph
from decision_revalidation_plan import validate_plan
from work_graph import RISK_LEVELS, normalize_tasks, topological_order

MISSION_SCHEMA_VERSION = 1


def _require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def _result_change_identity(plan_hash: str, decision_id: str, owner_authority_identity: str) -> str:
    return f"revalidation:{plan_hash}:{decision_id}:{owner_authority_identity}"


def _work_decision_ids(plan: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for decision_id in plan.get("recompute_decision_ids", []):
        if decision_id not in seen:
            seen.add(decision_id)
            out.append(decision_id)
    for wave in plan.get("revalidate_waves", []):
        for decision_id in wave:
            if decision_id not in seen:
                seen.add(decision_id)
                out.append(decision_id)
    return out


def _dependency_ids(graph: dict, decision_id: str, work_ids: set[str], work_by_key: dict[str, str]) -> list[str]:
    nodes = graph["nodes"]
    node = nodes[decision_id]
    deps: list[str] = []
    for exact_dep in node.get("depends_on_decision_ids", []):
        if exact_dep in work_ids:
            target = exact_dep
        else:
            dep_key = nodes[exact_dep]["decision_key"]
            target = work_by_key.get(dep_key)
        if target and target != decision_id and target not in deps:
            deps.append(target)
    return sorted(deps)


def scaffold_revalidation_mission(graph: dict, plan: dict, *, mission: str = "decision-revalidation") -> dict:
    validate_graph(graph)
    validate_plan(plan)
    mission = _require_string(mission, "mission")
    nodes = graph["nodes"]
    work_ids = _work_decision_ids(plan)
    work_set = set(work_ids)
    for decision_id in work_ids:
        if decision_id not in nodes:
            raise ValueError(f"plan references unknown decision: {decision_id}")
    work_by_key = {nodes[decision_id]["decision_key"]: decision_id for decision_id in work_ids}
    recompute = set(plan.get("recompute_decision_ids", []))

    tasks: list[dict] = []
    for decision_id in work_ids:
        node = nodes[decision_id]
        action = "recompute" if decision_id in recompute else "revalidate"
        tasks.append(
            {
                "decision_id": decision_id,
                "decision_key": node["decision_key"],
                "action": action,
                "owner_signal": node["owner_signal"],
                "owner_authority_identity": node["owner_authority_identity"],
                "clause_ids": list(node.get("clause_ids", [])),
                "depends_on_decision_ids": _dependency_ids(graph, decision_id, work_set, work_by_key),
                "required_execution_profile": ["writes", "risk", "validation_oracle"],
                "expected_result_change_identity": _result_change_identity(
                    plan["plan_hash"], decision_id, node["owner_authority_identity"]
                ),
            }
        )

    return {
        "schema_version": MISSION_SCHEMA_VERSION,
        "mission": mission,
        "source_plan_hash": plan["plan_hash"],
        "execution_ready": False,
        "dependency_parallelism_only": True,
        "tasks": tasks,
        "note": "Dependency waves are only candidate parallelism. Compile with repository-derived write sets, risk, and validation oracles before execution.",
    }


def compile_revalidation_mission(
    graph: dict,
    plan: dict,
    profiles: dict[str, dict],
    *,
    mission: str = "decision-revalidation",
) -> dict:
    scaffold = scaffold_revalidation_mission(graph, plan, mission=mission)
    if not isinstance(profiles, dict):
        raise ValueError("profiles must be an object keyed by decision_id")
    expected = {task["decision_id"] for task in scaffold["tasks"]}
    unknown = sorted(set(profiles) - expected)
    if unknown:
        raise ValueError(f"profiles contain non-work decisions: {unknown}")

    compiled: list[dict] = []
    missing: list[str] = []
    for task in scaffold["tasks"]:
        decision_id = task["decision_id"]
        profile = profiles.get(decision_id)
        if not isinstance(profile, dict):
            missing.append(decision_id)
            continue
        writes = profile.get("writes")
        if not isinstance(writes, list) or not writes or not all(isinstance(item, str) and item.strip() for item in writes):
            raise ValueError(f"profile {decision_id}.writes must be a non-empty list of repository-relative paths")
        risk = profile.get("risk")
        if risk not in RISK_LEVELS:
            raise ValueError(f"profile {decision_id}.risk must be one of {', '.join(RISK_LEVELS)}")
        oracle = _require_string(profile.get("validation_oracle"), f"profile {decision_id}.validation_oracle")
        compiled.append(
            {
                "id": f"reval:{decision_id}",
                "title": str(profile.get("title") or f"{task['action']} {task['decision_key']}"),
                "depends_on": [f"reval:{item}" for item in task["depends_on_decision_ids"]],
                "writes": writes,
                "risk": risk,
                "decision_id": decision_id,
                "decision_key": task["decision_key"],
                "action": task["action"],
                "owner_signal": task["owner_signal"],
                "owner_authority_identity": task["owner_authority_identity"],
                "clause_ids": task["clause_ids"],
                "validation_oracle": oracle,
                "source_plan_hash": plan["plan_hash"],
                "expected_result_change_identity": task["expected_result_change_identity"],
            }
        )
    if missing:
        raise ValueError(f"missing execution profiles for decisions: {sorted(missing)}")

    mission_graph = {
        "mission": scaffold["mission"],
        "source_plan_hash": plan["plan_hash"],
        "tasks": compiled,
    }
    normalized = normalize_tasks(mission_graph)
    topological_order(normalized)
    return {
        "schema_version": MISSION_SCHEMA_VERSION,
        "execution_ready": True,
        "dependency_parallelism_only": False,
        "mission_graph": mission_graph,
    }


def _read_json(path: str) -> Any:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("graph")
    parser.add_argument("plan")
    sub = parser.add_subparsers(dest="command", required=True)
    scaffold = sub.add_parser("scaffold")
    scaffold.add_argument("--mission", default="decision-revalidation")
    compile_cmd = sub.add_parser("compile")
    compile_cmd.add_argument("--profiles", required=True)
    compile_cmd.add_argument("--mission", default="decision-revalidation")
    args = parser.parse_args()
    try:
        graph = _read_json(args.graph)
        plan = _read_json(args.plan)
        if args.command == "scaffold":
            payload = scaffold_revalidation_mission(graph, plan, mission=args.mission)
        else:
            payload = compile_revalidation_mission(
                graph,
                plan,
                _read_json(args.profiles),
                mission=args.mission,
            )
    except (OSError, json.JSONDecodeError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
