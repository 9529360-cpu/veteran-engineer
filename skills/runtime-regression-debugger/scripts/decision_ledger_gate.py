#!/usr/bin/env python3
"""Validate append-only engineering decision ledgers built from transition receipts."""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

from transition_receipt import validate_receipt
from decision_dependency_graph import graph_summary, replay_receipts

LEDGER_SCHEMA_VERSION = 1


def _read_json(path: str) -> dict:
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} root must be an object")
    return data


def init_ledger(receipt: dict) -> dict:
    meta = validate_receipt(receipt)
    if meta["event"] != "initialized" or meta["sequence"] != 1 or meta["previous_receipt_hash"] is not None:
        raise ValueError("ledger must initialize from the first initialized receipt")
    return {
        "schema_version": LEDGER_SCHEMA_VERSION,
        "mission_id": meta["mission_id"],
        "entry_count": 1,
        "head_hash": meta["receipt_hash"],
        "entries": [receipt],
    }


def validate_ledger(ledger: Any) -> dict:
    if not isinstance(ledger, dict):
        raise ValueError("ledger root must be an object")
    if ledger.get("schema_version") != LEDGER_SCHEMA_VERSION:
        raise ValueError(f"ledger.schema_version must be {LEDGER_SCHEMA_VERSION}")
    mission_id = ledger.get("mission_id")
    if not isinstance(mission_id, str) or not mission_id.strip():
        raise ValueError("ledger.mission_id must be a non-empty string")
    entries = ledger.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError("ledger.entries must be a non-empty list")
    if ledger.get("entry_count") != len(entries):
        raise ValueError("ledger.entry_count must match entries length")

    previous_hash = None
    previous_generation = 0
    invalidated: set[str] = set()
    superseded: set[str] = set()
    seen_hashes: set[str] = set()
    for index, receipt in enumerate(entries, 1):
        meta = validate_receipt(receipt)
        if meta["mission_id"] != mission_id:
            raise ValueError(f"ledger entry {index} mission mismatch")
        if meta["sequence"] != index:
            raise ValueError(f"ledger entry {index} has non-contiguous sequence")
        if meta["generation_before"] != previous_generation or meta["generation_after"] != index:
            raise ValueError(f"ledger entry {index} has non-contiguous generation")
        if meta["previous_receipt_hash"] != previous_hash:
            raise ValueError(f"ledger entry {index} previous hash mismatch")
        if meta["receipt_hash"] in seen_hashes:
            raise ValueError(f"ledger entry {index} duplicates a receipt hash")
        seen_hashes.add(meta["receipt_hash"])
        previous_hash = meta["receipt_hash"]
        previous_generation = meta["generation_after"]
        invalidated.update(receipt.get("invalidated_authority_identities", []))
        superseded.update(receipt.get("superseded_receipt_hashes", []))

    if ledger.get("head_hash") != previous_hash:
        raise ValueError("ledger.head_hash must match the last receipt")
    decision_graph = replay_receipts(entries)
    decision_summary = graph_summary(decision_graph)
    unknown_superseded = superseded - seen_hashes
    if unknown_superseded:
        raise ValueError(f"ledger references unknown superseded receipt(s): {sorted(unknown_superseded)}")
    return {
        "mission_id": mission_id,
        "entry_count": len(entries),
        "head_hash": previous_hash,
        "invalidated_authority_identities": sorted(invalidated),
        "superseded_receipt_hashes": sorted(superseded),
        "decision_graph_hash": decision_summary["graph_hash"],
        "active_decision_ids": decision_summary["active_decision_ids"],
        "invalidated_decision_ids": decision_summary["invalidated_decision_ids"],
        "superseded_decision_ids": decision_summary["superseded_decision_ids"],
    }


def append_receipt(ledger: dict, receipt: dict, *, expected_head_hash: str) -> dict:
    meta = validate_ledger(ledger)
    if expected_head_hash != meta["head_hash"]:
        raise ValueError("stale ledger head")
    receipt_meta = validate_receipt(receipt)
    if receipt_meta["mission_id"] != meta["mission_id"]:
        raise ValueError("receipt mission does not match ledger")
    if receipt_meta["sequence"] != meta["entry_count"] + 1:
        raise ValueError("receipt sequence must append exactly one entry")
    if receipt_meta["previous_receipt_hash"] != meta["head_hash"]:
        raise ValueError("receipt does not extend current ledger head")
    result = json.loads(json.dumps(ledger))
    result["entries"].append(receipt)
    result["entry_count"] += 1
    result["head_hash"] = receipt_meta["receipt_hash"]
    validate_ledger(result)
    return result


def project_ledger(ledger: dict) -> dict:
    meta = validate_ledger(ledger)
    last = ledger["entries"][-1]
    current = None if last["event"] == "complete" else last.get("to")
    open_decisions: list[str] = []
    assumptions: list[str] = []
    for receipt in ledger["entries"]:
        context = receipt.get("decision_context") or {}
        for item in context.get("open_decisions", []):
            if item not in open_decisions:
                open_decisions.append(item)
        for item in context.get("assumptions", []):
            if item not in assumptions:
                assumptions.append(item)
    return {
        **meta,
        "status": "completed" if last["event"] == "complete" else "active",
        "current": current,
        "last_event": last["event"],
        "open_decisions_observed": open_decisions,
        "assumptions_observed": assumptions,
        "decisions_by_clause": graph_summary(replay_receipts(ledger["entries"]))["decisions_by_clause"],
        "note": "Projection is derived from immutable transition receipts and a replayed decision-dependency graph; semantic truth still comes from current repository/runtime evidence and the owning engineering contract.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("receipt")
    verify = sub.add_parser("verify")
    verify.add_argument("ledger")
    append = sub.add_parser("append")
    append.add_argument("ledger")
    append.add_argument("receipt")
    append.add_argument("--expected-head", required=True)
    project = sub.add_parser("project")
    project.add_argument("ledger")
    args = parser.parse_args()

    try:
        if args.command == "init":
            payload = init_ledger(_read_json(args.receipt))
        elif args.command == "verify":
            ledger = _read_json(args.ledger)
            payload = {"status": "pass", **validate_ledger(ledger)}
        elif args.command == "append":
            payload = append_receipt(_read_json(args.ledger), _read_json(args.receipt), expected_head_hash=args.expected_head)
        else:
            payload = project_ledger(_read_json(args.ledger))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
