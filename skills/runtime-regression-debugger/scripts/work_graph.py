#!/usr/bin/env python3
"""Validate and plan dependency-aware engineering mission waves.

Input JSON shape:
{
  "mission": "optional label",
  "tasks": [
    {
      "id": "T1",
      "title": "Freeze API contract",
      "depends_on": [],
      "writes": ["api/schema.json"],
      "risk": "high"
    }
  ]
}

Commands:
  work_graph.py mission.json validate
  work_graph.py mission.json plan [--allow-high-risk-parallel]
  work_graph.py mission.json ready --completed T1,T2
  work_graph.py mission.json conflicts

This is a conservative planning aid. It cannot prove that predicted write sets are
complete or that tasks are semantically independent.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import posixpath
import sys
from collections import defaultdict

RISK_LEVELS = {"low": 0, "medium": 1, "high": 2, "consequential": 3}


def load_graph(path: pathlib.Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read graph: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("graph root must be an object")
    tasks = data.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise RuntimeError("graph must contain a non-empty tasks array")
    return data


def norm_path(value: str) -> str:
    value = value.replace("\\", "/").strip()
    if not value:
        raise RuntimeError("write paths must not be empty")
    if value.startswith("/") or (len(value) >= 2 and value[0].isalpha() and value[1] == ":"):
        raise RuntimeError("write paths must be repository-relative")
    value = posixpath.normpath(value)
    if value == ".":
        raise RuntimeError("write paths must not normalize to '.'")
    if value == ".." or value.startswith("../"):
        raise RuntimeError("write paths must stay within repository")
    return value


def normalize_tasks(data: dict) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for index, raw in enumerate(data["tasks"], start=1):
        if not isinstance(raw, dict):
            raise RuntimeError(f"task #{index} must be an object")
        task_id = raw.get("id")
        if not isinstance(task_id, str) or not task_id.strip():
            raise RuntimeError(f"task #{index} needs a non-empty string id")
        task_id = task_id.strip()
        if task_id in result:
            raise RuntimeError(f"duplicate task id: {task_id}")
        deps = raw.get("depends_on", [])
        if not isinstance(deps, list) or not all(isinstance(item, str) and item.strip() for item in deps):
            raise RuntimeError(f"task {task_id}: depends_on must be an array of task ids")
        writes = raw.get("writes", [])
        if not isinstance(writes, list) or not all(isinstance(item, str) for item in writes):
            raise RuntimeError(f"task {task_id}: writes must be an array of paths")
        risk = raw.get("risk", "medium")
        if risk not in RISK_LEVELS:
            raise RuntimeError(
                f"task {task_id}: risk must be one of {', '.join(RISK_LEVELS)}"
            )
        result[task_id] = {
            **raw,
            "id": task_id,
            "title": str(raw.get("title") or task_id),
            "depends_on": [item.strip() for item in deps],
            "writes": sorted(set(norm_path(item) for item in writes)),
            "risk": risk,
        }

    ids = set(result)
    for task in result.values():
        unknown = [dep for dep in task["depends_on"] if dep not in ids]
        if unknown:
            raise RuntimeError(f"task {task['id']}: unknown dependencies: {', '.join(unknown)}")
        if task["id"] in task["depends_on"]:
            raise RuntimeError(f"task {task['id']}: cannot depend on itself")
    return result


def topological_order(tasks: dict[str, dict]) -> list[str]:
    indegree = {task_id: 0 for task_id in tasks}
    children: dict[str, list[str]] = defaultdict(list)
    for task in tasks.values():
        for dep in task["depends_on"]:
            indegree[task["id"]] += 1
            children[dep].append(task["id"])
    ready = sorted(task_id for task_id, degree in indegree.items() if degree == 0)
    order: list[str] = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        for child in sorted(children[current]):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)
                ready.sort()
    if len(order) != len(tasks):
        stuck = sorted(task_id for task_id, degree in indegree.items() if degree > 0)
        raise RuntimeError("dependency cycle detected involving: " + ", ".join(stuck))
    return order


def path_conflict(a: str, b: str) -> bool:
    if a == b:
        return True
    a_prefix = a.rstrip("/") + "/"
    b_prefix = b.rstrip("/") + "/"
    return a.startswith(b_prefix) or b.startswith(a_prefix)


def task_conflicts(a: dict, b: dict) -> list[tuple[str, str]]:
    hits = []
    for left in a["writes"]:
        for right in b["writes"]:
            if path_conflict(left, right):
                hits.append((left, right))
    return hits


def all_conflicts(tasks: dict[str, dict]) -> list[dict]:
    ids = sorted(tasks)
    rows = []
    for index, left_id in enumerate(ids):
        for right_id in ids[index + 1 :]:
            hits = task_conflicts(tasks[left_id], tasks[right_id])
            if hits:
                rows.append({
                    "left": left_id,
                    "right": right_id,
                    "paths": [{"left": a, "right": b} for a, b in hits],
                })
    return rows


def plan_waves(tasks: dict[str, dict], allow_high_risk_parallel: bool) -> list[list[str]]:
    topological_order(tasks)  # validates cycle before scheduling
    remaining = set(tasks)
    completed: set[str] = set()
    waves: list[list[str]] = []

    while remaining:
        ready = sorted(
            task_id
            for task_id in remaining
            if set(tasks[task_id]["depends_on"]).issubset(completed)
        )
        if not ready:
            raise RuntimeError("no ready tasks; dependency graph is inconsistent")

        wave: list[str] = []
        for task_id in ready:
            candidate = tasks[task_id]
            if wave:
                if not allow_high_risk_parallel and RISK_LEVELS[candidate["risk"]] >= RISK_LEVELS["high"]:
                    continue
                if not allow_high_risk_parallel and any(
                    RISK_LEVELS[tasks[chosen]["risk"]] >= RISK_LEVELS["high"] for chosen in wave
                ):
                    continue
                if any(task_conflicts(candidate, tasks[chosen]) for chosen in wave):
                    continue
            wave.append(task_id)
            if not allow_high_risk_parallel and RISK_LEVELS[candidate["risk"]] >= RISK_LEVELS["high"]:
                break

        if not wave:
            wave = [ready[0]]
        waves.append(wave)
        completed.update(wave)
        remaining.difference_update(wave)
    return waves


def parse_completed(value: str) -> set[str]:
    if not value.strip():
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("graph")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    p_plan = sub.add_parser("plan")
    p_plan.add_argument("--allow-high-risk-parallel", action="store_true")
    p_ready = sub.add_parser("ready")
    p_ready.add_argument("--completed", default="")
    sub.add_parser("conflicts")
    args = parser.parse_args()

    data = load_graph(pathlib.Path(args.graph))
    tasks = normalize_tasks(data)
    order = topological_order(tasks)

    if args.command == "validate":
        output = {
            "mission": data.get("mission"),
            "task_count": len(tasks),
            "topological_order": order,
            "write_conflict_pairs": len(all_conflicts(tasks)),
            "valid": True,
        }
    elif args.command == "plan":
        waves = plan_waves(tasks, args.allow_high_risk_parallel)
        output = {
            "mission": data.get("mission"),
            "wave_count": len(waves),
            "waves": [
                {
                    "index": index,
                    "tasks": [
                        {
                            "id": task_id,
                            "title": tasks[task_id]["title"],
                            "risk": tasks[task_id]["risk"],
                            "writes": tasks[task_id]["writes"],
                        }
                        for task_id in wave
                    ],
                }
                for index, wave in enumerate(waves, start=1)
            ],
            "note": "Predicted write sets are planning hints; refresh after each integration wave.",
        }
    elif args.command == "ready":
        completed = parse_completed(args.completed)
        unknown = sorted(completed - set(tasks))
        if unknown:
            raise RuntimeError("unknown completed task ids: " + ", ".join(unknown))
        ready = sorted(
            task_id
            for task_id, task in tasks.items()
            if task_id not in completed and set(task["depends_on"]).issubset(completed)
        )
        output = {"completed": sorted(completed), "ready": ready}
    else:
        output = {"conflicts": all_conflicts(tasks)}

    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
