#!/usr/bin/env python3
"""Maintain a small, privacy-conscious engineering investigation journal.

The journal is intended for temporary working directories during long investigations.
Do not store secrets, credentials, tokens, raw customer content, or unnecessary PII.

Examples:
  engineering_journal.py /tmp/work.json init --contract "save invoice -> durable row -> visible status"
  engineering_journal.py /tmp/work.json checkpoint --phase reproduce --next-action "run duplicate delivery probe"
  engineering_journal.py /tmp/work.json hypothesis H1 --mechanism "timeout after commit" --falsifier "lookup operation id"
  engineering_journal.py /tmp/work.json evidence --hypothesis H1 --result supports --note "operation exists after timeout"
  engineering_journal.py /tmp/work.json attempt --name retry-handler --assumption "timeout means no commit" --outcome failed --equivalence-class symptom-retry --forbid symptom-retry
  engineering_journal.py /tmp/work.json reconsider --equivalence-class symptom-retry --basis "provider contract changed" --new-evidence "current provider docs plus fresh integration probe"
  engineering_journal.py /tmp/work.json blocker --kind authorization --note "production deploy not authorized" --requires production
  engineering_journal.py /tmp/work.json decision --key retry-policy --action "reconcile by operation id" --basis "provider shows committed charge"
  engineering_journal.py /tmp/work.json frontier --key fix-auth --action "repair auth owner" --basis "active path leaks tenant scope" --owner security --rank 10
  engineering_journal.py /tmp/work.json activate-frontier --key fix-auth
  engineering_journal.py /tmp/work.json frontier-status --key fix-auth --state done --note "focused + negative-path proof passed"
  engineering_journal.py /tmp/work.json next-frontier
  engineering_journal.py /tmp/work.json assess
  engineering_journal.py /tmp/work.json resume
  engineering_journal.py /tmp/work.json route-event --router-json /tmp/route.json
  engineering_journal.py /tmp/work.json tool-event --class github --outcome success --decision-impact changed --note "resolved exact PR head"
  engineering_journal.py /tmp/work.json mutation-receipt --surface github --action merge-pr --target acme/repo#42 --evidence-kind tool-return --result-id commit:abc123 --expected-descendant workflow:package
  engineering_journal.py /tmp/work.json host-event --kind tool-call-ceiling --note "reduce fan-out for this session"
  engineering_journal.py /tmp/work.json stats
  engineering_journal.py /tmp/work.json summary
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

from skill_identity import compute_identity


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fresh() -> dict:
    return {
        "version": 1,
        "created_at": now(),
        "contract": None,
        "phase": None,
        "next_action": None,
        "hypotheses": {},
        "evidence": [],
        "attempts": [],
        "equivalence_class_reviews": [],
        "decisions": [],
        "blockers": [],
        "checkpoints": [],
        "frontiers": [],
        "frontier_events": [],
        "skill_identity": None,
        "telemetry": {
            "resume_count": 0,
            "route_events": [],
            "tool_events": [],
            "mutation_receipts": [],
            "host_events": [],
        },
        "closed": False,
    }


def load(path: pathlib.Path) -> dict:
    if not path.exists():
        return fresh()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read journal: {exc}") from exc
    if not isinstance(data, dict) or data.get("version") != 1:
        raise RuntimeError("unsupported journal format")
    # Backward-compatible defaults for journals created by older versions.
    data.setdefault("phase", None)
    data.setdefault("next_action", None)
    data.setdefault("blockers", [])
    data.setdefault("checkpoints", [])
    data.setdefault("equivalence_class_reviews", [])
    data.setdefault("frontiers", [])
    data.setdefault("frontier_events", [])
    data.setdefault("skill_identity", None)
    telemetry = data.setdefault("telemetry", {})
    if not isinstance(telemetry, dict):
        raise RuntimeError("journal telemetry must be an object")
    telemetry.setdefault("resume_count", 0)
    telemetry.setdefault("route_events", [])
    telemetry.setdefault("tool_events", [])
    telemetry.setdefault("mutation_receipts", [])
    telemetry.setdefault("host_events", [])
    for item in data.setdefault("attempts", []):
        item.setdefault("equivalence_class", None)
        item.setdefault("forbidden_equivalent_class", None)
    return data


def save(path: pathlib.Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def require_open(data: dict) -> None:
    if data.get("closed"):
        raise RuntimeError("journal is closed")


IDENTITY_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,31}:.+$")


def require_namespaced_identity(value: str, field: str) -> str:
    candidate = value.strip()
    if not candidate or not IDENTITY_PATTERN.fullmatch(candidate):
        raise RuntimeError(f"{field} must use a namespaced identity such as commit:<sha> or release:<id>")
    return candidate


def prior_mutation_receipts(data: dict) -> list[dict]:
    return [
        item
        for item in data.get("telemetry", {}).get("mutation_receipts", [])
        if isinstance(item, dict)
    ]


def prior_result_owners(data: dict) -> dict[str, list[int]]:
    owners: dict[str, list[int]] = {}
    for index, item in enumerate(prior_mutation_receipts(data)):
        for result_id in item.get("result_ids", []) or []:
            if isinstance(result_id, str):
                owners.setdefault(result_id, []).append(index)
    return owners


def latest_forbidden_attempts(data: dict) -> dict[str, int]:
    """Return the latest failed attempt index that explicitly forbids each class."""
    latest: dict[str, int] = {}
    for index, item in enumerate(data.get("attempts", [])):
        if not isinstance(item, dict) or item.get("outcome") != "failed":
            continue
        value = item.get("forbidden_equivalent_class")
        if isinstance(value, str) and value.strip():
            latest[value.strip()] = index
    return latest


def reopened_forbidden_attempts(data: dict) -> set[tuple[str, int]]:
    """Return exact historical bans that were explicitly reconsidered."""
    reopened: set[tuple[str, int]] = set()
    for review in data.get("equivalence_class_reviews", []):
        if not isinstance(review, dict) or review.get("action") != "reopen":
            continue
        value = review.get("equivalence_class")
        attempt_index = review.get("forbidden_attempt_index")
        if isinstance(value, str) and value.strip() and isinstance(attempt_index, int) and attempt_index >= 0:
            reopened.add((value.strip(), attempt_index))
    return reopened


def forbidden_equivalence_classes(data: dict) -> set[str]:
    """Return classes whose latest explicit failed-attempt ban is still active."""
    latest = latest_forbidden_attempts(data)
    reopened = reopened_forbidden_attempts(data)
    return {
        equivalence_class
        for equivalence_class, attempt_index in latest.items()
        if (equivalence_class, attempt_index) not in reopened
    }



def frontier_index(data: dict, key: str) -> int | None:
    for index, item in enumerate(data.get("frontiers", [])):
        if isinstance(item, dict) and item.get("key") == key:
            return index
    return None


def frontier_by_key(data: dict, key: str) -> dict | None:
    index = frontier_index(data, key)
    if index is None:
        return None
    item = data.get("frontiers", [])[index]
    return item if isinstance(item, dict) else None


def active_frontier(data: dict) -> dict | None:
    active = [
        item
        for item in data.get("frontiers", [])
        if isinstance(item, dict) and item.get("state") == "active"
    ]
    if len(active) > 1:
        raise RuntimeError("journal contains multiple active frontiers")
    return active[0] if active else None


def frontier_ready(data: dict, item: dict) -> bool:
    if item.get("state") != "ready":
        return False
    for dep in item.get("depends_on", []) or []:
        parent = frontier_by_key(data, dep)
        if not parent or parent.get("state") != "done":
            return False
    return True


def ordered_ready_frontiers(data: dict) -> list[dict]:
    rows: list[tuple[int, int, dict]] = []
    for index, item in enumerate(data.get("frontiers", [])):
        if not isinstance(item, dict) or not frontier_ready(data, item):
            continue
        rank = item.get("rank")
        if not isinstance(rank, int):
            rank = 100
        rows.append((rank, index, item))
    rows.sort(key=lambda row: (row[0], row[1]))
    return [item for _, _, item in rows]


def checkpoint_stalled(data: dict) -> tuple[bool, str | None]:
    checkpoints = [item for item in data.get("checkpoints", []) if isinstance(item, dict)]
    if len(checkpoints) < 3:
        return False, None
    last = checkpoints[-3:]
    frontier_keys = [item.get("frontier_key") for item in last]
    actions = [item.get("next_action") for item in last]
    if not frontier_keys[0] or len(set(frontier_keys)) != 1 or len(set(actions)) != 1:
        return False, None
    progress = [
        (
            item.get("evidence_count"),
            item.get("attempt_count"),
            item.get("decision_count"),
        )
        for item in last
    ]
    if len(set(progress)) == 1:
        return True, frontier_keys[0]
    return False, None

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("journal")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init")
    p.add_argument("--contract", required=True)
    p.add_argument("--skill-root", default="", help="Optional Skill root to bind the journal to deterministic content bytes")

    p = sub.add_parser("checkpoint")
    p.add_argument(
        "--phase",
        required=True,
        choices=["discover", "reproduce", "design", "implement", "validate", "release", "verify"],
    )
    p.add_argument("--next-action", required=True)
    p.add_argument("--frontier-key", default="")
    p.add_argument("--note", default="")

    p = sub.add_parser("hypothesis")
    p.add_argument("id")
    p.add_argument("--mechanism", required=True)
    p.add_argument("--falsifier", required=True)

    p = sub.add_parser("evidence")
    p.add_argument("--hypothesis")
    p.add_argument("--result", choices=["supports", "refutes", "neutral"], required=True)
    p.add_argument("--note", required=True)

    p = sub.add_parser("attempt")
    p.add_argument("--name", required=True)
    p.add_argument("--assumption", required=True)
    p.add_argument("--outcome", choices=["succeeded", "failed", "partial"], required=True)
    p.add_argument("--equivalence-class", default="")
    p.add_argument("--forbid", default="")

    p = sub.add_parser("reconsider")
    p.add_argument("--equivalence-class", required=True)
    p.add_argument("--basis", required=True)
    p.add_argument("--new-evidence", required=True)

    p = sub.add_parser("decision")
    p.add_argument("--key", default="", help="Optional stable logical decision key; repeated identical writes become idempotent")
    p.add_argument("--action", required=True)
    p.add_argument("--basis", required=True)
    p.add_argument("--risk", default="")

    p = sub.add_parser("frontier")
    p.add_argument("--key", required=True)
    p.add_argument("--action", required=True)
    p.add_argument("--basis", required=True)
    p.add_argument("--owner", default="")
    p.add_argument("--rank", type=int, default=100)
    p.add_argument("--depends-on", action="append", default=[])

    p = sub.add_parser("activate-frontier")
    p.add_argument("--key", required=True)
    p.add_argument("--preempt-reason", default="")

    p = sub.add_parser("frontier-status")
    p.add_argument("--key", required=True)
    p.add_argument("--state", choices=["ready", "blocked", "done", "stale"], required=True)
    p.add_argument("--note", default="")

    sub.add_parser("next-frontier")

    p = sub.add_parser("blocker")
    p.add_argument(
        "--kind",
        required=True,
        choices=["authorization", "credential", "environment", "product-semantics", "irreversible-risk"],
    )
    p.add_argument("--note", required=True)
    p.add_argument("--requires", default="")

    p = sub.add_parser("close")
    p.add_argument("--evidence-level", required=True)
    p.add_argument("--residual-risk", action="append", default=[])

    p = sub.add_parser("route-event")
    p.add_argument("--router-json", required=True, help="Path to engineering_context_router --json output, or - for stdin")
    p.add_argument("--note", default="")

    p = sub.add_parser("tool-event")
    p.add_argument("--class", dest="tool_class", required=True)
    p.add_argument("--outcome", choices=["success", "failure", "partial", "blocked"], required=True)
    p.add_argument("--decision-impact", choices=["changed", "confirmed", "none", "unknown"], default="unknown")
    p.add_argument("--signature", default="")
    p.add_argument("--note", default="")

    p = sub.add_parser("mutation-receipt")
    p.add_argument("--surface", required=True)
    p.add_argument("--action", required=True)
    p.add_argument("--target", required=True)
    p.add_argument(
        "--evidence-kind",
        choices=["tool-return", "platform-binding", "manual-observation"],
        default="manual-observation",
    )
    p.add_argument("--result-id", action="append", default=[])
    p.add_argument("--caused-by", default="")
    p.add_argument("--expected-descendant", action="append", default=[])
    p.add_argument("--note", default="")

    p = sub.add_parser("host-event")
    p.add_argument("--kind", required=True)
    p.add_argument("--note", default="")

    sub.add_parser("assess")
    p = sub.add_parser("resume")
    p.add_argument("--max-decisions", type=int, default=5)
    p.add_argument("--max-blockers", type=int, default=3)
    p.add_argument("--max-frontiers", type=int, default=5)
    sub.add_parser("stats")
    sub.add_parser("summary")
    args = parser.parse_args()

    path = pathlib.Path(args.journal)
    data = load(path)

    if args.command == "init":
        if path.exists() and (data.get("hypotheses") or data.get("attempts") or data.get("evidence")):
            raise RuntimeError("journal already contains investigation data")
        data["contract"] = args.contract
        if args.skill_root.strip():
            root = pathlib.Path(args.skill_root).resolve()
            if not (root / "SKILL.md").is_file():
                raise RuntimeError(f"not a Skill root: {root}")
            digest, file_count, byte_count = compute_identity(root)
            data["skill_identity"] = {
                "algorithm": "sha256",
                "content_hash": digest,
                "file_count": file_count,
                "byte_count": byte_count,
                "observed_at": now(),
                "identity_scope": "observed-skill-root-bytes",
            }
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "checkpoint":
        require_open(data)
        item = {
            "at": now(),
            "phase": args.phase,
            "next_action": args.next_action,
            "frontier_key": args.frontier_key.strip() or None,
            "evidence_count": len(data.get("evidence", [])),
            "attempt_count": len(data.get("attempts", [])),
            "decision_count": len(data.get("decisions", [])),
            "note": args.note or None,
        }
        data["phase"] = args.phase
        data["next_action"] = args.next_action
        data["checkpoints"].append(item)
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "hypothesis":
        require_open(data)
        active_count = sum(1 for value in data["hypotheses"].values() if value.get("status") == "active")
        is_new_active = args.id not in data["hypotheses"] or data["hypotheses"][args.id].get("status") != "active"
        if active_count >= 3 and is_new_active:
            raise RuntimeError("bounded ledger allows at most three active hypotheses")
        data["hypotheses"][args.id] = {
            "mechanism": args.mechanism,
            "falsifier": args.falsifier,
            "status": "active",
            "updated_at": now(),
        }
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "evidence":
        require_open(data)
        if args.hypothesis and args.hypothesis not in data["hypotheses"]:
            raise RuntimeError(f"unknown hypothesis: {args.hypothesis}")
        data["evidence"].append({
            "at": now(),
            "hypothesis": args.hypothesis,
            "result": args.result,
            "note": args.note,
        })
        if args.hypothesis and args.result == "refutes":
            data["hypotheses"][args.hypothesis]["status"] = "refuted"
            data["hypotheses"][args.hypothesis]["updated_at"] = now()
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "attempt":
        require_open(data)
        equivalence_class = args.equivalence_class.strip()
        forbid = args.forbid.strip()
        if forbid and args.outcome != "failed":
            raise RuntimeError("--forbid is valid only for failed attempts")
        if equivalence_class in forbidden_equivalence_classes(data):
            raise RuntimeError(
                f"equivalence class is forbidden by a prior failed attempt: {equivalence_class}"
            )
        data["attempts"].append({
            "at": now(),
            "name": args.name,
            "assumption": args.assumption,
            "outcome": args.outcome,
            "equivalence_class": equivalence_class or None,
            "forbidden_equivalent_class": forbid or None,
        })
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "reconsider":
        require_open(data)
        equivalence_class = args.equivalence_class.strip()
        basis = args.basis.strip()
        new_evidence = args.new_evidence.strip()
        if not equivalence_class:
            raise RuntimeError("--equivalence-class must not be empty")
        if not basis:
            raise RuntimeError("--basis must not be empty")
        if not new_evidence:
            raise RuntimeError("--new-evidence must not be empty")
        latest = latest_forbidden_attempts(data)
        forbidden_attempt_index = latest.get(equivalence_class)
        if forbidden_attempt_index is None or equivalence_class not in forbidden_equivalence_classes(data):
            raise RuntimeError(f"equivalence class is not currently forbidden: {equivalence_class}")
        data["equivalence_class_reviews"].append({
            "at": now(),
            "action": "reopen",
            "equivalence_class": equivalence_class,
            "forbidden_attempt_index": forbidden_attempt_index,
            "basis": basis,
            "new_evidence": new_evidence,
        })
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "decision":
        require_open(data)
        decision_key = args.key.strip()
        action = args.action.strip()
        basis = args.basis.strip()
        risk = args.risk.strip() or None
        if not action or not basis:
            raise RuntimeError("--action and --basis must not be empty")
        latest_index = None
        latest_same_key = None
        if decision_key:
            for index in range(len(data["decisions"]) - 1, -1, -1):
                item = data["decisions"][index]
                if isinstance(item, dict) and item.get("decision_key") == decision_key:
                    latest_index = index
                    latest_same_key = item
                    break
            if latest_same_key and (
                latest_same_key.get("action") == action
                and latest_same_key.get("basis") == basis
                and latest_same_key.get("risk") == risk
            ):
                print("decision: unchanged")
                return 0
        row = {
            "at": now(),
            "decision_key": decision_key or None,
            "action": action,
            "basis": basis,
            "risk": risk,
        }
        if latest_index is not None:
            row["supersedes_decision_index"] = latest_index
        data["decisions"].append(row)
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "frontier":
        require_open(data)
        key = args.key.strip()
        action = args.action.strip()
        basis = args.basis.strip()
        owner = args.owner.strip() or None
        depends_on = [value.strip() for value in args.depends_on if value.strip()]
        if not key or not action or not basis:
            raise RuntimeError("--key, --action, and --basis must not be empty")
        if key in depends_on:
            raise RuntimeError("frontier cannot depend on itself")
        unknown = [dep for dep in depends_on if frontier_by_key(data, dep) is None]
        if unknown:
            raise RuntimeError("unknown frontier dependencies: " + ", ".join(unknown))
        existing = frontier_by_key(data, key)
        if existing and existing.get("state") == "done":
            raise RuntimeError("completed frontier cannot be silently reopened; use a new key for materially new work")
        if existing:
            same = (
                existing.get("action") == action
                and existing.get("basis") == basis
                and existing.get("owner") == owner
                and existing.get("rank", 100) == args.rank
                and (existing.get("depends_on") or []) == depends_on
                and existing.get("state") == "ready"
            )
            if same:
                print("frontier: unchanged")
                return 0
            current_state = existing.get("state")
            if current_state not in {"ready", "active"}:
                current_state = "ready"
            existing.update({
                "action": action,
                "basis": basis,
                "owner": owner,
                "rank": args.rank,
                "depends_on": depends_on,
                "state": current_state,
                "note": None,
                "updated_at": now(),
            })
        else:
            data["frontiers"].append({
                "key": key,
                "action": action,
                "basis": basis,
                "owner": owner,
                "rank": args.rank,
                "depends_on": depends_on,
                "state": "ready",
                "note": None,
                "created_at": now(),
                "updated_at": now(),
            })
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "activate-frontier":
        require_open(data)
        key = args.key.strip()
        item = frontier_by_key(data, key)
        if not item:
            raise RuntimeError(f"unknown frontier: {key}")
        if item.get("state") in {"done", "blocked", "stale"}:
            raise RuntimeError(f"frontier is not activatable from state {item.get('state')}: {key}")
        current = active_frontier(data)
        if current and current.get("key") == key:
            print("frontier: already-active")
            return 0
        reason = args.preempt_reason.strip()
        if current and not reason:
            raise RuntimeError(
                f"active frontier exists: {current.get('key')}; close/block/stale it or provide --preempt-reason"
            )
        at = now()
        preempted_key = None
        if current:
            preempted_key = current.get("key")
            current["state"] = "ready"
            current["note"] = f"preempted: {reason}"
            current["updated_at"] = at
        item["state"] = "active"
        item["note"] = None
        item["activated_at"] = at
        item["updated_at"] = at
        data["frontier_events"].append({
            "at": at,
            "event": "activate",
            "key": key,
            "preempted": preempted_key,
            "preempt_reason": reason or None,
        })
        data["updated_at"] = at
        save(path, data)
    elif args.command == "frontier-status":
        require_open(data)
        key = args.key.strip()
        item = frontier_by_key(data, key)
        if not item:
            raise RuntimeError(f"unknown frontier: {key}")
        previous_state = item.get("state")
        at = now()
        item["state"] = args.state
        item["note"] = args.note.strip() or None
        item["updated_at"] = at
        if args.state == "done":
            item["completed_at"] = at
        data["frontier_events"].append({
            "at": at,
            "event": "status",
            "key": key,
            "from": previous_state,
            "to": args.state,
            "note": args.note.strip() or None,
        })
        data["updated_at"] = at
        save(path, data)
    elif args.command == "next-frontier":
        active = active_frontier(data)
        ready = ordered_ready_frontiers(data)
        if active:
            item = active
            print(json.dumps({
                "status": "active",
                "frontier": {
                    "key": item.get("key"),
                    "action": item.get("action"),
                    "basis": item.get("basis"),
                    "owner": item.get("owner"),
                    "rank": item.get("rank"),
                    "depends_on": item.get("depends_on", []),
                },
            }, indent=2, sort_keys=True))
        elif ready:
            item = ready[0]
            print(json.dumps({
                "status": "ready",
                "frontier": {
                    "key": item.get("key"),
                    "action": item.get("action"),
                    "basis": item.get("basis"),
                    "owner": item.get("owner"),
                    "rank": item.get("rank"),
                    "depends_on": item.get("depends_on", []),
                },
            }, indent=2, sort_keys=True))
        else:
            remaining = [
                {"key": item.get("key"), "state": item.get("state"), "note": item.get("note")}
                for item in data.get("frontiers", [])
                if isinstance(item, dict) and item.get("state") not in {"done", "stale"}
            ]
            print(json.dumps({"status": "no-ready-frontier", "remaining": remaining}, indent=2, sort_keys=True))
    elif args.command == "blocker":
        require_open(data)
        data["blockers"].append({
            "at": now(),
            "kind": args.kind,
            "note": args.note,
            "requires": args.requires or None,
        })
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "close":
        require_open(data)
        data["closed"] = True
        data["closed_at"] = now()
        data["evidence_level"] = args.evidence_level
        data["residual_risks"] = args.residual_risk
        data["next_action"] = None
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "route-event":
        require_open(data)
        if args.router_json == "-":
            raw = sys.stdin.read()
        else:
            raw = pathlib.Path(args.router_json).read_text(encoding="utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"invalid router JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("router JSON must be an object")
        event = {
            "at": now(),
            "signals": payload.get("signals", []),
            "primary_signal": payload.get("primary_signal"),
            "primary_stage": payload.get("primary_stage"),
            "active_references": [item.get("path") for item in payload.get("references", []) if isinstance(item, dict)],
            "deferred_references": [item.get("path") for item in payload.get("deferred_references", []) if isinstance(item, dict)],
            "unmatched_signals": payload.get("unmatched_signals", []),
            "selected_reference_bytes": payload.get("selected_reference_bytes"),
            "route_byte_budget": payload.get("route_byte_budget"),
            "context_profile": payload.get("context_profile"),
            "note": args.note.strip() or None,
        }
        data["telemetry"]["route_events"].append(event)
        data["updated_at"] = event["at"]
        save(path, data)
    elif args.command == "tool-event":
        require_open(data)
        event = {
            "at": now(),
            "class": args.tool_class.strip(),
            "outcome": args.outcome,
            "decision_impact": args.decision_impact,
            "signature": args.signature.strip() or None,
            "note": args.note.strip() or None,
        }
        if not event["class"]:
            raise RuntimeError("--class must not be empty")
        data["telemetry"]["tool_events"].append(event)
        data["updated_at"] = event["at"]
        save(path, data)
    elif args.command == "mutation-receipt":
        require_open(data)
        surface = args.surface.strip()
        action = args.action.strip()
        target = args.target.strip()
        raw_result_ids = [item.strip() for item in args.result_id if item.strip()]
        raw_expected = [item.strip() for item in args.expected_descendant if item.strip()]
        if not surface:
            raise RuntimeError("--surface must not be empty")
        if not action:
            raise RuntimeError("--action must not be empty")
        if not target:
            raise RuntimeError("--target must not be empty")
        if not raw_result_ids:
            raise RuntimeError("mutation receipt requires at least one --result-id")

        result_ids = list(dict.fromkeys(
            require_namespaced_identity(item, "--result-id")
            for item in raw_result_ids
        ))
        expected = list(dict.fromkeys(
            require_namespaced_identity(item, "--expected-descendant")
            for item in raw_expected
        ))
        caused_by = args.caused_by.strip() or None
        if caused_by is not None:
            caused_by = require_namespaced_identity(caused_by, "--caused-by")

        owners = prior_result_owners(data)
        duplicates = [result_id for result_id in result_ids if result_id in owners]
        if duplicates:
            raise RuntimeError(
                "mutation receipt result identity already recorded: " + ", ".join(duplicates)
            )
        if caused_by is not None:
            parent_owners = owners.get(caused_by, [])
            if len(parent_owners) != 1:
                raise RuntimeError(
                    "--caused-by must reference exactly one prior mutation receipt result identity"
                )

        receipt = {
            "at": now(),
            "surface": surface,
            "action": action,
            "target": target,
            "evidence_kind": args.evidence_kind,
            "result_ids": result_ids,
            "caused_by": caused_by,
            "expected_descendants": expected,
            "note": args.note.strip() or None,
        }
        data["telemetry"]["mutation_receipts"].append(receipt)
        data["updated_at"] = receipt["at"]
        save(path, data)
    elif args.command == "host-event":
        require_open(data)
        kind = args.kind.strip()
        if not kind:
            raise RuntimeError("--kind must not be empty")
        event = {"at": now(), "kind": kind, "note": args.note.strip() or None}
        data["telemetry"]["host_events"].append(event)
        data["updated_at"] = event["at"]
        save(path, data)
    elif args.command == "assess":
        failed = [item for item in data["attempts"] if item.get("outcome") == "failed"]
        blockers = data.get("blockers", [])
        same_class = None
        if len(failed) >= 2:
            a = failed[-1].get("equivalence_class")
            b = failed[-2].get("equivalence_class")
            if a and a == b:
                same_class = a
        stalled, frontier_key = checkpoint_stalled(data)
        if blockers:
            latest = blockers[-1]
            print("action: stop-at-blocker")
            print("reason:", latest.get("kind"), "-", latest.get("note"))
        elif len(failed) >= 3:
            print("action: rebuild-investigation-model")
            print("reason: three or more failed attempts; re-establish environment, active path, authority, and test-harness validity before another behavioral patch")
        elif same_class:
            print("action: rebuild-ownership-dataflow")
            print("reason: two consecutive failed attempts share equivalence class", same_class)
        elif stalled:
            print("action: replan-stalled-frontier")
            print("reason: three checkpoints repeated the same frontier/action without new evidence, attempts, or decisions -", frontier_key)
        else:
            print("action: continue-with-cheapest-falsifier")
            print("reason: no deterministic escalation threshold reached")
    elif args.command == "resume":
        data["telemetry"]["resume_count"] = int(data["telemetry"].get("resume_count", 0)) + 1
        data["updated_at"] = now()
        save(path, data)
        max_decisions = max(0, args.max_decisions)
        max_blockers = max(0, args.max_blockers)
        max_frontiers = max(0, args.max_frontiers)
        active_hypotheses = [
            {
                "id": key,
                "mechanism": value.get("mechanism"),
                "falsifier": value.get("falsifier"),
            }
            for key, value in data.get("hypotheses", {}).items()
            if isinstance(value, dict) and value.get("status") == "active"
        ]
        latest_keyed: dict[str, dict] = {}
        unkeyed: list[dict] = []
        for item in data.get("decisions", []):
            if not isinstance(item, dict):
                continue
            key = item.get("decision_key")
            compact = {
                "decision_key": key,
                "action": item.get("action"),
                "basis": item.get("basis"),
                "risk": item.get("risk"),
                "at": item.get("at"),
            }
            if isinstance(key, str) and key.strip():
                latest_keyed[key] = compact
            else:
                unkeyed.append(compact)
        decisions = list(latest_keyed.values())
        if len(decisions) < max_decisions:
            decisions.extend(unkeyed[-(max_decisions - len(decisions)):])
        decisions = decisions[-max_decisions:] if max_decisions else []
        active = active_frontier(data)
        compact_active = None
        if active:
            compact_active = {
                "key": active.get("key"),
                "action": active.get("action"),
                "basis": active.get("basis"),
                "owner": active.get("owner"),
                "rank": active.get("rank"),
                "depends_on": active.get("depends_on", []),
            }
        ready_frontiers = ordered_ready_frontiers(data)
        compact_frontiers = [
            {
                "key": item.get("key"),
                "action": item.get("action"),
                "basis": item.get("basis"),
                "owner": item.get("owner"),
                "rank": item.get("rank"),
                "depends_on": item.get("depends_on", []),
            }
            for item in ready_frontiers[:max_frontiers]
        ] if max_frontiers else []
        payload = {
            "contract": data.get("contract"),
            "phase": data.get("phase"),
            "next_action": data.get("next_action"),
            "active_hypotheses": active_hypotheses,
            "forbidden_equivalence_classes": sorted(forbidden_equivalence_classes(data)),
            "settled_decisions": decisions,
            "blockers": data.get("blockers", [])[-max_blockers:] if max_blockers else [],
            "active_frontier": compact_active,
            "ready_frontiers": compact_frontiers,
            "latest_checkpoint": (data.get("checkpoints") or [None])[-1],
            "mutation_receipts": [
                {
                    "surface": item.get("surface"),
                    "action": item.get("action"),
                    "target": item.get("target"),
                    "evidence_kind": item.get("evidence_kind", "manual-observation"),
                    "result_ids": item.get("result_ids", []),
                    "caused_by": item.get("caused_by"),
                    "expected_descendants": item.get("expected_descendants", []),
                    "expected_descendants_status": "predicted-unverified",
                    "attribution_scope": "historical-mission-record",
                    "requires_live_revalidation_for_session_attribution": True,
                    "at": item.get("at"),
                }
                for item in data.get("telemetry", {}).get("mutation_receipts", [])[-8:]
                if isinstance(item, dict)
            ],
            "counts": {
                "evidence": len(data.get("evidence", [])),
                "attempts": len(data.get("attempts", [])),
                "decisions": len(data.get("decisions", [])),
                "checkpoints": len(data.get("checkpoints", [])),
                "frontiers": len(data.get("frontiers", [])),
                "resume_invocations": int(data.get("telemetry", {}).get("resume_count", 0)),
                "journaled_route_events": len(data.get("telemetry", {}).get("route_events", [])),
                "journaled_tool_events": len(data.get("telemetry", {}).get("tool_events", [])),
                "mutation_receipts": len(data.get("telemetry", {}).get("mutation_receipts", [])),
                "journaled_host_events": len(data.get("telemetry", {}).get("host_events", [])),
            },
            "closed": bool(data.get("closed")),
            "evidence_level": data.get("evidence_level"),
            "residual_risks": data.get("residual_risks", []),
            "note": "Compact resume state only. Mutation receipts are historical mission records, not session identity proof; revalidate source/runtime identity and causal bindings before attribution.",
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
    elif args.command == "stats":
        telemetry = data.get("telemetry", {})
        route_events = [item for item in telemetry.get("route_events", []) if isinstance(item, dict)]
        tool_events = [item for item in telemetry.get("tool_events", []) if isinstance(item, dict)]
        mutation_receipts = [item for item in telemetry.get("mutation_receipts", []) if isinstance(item, dict)]
        receipt_evidence_kinds: dict[str, int] = {}
        for item in mutation_receipts:
            kind = str(item.get("evidence_kind") or "manual-observation")
            receipt_evidence_kinds[kind] = receipt_evidence_kinds.get(kind, 0) + 1
        host_events = [item for item in telemetry.get("host_events", []) if isinstance(item, dict)]
        frontier_states: dict[str, int] = {}
        for item in data.get("frontiers", []):
            if isinstance(item, dict):
                state = str(item.get("state") or "unknown")
                frontier_states[state] = frontier_states.get(state, 0) + 1
        tool_classes: dict[str, int] = {}
        tool_outcomes: dict[str, int] = {}
        decision_impacts: dict[str, int] = {}
        for item in tool_events:
            tool_class = str(item.get("class") or "unknown")
            outcome = str(item.get("outcome") or "unknown")
            impact = str(item.get("decision_impact") or "unknown")
            tool_classes[tool_class] = tool_classes.get(tool_class, 0) + 1
            tool_outcomes[outcome] = tool_outcomes.get(outcome, 0) + 1
            decision_impacts[impact] = decision_impacts.get(impact, 0) + 1
        host_kinds: dict[str, int] = {}
        for item in host_events:
            kind = str(item.get("kind") or "unknown")
            host_kinds[kind] = host_kinds.get(kind, 0) + 1
        route_primary_stages: dict[str, int] = {}
        unmatched: dict[str, int] = {}
        max_active_refs = 0
        max_active_bytes = 0
        for item in route_events:
            stage = str(item.get("primary_stage") or "unknown")
            route_primary_stages[stage] = route_primary_stages.get(stage, 0) + 1
            refs = item.get("active_references") or []
            if isinstance(refs, list):
                max_active_refs = max(max_active_refs, len(refs))
            byte_count = item.get("selected_reference_bytes")
            if isinstance(byte_count, int):
                max_active_bytes = max(max_active_bytes, byte_count)
            for signal in item.get("unmatched_signals") or []:
                key = str(signal)
                unmatched[key] = unmatched.get(key, 0) + 1
        preemptions = sum(1 for item in data.get("frontier_events", []) if isinstance(item, dict) and item.get("preempted"))
        stalled, stalled_frontier = checkpoint_stalled(data)
        payload = {
            "skill_identity": data.get("skill_identity"),
            "counts": {
                "evidence": len(data.get("evidence", [])),
                "attempts": len(data.get("attempts", [])),
                "decisions": len(data.get("decisions", [])),
                "blockers": len(data.get("blockers", [])),
                "checkpoints": len(data.get("checkpoints", [])),
                "frontiers": len(data.get("frontiers", [])),
                "frontier_events": len(data.get("frontier_events", [])),
                "preemptions": preemptions,
                "resume_invocations": int(telemetry.get("resume_count", 0)),
                "journaled_route_events": len(route_events),
                "journaled_tool_events": len(tool_events),
                "mutation_receipts": len(mutation_receipts),
                "journaled_host_events": len(host_events),
            },
            "frontier_states": frontier_states,
            "route": {
                "primary_stages": route_primary_stages,
                "unmatched_signals": unmatched,
                "max_active_references": max_active_refs,
                "max_active_reference_bytes": max_active_bytes,
            },
            "tools": {
                "classes": tool_classes,
                "outcomes": tool_outcomes,
                "decision_impact": decision_impacts,
            },
            "mutation_receipts": {
                "evidence_kinds": receipt_evidence_kinds,
                "attribution_scope": "historical-mission-record",
                "requires_live_revalidation_for_session_attribution": True,
            },
            "host_events": host_kinds,
            "stalled_current_frontier": stalled_frontier if stalled else None,
            "closed": bool(data.get("closed")),
            "note": "Tool/host counts cover journaled evaluation events only; they are not host-global totals unless the host routes every event through this journal.",
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
    elif args.command == "summary":
        active = [key for key, value in data["hypotheses"].items() if value.get("status") == "active"]
        failed = [item for item in data["attempts"] if item.get("outcome") == "failed"]
        print("# Engineering journal summary")
        print("contract:", data.get("contract") or "unset")
        print("phase:", data.get("phase") or "unset")
        print("next action:", data.get("next_action") or "none")
        print("active hypotheses:", ", ".join(active) or "none")
        print("evidence items:", len(data["evidence"]))
        print("attempts:", len(data["attempts"]), f"({len(failed)} failed)")
        classes = [item.get("equivalence_class") for item in failed if item.get("equivalence_class")]
        print("failed equivalence classes:", ", ".join(classes) or "none")
        print("equivalence class reviews:", len(data.get("equivalence_class_reviews", [])))
        print("decisions:", len(data["decisions"]))
        print("blockers:", len(data.get("blockers", [])))
        print("checkpoints:", len(data.get("checkpoints", [])))
        print("mutation receipts:", len(data.get("telemetry", {}).get("mutation_receipts", [])))
        frontier_states: dict[str, int] = {}
        for item in data.get("frontiers", []):
            if isinstance(item, dict):
                state = str(item.get("state") or "unknown")
                frontier_states[state] = frontier_states.get(state, 0) + 1
        print("frontiers:", len(data.get("frontiers", [])), frontier_states)
        active = active_frontier(data)
        print("active frontier:", active.get("key") if active else "none")
        print("closed:", bool(data.get("closed")))
        if data.get("evidence_level"):
            print("evidence level:", data["evidence_level"])
        forbidden = sorted(forbidden_equivalence_classes(data))
        print("forbidden equivalent patch classes:", ", ".join(forbidden) or "none")
        for blocker in data.get("blockers", []):
            suffix = f" (requires {blocker['requires']})" if blocker.get("requires") else ""
            print(f"blocker[{blocker['kind']}]: {blocker['note']}{suffix}")
        for risk in data.get("residual_risks", []):
            print("residual risk:", risk)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
