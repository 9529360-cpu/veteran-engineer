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
  engineering_journal.py /tmp/work.json blocker --kind authorization --note "production deploy not authorized" --requires production
  engineering_journal.py /tmp/work.json decision --action "reconcile by operation id" --basis "provider shows committed charge"
  engineering_journal.py /tmp/work.json assess
  engineering_journal.py /tmp/work.json summary
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys


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
        "decisions": [],
        "blockers": [],
        "checkpoints": [],
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


def forbidden_equivalence_classes(data: dict) -> set[str]:
    """Return explicitly forbidden classes from prior failed attempts only."""
    forbidden: set[str] = set()
    for item in data.get("attempts", []):
        if not isinstance(item, dict) or item.get("outcome") != "failed":
            continue
        value = item.get("forbidden_equivalent_class")
        if isinstance(value, str) and value.strip():
            forbidden.add(value.strip())
    return forbidden


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("journal")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init")
    p.add_argument("--contract", required=True)

    p = sub.add_parser("checkpoint")
    p.add_argument(
        "--phase",
        required=True,
        choices=["discover", "reproduce", "design", "implement", "validate", "release", "verify"],
    )
    p.add_argument("--next-action", required=True)
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

    p = sub.add_parser("decision")
    p.add_argument("--action", required=True)
    p.add_argument("--basis", required=True)
    p.add_argument("--risk", default="")

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

    sub.add_parser("assess")
    sub.add_parser("summary")
    args = parser.parse_args()

    path = pathlib.Path(args.journal)
    data = load(path)

    if args.command == "init":
        if path.exists() and (data.get("hypotheses") or data.get("attempts") or data.get("evidence")):
            raise RuntimeError("journal already contains investigation data")
        data["contract"] = args.contract
        data["updated_at"] = now()
        save(path, data)
    elif args.command == "checkpoint":
        require_open(data)
        item = {
            "at": now(),
            "phase": args.phase,
            "next_action": args.next_action,
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
    elif args.command == "decision":
        require_open(data)
        data["decisions"].append({
            "at": now(),
            "action": args.action,
            "basis": args.basis,
            "risk": args.risk or None,
        })
        data["updated_at"] = now()
        save(path, data)
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
    elif args.command == "assess":
        failed = [item for item in data["attempts"] if item.get("outcome") == "failed"]
        blockers = data.get("blockers", [])
        same_class = None
        if len(failed) >= 2:
            a = failed[-1].get("equivalence_class")
            b = failed[-2].get("equivalence_class")
            if a and a == b:
                same_class = a
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
        else:
            print("action: continue-with-cheapest-falsifier")
            print("reason: no deterministic escalation threshold reached")
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
        print("decisions:", len(data["decisions"]))
        print("blockers:", len(data.get("blockers", [])))
        print("checkpoints:", len(data.get("checkpoints", [])))
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
