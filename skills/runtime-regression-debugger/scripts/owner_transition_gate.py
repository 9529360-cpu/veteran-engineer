#!/usr/bin/env python3
"""Validate evidence-backed engineering owner transitions.

This gate turns router output into a small owner lifecycle state machine. It
validates identity/generation freshness and proof-bundle metadata, but it does
not decide whether an engineering claim is semantically true.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import pathlib
import sys
from typing import Any

from engineering_context_router import ALIASES, ROUTES, route_signals, signal_stage, split_csv
from decision_dependency_graph import (
    apply_changes as apply_decision_graph_changes,
    authorities_for_decisions,
    empty_graph as empty_decision_graph,
    graph_hash as decision_graph_hash,
    normalize_decision_records,
    reverse_affected_closure,
    validate_graph as validate_decision_graph,
)
from decision_revalidation_plan import build_revalidation_plan
from proof_bundle_gate import parse_time, validate_bundle
from transition_receipt import build_receipt, evidence_ids_from_bundle, validate_receipt

SCHEMA_VERSION = 1
FORWARD_STAGE_ORDER = {
    "analysis": 10,
    "requirements": 20,
    "design": 30,
    "technical": 40,
    "implementation": 50,
    "review": 60,
    "release": 70,
}
SPECIAL_STAGES = {"incident", "diagnostic"}


def require_nonempty_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def require_int(value: Any, path: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{path} must be an integer >= {minimum}")
    return value


def canonical_signal(value: Any, path: str) -> str:
    signal = require_nonempty_string(value, path).lower()
    signal = ALIASES.get(signal, signal)
    if signal not in ROUTES:
        raise ValueError(f"{path} names unknown signal: {signal}")
    return signal


def normalize_signal_list(values: Any, path: str) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list):
        raise ValueError(f"{path} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for index, value in enumerate(values):
        signal = canonical_signal(value, f"{path}[{index}]")
        if signal not in seen:
            seen.add(signal)
            out.append(signal)
    return out


def merge_signals(existing: list[str], additions: list[str]) -> list[str]:
    out = list(existing)
    seen = set(out)
    for signal in additions:
        if signal not in seen:
            seen.add(signal)
            out.append(signal)
    return out


def _signal_refs(signals: list[str], max_refs: int) -> tuple[list[dict], list[dict]]:
    """Build a compact route from explicit current-stage/domain signals."""
    refs: list[str] = []
    reasons: dict[str, list[str]] = {}
    for signal in signals:
        for ref in ROUTES.get(signal, []):
            if ref not in refs:
                refs.append(ref)
                reasons[ref] = [signal]
            elif signal not in reasons[ref]:
                reasons[ref].append(signal)
    limit = max(1, max_refs)
    active = [{"path": ref, "reasons": reasons[ref]} for ref in refs[:limit]]
    deferred = [
        {"path": ref, "reasons": reasons[ref], "deferred_by": "budget"}
        for ref in refs[limit:]
    ]
    return active, deferred


def route_for_owner(all_signals: list[str], primary_signal: str, max_refs: int) -> dict:
    """Route only the promoted owner's stage plus domain/risk companions.

    Accepted upstream artifacts travel through authority lineage rather than by
    keeping their old specialist references loaded. Future-stage owners remain
    queued. Diagnostic/incident owners keep all mechanisms active.
    """
    primary_stage = signal_stage(primary_signal)
    active_signals: list[str] = []
    deferred_signals: list[dict] = []
    closed_upstream_signals: list[dict] = []

    primary_rank = FORWARD_STAGE_ORDER.get(primary_stage)
    for signal in all_signals:
        stage = signal_stage(signal)
        keep = signal == primary_signal or stage is None or stage == primary_stage
        if primary_stage in SPECIAL_STAGES:
            keep = True
        if keep:
            active_signals.append(signal)
            continue
        stage_rank = FORWARD_STAGE_ORDER.get(stage)
        if primary_rank is not None and stage_rank is not None and stage_rank < primary_rank:
            closed_upstream_signals.append(
                {
                    "signal": signal,
                    "stage": stage,
                    "reason": f"closed upstream of {primary_stage}",
                }
            )
        else:
            deferred_signals.append(
                {
                    "signal": signal,
                    "stage": stage,
                    "reason": f"current owner is {primary_stage or 'domain'}",
                }
            )

    if primary_signal not in active_signals:
        active_signals.insert(0, primary_signal)
    else:
        active_signals = [primary_signal] + [s for s in active_signals if s != primary_signal]

    references, budget_deferred = _signal_refs(active_signals, max_refs)
    queued_refs: list[dict] = list(budget_deferred)
    selected_paths = {item["path"] for item in references}
    queued_paths = {item["path"] for item in queued_refs}
    for item in deferred_signals:
        signal = item["signal"]
        for ref in ROUTES.get(signal, []):
            if ref in selected_paths or ref in queued_paths:
                continue
            queued_paths.add(ref)
            queued_refs.append({"path": ref, "reasons": [signal], "deferred_by": "stage"})

    return {
        "primary_signal": primary_signal,
        "primary_stage": primary_stage,
        "primary_reference": ROUTES[primary_signal][0],
        "active_signals": active_signals,
        "deferred_signals": deferred_signals,
        "closed_upstream_signals": closed_upstream_signals,
        "references": references,
        "deferred_references": queued_refs,
        "route_budget": max(1, max_refs),
        "has_deferred": bool(queued_refs),
    }


def initialize_state(
    signals: str | list[str],
    *,
    authority_identity: str,
    mission_id: str,
    max_refs: int = 7,
) -> dict:
    authority_identity = require_nonempty_string(authority_identity, "authority_identity")
    mission_id = require_nonempty_string(mission_id, "mission_id")
    if isinstance(signals, str):
        normalized = split_csv(signals)
    elif isinstance(signals, list):
        normalized = normalize_signal_list(signals, "signals")
    else:
        raise ValueError("signals must be a CSV string or list")
    if not normalized:
        raise ValueError("signals must resolve to at least one known route signal")
    unknown = [signal for signal in normalized if signal not in ROUTES]
    if unknown:
        raise ValueError(f"unknown signal(s): {', '.join(unknown)}")

    routed = route_signals(",".join(normalized), max_refs)
    if not routed.get("primary_signal"):
        raise ValueError("router did not produce a primary owner")
    # The router chooses the current owner; the owner-state model then
    # normalizes all mission signals relative to that owner so earlier
    # stages are closed-upstream lineage rather than future/deferred work.
    state_route = route_for_owner(normalized, routed["primary_signal"], max_refs)

    decision_graph = empty_decision_graph()
    decision_graph_head = decision_graph_hash(decision_graph)

    init_receipt = build_receipt(
        mission_id=mission_id,
        sequence=1,
        event="initialized",
        generation_before=0,
        generation_after=1,
        previous_receipt_hash=None,
        from_owner=None,
        to_owner={
            "signal": state_route["primary_signal"],
            "stage": state_route["primary_stage"],
            "authority_identity": authority_identity,
        },
        proof_bundle=None,
        decision_graph_hash_after=decision_graph_head,
        decision_context={"summary": f"initialize owner {state_route['primary_signal']}"},
    )

    return {
        "schema_version": SCHEMA_VERSION,
        "mission_id": mission_id,
        "generation": 1,
        "status": "active",
        "signals": normalized,
        "current": {
            "signal": state_route["primary_signal"],
            "stage": state_route["primary_stage"],
            "reference": state_route["primary_reference"],
            "authority_identity": authority_identity,
        },
        "active_signals": state_route["active_signals"],
        "deferred_signals": state_route["deferred_signals"],
        "closed_upstream_signals": state_route["closed_upstream_signals"],
        "references": state_route["references"],
        "deferred_references": state_route["deferred_references"],
        "route_budget": state_route["route_budget"],
        "authority_lineage": [authority_identity],
        "invalidated_authorities": [],
        "decision_dependency_graph": decision_graph,
        "decision_dependency_graph_hash": decision_graph_head,
        "decision_ledger_head_hash": init_receipt["receipt_hash"],
        "decision_ledger_entry_count": 1,
        "last_transition_receipt": init_receipt,
        "history": [
            {
                "generation": 1,
                "event": "initialized",
                "to_signal": state_route["primary_signal"],
                "to_stage": state_route["primary_stage"],
                "authority_identity": authority_identity,
                "receipt_hash": init_receipt["receipt_hash"],
            }
        ],
    }


def _with_decision_graph_defaults(state: dict) -> dict:
    normalized = copy.deepcopy(state)
    if normalized.get("decision_dependency_graph") is None:
        normalized["decision_dependency_graph"] = empty_decision_graph()
    if normalized.get("decision_dependency_graph_hash") is None:
        normalized["decision_dependency_graph_hash"] = decision_graph_hash(normalized["decision_dependency_graph"])
    return normalized


def validate_state(state: Any) -> dict:
    if not isinstance(state, dict):
        raise ValueError("state root must be an object")
    if state.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
    require_nonempty_string(state.get("mission_id"), "mission_id")
    require_int(state.get("generation"), "generation", minimum=1)
    status = require_nonempty_string(state.get("status"), "status")
    if status not in {"active", "completed"}:
        raise ValueError("status must be active or completed")
    current = state.get("current")
    if not isinstance(current, dict):
        raise ValueError("current must be an object")
    current_signal = canonical_signal(current.get("signal"), "current.signal")
    expected_stage = signal_stage(current_signal)
    if current.get("stage") != expected_stage:
        raise ValueError("current.stage does not match current.signal")
    if current.get("reference") != ROUTES[current_signal][0]:
        raise ValueError("current.reference does not match current.signal owner")
    current_authority = require_nonempty_string(current.get("authority_identity"), "current.authority_identity")
    signals = normalize_signal_list(state.get("signals"), "signals")
    if current_signal not in signals:
        raise ValueError("current.signal must be present in signals")
    require_int(state.get("route_budget", 7), "route_budget", minimum=1)

    active = normalize_signal_list(state.get("active_signals"), "active_signals")
    if current_signal not in active:
        raise ValueError("current.signal must be active")

    def partition_signals(rows, path):
        if not isinstance(rows, list):
            raise ValueError(f"{path} must be a list")
        result = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(f"{path}[{index}] must be an object")
            signal = canonical_signal(row.get("signal"), f"{path}[{index}].signal")
            if row.get("stage") != signal_stage(signal):
                raise ValueError(f"{path}[{index}].stage does not match signal")
            result.append(signal)
        return result

    deferred = partition_signals(state.get("deferred_signals"), "deferred_signals")
    upstream = partition_signals(state.get("closed_upstream_signals", []), "closed_upstream_signals")
    parts = active + deferred + upstream
    if len(parts) != len(set(parts)):
        raise ValueError("signal partitions overlap")
    if set(parts) != set(signals):
        raise ValueError("signal partitions must cover mission signals exactly")

    current_rank = FORWARD_STAGE_ORDER.get(expected_stage)
    if expected_stage not in SPECIAL_STAGES and current_rank is not None:
        for signal in deferred:
            rank = FORWARD_STAGE_ORDER.get(signal_stage(signal))
            if rank is not None and rank <= current_rank:
                raise ValueError(f"deferred signal is not downstream of current owner: {signal}")
        for signal in upstream:
            rank = FORWARD_STAGE_ORDER.get(signal_stage(signal))
            if rank is not None and rank >= current_rank:
                raise ValueError(f"closed upstream signal is not upstream of current owner: {signal}")

    lineage = state.get("authority_lineage")
    if not isinstance(lineage, list) or not lineage:
        raise ValueError("authority_lineage must be a non-empty list")
    if current_authority not in lineage:
        raise ValueError("current authority must exist in authority_lineage")
    invalidated = state.get("invalidated_authorities")
    history = state.get("history")
    if not isinstance(invalidated, list):
        raise ValueError("invalidated_authorities must be a list")
    if not isinstance(history, list) or not history:
        raise ValueError("history must be a non-empty list")
    if history[-1].get("generation") != state["generation"]:
        raise ValueError("latest history generation must match state generation")
    invalidated_rows = [row for row in invalidated if isinstance(row, dict)]
    invalidated_ids = [row.get("identity") for row in invalidated_rows]
    if any(not isinstance(identity, str) or not identity.strip() for identity in invalidated_ids):
        raise ValueError("invalidated_authorities identities must be non-empty strings")
    if len(invalidated_ids) != len(set(invalidated_ids)):
        raise ValueError("invalidated_authorities identities must be unique")
    if not set(invalidated_ids).issubset(set(lineage)):
        raise ValueError("invalidated authorities must come from authority_lineage")
    if current_authority in set(invalidated_ids):
        raise ValueError("current authority cannot be invalidated")

    if state.get("decision_dependency_graph") is None:
        decision_graph = empty_decision_graph()
        declared_graph_hash = decision_graph_hash(decision_graph)
    else:
        decision_graph = validate_decision_graph(state.get("decision_dependency_graph"))
        declared_graph_hash = require_nonempty_string(
            state.get("decision_dependency_graph_hash"), "decision_dependency_graph_hash"
        )
        actual_graph_hash = decision_graph_hash(decision_graph)
        if declared_graph_hash != actual_graph_hash:
            raise ValueError("decision_dependency_graph_hash mismatch")

    ledger_count = require_int(state.get("decision_ledger_entry_count"), "decision_ledger_entry_count", minimum=1)
    if ledger_count != state["generation"]:
        raise ValueError("decision_ledger_entry_count must equal generation")
    ledger_head = require_nonempty_string(state.get("decision_ledger_head_hash"), "decision_ledger_head_hash")
    receipt = state.get("last_transition_receipt")
    receipt_meta = validate_receipt(receipt)
    if receipt_meta["mission_id"] != state["mission_id"]:
        raise ValueError("last transition receipt mission mismatch")
    if receipt_meta["generation_after"] != state["generation"] or receipt_meta["sequence"] != ledger_count:
        raise ValueError("last transition receipt generation mismatch")
    if receipt_meta["receipt_hash"] != ledger_head:
        raise ValueError("decision ledger head must match last transition receipt")
    receipt_graph_hash = receipt.get("decision_graph_hash_after")
    if receipt_graph_hash is not None and receipt_graph_hash != declared_graph_hash:
        raise ValueError("last transition receipt decision graph hash mismatch")
    if history[-1].get("receipt_hash") != ledger_head:
        raise ValueError("latest history receipt hash must match decision ledger head")
    return state


def _authority_history(state: dict) -> list[dict]:
    records: list[dict] = []
    for row in state.get("history", []):
        if not isinstance(row, dict):
            continue
        signal = row.get("to_signal")
        identity = row.get("to_authority_identity") or row.get("authority_identity")
        if signal in ROUTES and isinstance(identity, str) and identity.strip():
            records.append({"signal": signal, "identity": identity.strip(), "generation": row.get("generation"), "receipt_hash": row.get("receipt_hash")})
    current = state.get("current") or {}
    current_signal = current.get("signal")
    current_identity = current.get("authority_identity")
    if current_signal in ROUTES and isinstance(current_identity, str) and current_identity.strip():
        if not records or records[-1]["identity"] != current_identity.strip():
            records.append({"signal": current_signal, "identity": current_identity.strip(), "generation": state.get("generation"), "receipt_hash": state.get("decision_ledger_head_hash")})
    return records


def _invalidation_cascade(state: dict, reopen_signal: str) -> list[str]:
    """Invalidate the most recent reopened owner authority and every downstream primary authority derived from it."""
    records = _authority_history(state)
    start = None
    for index in range(len(records) - 1, -1, -1):
        if records[index]["signal"] == reopen_signal:
            start = index
            break
    if start is None:
        return [state["current"]["authority_identity"]]
    result: list[str] = []
    for row in records[start:]:
        identity = row["identity"]
        if identity not in result:
            result.append(identity)
    return result


def _event_preconditions(state: dict, event: dict) -> list[str]:
    blockers: list[str] = []
    expected_generation = event.get("expected_generation")
    if expected_generation != state["generation"]:
        blockers.append("stale_generation")
    from_signal = event.get("from_signal")
    try:
        from_signal = canonical_signal(from_signal, "event.from_signal")
    except ValueError:
        blockers.append("invalid_from_signal")
        from_signal = None
    if from_signal and from_signal != state["current"]["signal"]:
        blockers.append("stale_owner")
    if event.get("from_authority_identity") != state["current"]["authority_identity"]:
        blockers.append("stale_authority_identity")
    if event.get("expected_ledger_head_hash") != state.get("decision_ledger_head_hash"):
        blockers.append("stale_decision_ledger_head")
    if state["status"] != "active":
        blockers.append("state_not_active")
    return blockers


def _validate_event_proof(state: dict, event: dict, *, now: dt.datetime | None) -> tuple[dict | None, list[str]]:
    blockers: list[str] = []
    proof = event.get("proof_bundle")
    if not isinstance(proof, dict):
        return None, ["missing_proof_bundle"]
    try:
        verdict = validate_bundle(proof, now=now)
    except ValueError as exc:
        return None, [f"invalid_proof_bundle:{exc}"]
    if proof.get("change_identity") != state["current"]["authority_identity"]:
        blockers.append("proof_identity_mismatch")
    if not verdict["gate_passed"]:
        blockers.append("proof_bundle_blocked")
    required_claim_ids = event.get("required_claim_ids")
    if not isinstance(required_claim_ids, list) or not required_claim_ids:
        blockers.append("missing_required_claim_ids")
    else:
        passing_claim_ids = {
            row["id"] for row in verdict["claims"] if not row.get("problems")
        }
        for index, claim_id in enumerate(required_claim_ids):
            if not isinstance(claim_id, str) or not claim_id.strip():
                blockers.append(f"invalid_required_claim_id:{index}")
            elif claim_id.strip() not in passing_claim_ids:
                blockers.append(f"required_claim_not_proven:{claim_id.strip()}")
    return verdict, blockers


def _stage_transition_blocker(current_stage: str | None, target_stage: str | None) -> str | None:
    if current_stage in SPECIAL_STAGES:
        return None
    if current_stage is None or target_stage is None:
        return None
    if current_stage not in FORWARD_STAGE_ORDER or target_stage not in FORWARD_STAGE_ORDER:
        return None
    if FORWARD_STAGE_ORDER[target_stage] < FORWARD_STAGE_ORDER[current_stage]:
        return "backward_transition_requires_invalidation"
    return None


def _apply_route_to_state(state: dict, route: dict, authority_identity: str) -> None:
    state["current"] = {
        "signal": route["primary_signal"],
        "stage": route["primary_stage"],
        "reference": route["primary_reference"],
        "authority_identity": authority_identity,
    }
    state["active_signals"] = route["active_signals"]
    state["deferred_signals"] = route["deferred_signals"]
    state["closed_upstream_signals"] = route["closed_upstream_signals"]
    state["references"] = route["references"]
    state["deferred_references"] = route["deferred_references"]


def _plain_string_list(value: Any, path: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        item = require_nonempty_string(item, f"{path}[{index}]")
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _selective_decision_invalidation(
    state: dict,
    event: dict,
    proof_verdict: dict | None,
    reopen_signal: str,
) -> tuple[list[str], list[str], list[str], dict] | None:
    raw_stale = event.get("stale_decision_ids")
    if raw_stale is None:
        return None
    stale = _plain_string_list(raw_stale, "event.stale_decision_ids")
    if not stale:
        raise ValueError("event.stale_decision_ids must not be empty when provided")
    preserved = _plain_string_list(event.get("preserved_decision_ids", []), "event.preserved_decision_ids")
    preservation_claims = event.get("preservation_claims", {})
    if not isinstance(preservation_claims, dict):
        raise ValueError("event.preservation_claims must be an object")

    graph = validate_decision_graph(state.get("decision_dependency_graph"))
    nodes = graph["nodes"]
    for decision_id in stale:
        node = nodes.get(decision_id)
        if not node or node.get("status") != "active":
            raise ValueError(f"stale decision must be active: {decision_id}")
    if not any(nodes[decision_id].get("owner_signal") == reopen_signal for decision_id in stale):
        raise ValueError("at least one stale decision must belong to the reopened owner")

    passing_claims = {
        row.get("id")
        for row in (proof_verdict or {}).get("claims", [])
        if isinstance(row, dict) and not row.get("problems") and isinstance(row.get("id"), str)
    }
    for decision_id in preserved:
        claim_id = preservation_claims.get(decision_id)
        if not isinstance(claim_id, str) or not claim_id.strip():
            raise ValueError(f"preserved decision requires a preservation claim: {decision_id}")
        if claim_id.strip() not in passing_claims:
            raise ValueError(f"preservation claim is not proven for {decision_id}: {claim_id}")

    full_affected = reverse_affected_closure(graph, stale)
    unrelated_preserved = [decision_id for decision_id in preserved if decision_id not in set(full_affected)]
    if unrelated_preserved:
        raise ValueError(f"preserved decisions are not in the affected closure: {unrelated_preserved}")
    impact_plan = build_revalidation_plan(
        graph, stale, preserved_decision_ids=preserved
    )
    invalidated_decisions = impact_plan["effective_affected_decision_ids"]
    authority_set = set(authorities_for_decisions(graph, invalidated_decisions))
    authority_set.add(state["current"]["authority_identity"])
    cascade = [identity for identity in state.get("authority_lineage", []) if identity in authority_set]
    current_identity = state["current"]["authority_identity"]
    if current_identity not in cascade:
        cascade.append(current_identity)
    return invalidated_decisions, preserved, cascade, impact_plan


def _receipt_hashes_for_authorities(state: dict, identities: list[str]) -> list[str]:
    wanted = set(identities)
    out: list[str] = []
    for row in state.get("history", []):
        if not isinstance(row, dict):
            continue
        identity = row.get("to_authority_identity") or row.get("authority_identity")
        receipt_hash = row.get("receipt_hash")
        if identity in wanted and isinstance(receipt_hash, str) and receipt_hash and receipt_hash not in out:
            out.append(receipt_hash)
    return out


def _finalize_transition_receipt(state: dict, next_state: dict, event: dict, transition: dict, proof_bundle: dict | None) -> dict:
    event_type = transition["event"]
    invalidated = list(transition.get("invalidated_authority_identities") or [])
    superseded = list(transition.get("superseded_receipt_hashes") or [])
    closed_claim_ids = event.get("required_claim_ids") or []
    closed_clause_ids = event.get("closed_clause_ids")
    if closed_clause_ids is None:
        closed_clause_ids = closed_claim_ids
    default_evidence_ids = evidence_ids_from_bundle(proof_bundle, closed_claim_ids)
    decision_records = normalize_decision_records(
        event.get("decision_records", []),
        owner_signal=transition["from_signal"],
        owner_authority_identity=transition["from_authority_identity"],
        default_clause_ids=closed_clause_ids,
        default_evidence_ids=default_evidence_ids,
    )
    invalidated_decision_ids = list(transition.get("invalidated_decision_ids") or [])
    stale_decision_ids = list(transition.get("stale_decision_ids") or [])
    preserved_decision_ids = list(transition.get("preserved_decision_ids") or [])
    next_graph = apply_decision_graph_changes(
        state["decision_dependency_graph"],
        decision_records=decision_records,
        invalidated_decision_ids=invalidated_decision_ids,
    )
    next_graph_hash = decision_graph_hash(next_graph)
    to_owner = None
    if event_type != "complete":
        to_owner = {
            "signal": transition.get("to_signal"),
            "stage": transition.get("to_stage"),
            "authority_identity": transition.get("to_authority_identity"),
        }
    impact_plan = transition.get("revalidation_plan")
    receipt = build_receipt(
        mission_id=state["mission_id"],
        sequence=next_state["generation"],
        event=event_type,
        generation_before=state["generation"],
        generation_after=next_state["generation"],
        previous_receipt_hash=state["decision_ledger_head_hash"],
        from_owner={
            "signal": transition["from_signal"],
            "stage": transition.get("from_stage"),
            "authority_identity": transition["from_authority_identity"],
        },
        to_owner=to_owner,
        proof_bundle=proof_bundle,
        closed_claim_ids=closed_claim_ids,
        closed_clause_ids=closed_clause_ids,
        invalidated_authority_identities=invalidated,
        superseded_receipt_hashes=superseded,
        decision_records=decision_records,
        stale_decision_ids=stale_decision_ids,
        invalidated_decision_ids=invalidated_decision_ids,
        preserved_decision_ids=preserved_decision_ids,
        decision_graph_hash_after=next_graph_hash,
        revalidation_plan_hash=impact_plan.get("plan_hash") if isinstance(impact_plan, dict) else None,
        revalidation_plan_summary={
            "recompute_decision_ids": impact_plan.get("recompute_decision_ids", []),
            "revalidate_waves": impact_plan.get("revalidate_waves", []),
            "preservation_barrier_decision_ids": impact_plan.get("preservation_barrier_decision_ids", []),
            "change_pruned_root_decision_ids": impact_plan.get("change_pruned_root_decision_ids", []),
        } if isinstance(impact_plan, dict) else None,
        decision_context=event.get("decision_context"),
    )
    next_state["decision_dependency_graph"] = next_graph
    next_state["decision_dependency_graph_hash"] = next_graph_hash
    next_state["decision_ledger_head_hash"] = receipt["receipt_hash"]
    next_state["decision_ledger_entry_count"] = receipt["sequence"]
    next_state["last_transition_receipt"] = receipt
    if next_state.get("history"):
        next_state["history"][-1]["receipt_hash"] = receipt["receipt_hash"]
    return receipt


def apply_event(state: dict, event: dict, *, now: dt.datetime | None = None) -> dict:
    validate_state(state)
    state = _with_decision_graph_defaults(state)
    if not isinstance(event, dict):
        raise ValueError("event root must be an object")
    event_type = require_nonempty_string(event.get("event"), "event.event").lower()
    if event_type not in {"handoff", "invalidate", "complete"}:
        raise ValueError("event.event must be handoff, invalidate, or complete")

    blockers = _event_preconditions(state, event)
    proof_verdict, proof_blockers = _validate_event_proof(state, event, now=now)
    blockers.extend(proof_blockers)
    next_state = copy.deepcopy(state)
    transition: dict[str, Any] = {
        "event": event_type,
        "from_signal": state["current"]["signal"],
        "from_stage": state["current"].get("stage"),
        "from_authority_identity": state["current"]["authority_identity"],
    }

    if event_type == "handoff":
        try:
            target_signal = canonical_signal(event.get("target_signal"), "event.target_signal")
            additions = normalize_signal_list(event.get("add_signals", []), "event.add_signals")
            next_authority = require_nonempty_string(event.get("next_authority_identity"), "event.next_authority_identity")
        except ValueError as exc:
            blockers.append(f"invalid_handoff:{exc}")
            target_signal, additions, next_authority = None, [], None
        if target_signal:
            target_stage = signal_stage(target_signal)
            current_stage = state["current"].get("stage")
            stage_blocker = _stage_transition_blocker(current_stage, target_stage)
            if stage_blocker:
                blockers.append(stage_blocker)
            current_rank = FORWARD_STAGE_ORDER.get(current_stage)
            target_rank = FORWARD_STAGE_ORDER.get(target_stage)
            if current_rank is not None and target_rank is not None and target_rank > current_rank:
                for queued in state.get("deferred_signals", []):
                    if not isinstance(queued, dict):
                        continue
                    queued_signal = queued.get("signal")
                    queued_rank = FORWARD_STAGE_ORDER.get(queued.get("stage"))
                    if (
                        queued_signal != target_signal
                        and queued_rank is not None
                        and current_rank < queued_rank < target_rank
                    ):
                        blockers.append(f"skips_deferred_stage_owner:{queued_signal}")
            next_signals = merge_signals(state["signals"], additions)
            if target_signal not in next_signals:
                blockers.append("target_signal_not_in_mission")
            if next_authority == state["current"]["authority_identity"]:
                blockers.append("next_authority_must_advance_identity")
            invalidated_ids = {row.get("identity") for row in state.get("invalidated_authorities", []) if isinstance(row, dict)}
            if next_authority in invalidated_ids:
                blockers.append("next_authority_previously_invalidated")
            transition.update(
                {
                    "to_signal": target_signal,
                    "to_stage": target_stage,
                    "to_authority_identity": next_authority,
                }
            )
            if not blockers:
                route = route_for_owner(next_signals, target_signal, state["route_budget"])
                next_state["signals"] = next_signals
                next_state["generation"] += 1
                _apply_route_to_state(next_state, route, next_authority)
                next_state["authority_lineage"].append(next_authority)
                next_state["history"].append(
                    {
                        "generation": next_state["generation"],
                        "event": "handoff",
                        **transition,
                        "proof_identity": state["current"]["authority_identity"],
                    }
                )

    elif event_type == "invalidate":
        try:
            reopen_signal = canonical_signal(event.get("reopen_signal"), "event.reopen_signal")
            additions = normalize_signal_list(event.get("add_signals", []), "event.add_signals")
            reopen_authority = require_nonempty_string(event.get("reopen_authority_identity"), "event.reopen_authority_identity")
        except ValueError as exc:
            blockers.append(f"invalid_invalidation:{exc}")
            reopen_signal, additions, reopen_authority = None, [], None
        if reopen_signal:
            current_stage = state["current"].get("stage")
            reopen_stage = signal_stage(reopen_signal)
            current_rank = FORWARD_STAGE_ORDER.get(current_stage)
            reopen_rank = FORWARD_STAGE_ORDER.get(reopen_stage)
            if (
                current_stage not in SPECIAL_STAGES
                and current_rank is not None
                and reopen_rank is not None
                and reopen_rank > current_rank
            ):
                blockers.append("invalidation_target_must_not_be_downstream")
            if reopen_authority == state["current"]["authority_identity"]:
                blockers.append("reopen_authority_must_change_identity")
            invalidated_ids = {row.get("identity") for row in state.get("invalidated_authorities", []) if isinstance(row, dict)}
            if reopen_authority in invalidated_ids:
                blockers.append("reopen_authority_previously_invalidated")
            next_signals = merge_signals(state["signals"], additions)
            if reopen_signal not in next_signals:
                next_signals = merge_signals(next_signals, [reopen_signal])
            transition.update(
                {
                    "to_signal": reopen_signal,
                    "to_stage": signal_stage(reopen_signal),
                    "to_authority_identity": reopen_authority,
                }
            )
            if not blockers:
                route = route_for_owner(next_signals, reopen_signal, state["route_budget"])
                invalidated_identity = state["current"]["authority_identity"]
                try:
                    selective = _selective_decision_invalidation(
                        state, event, proof_verdict, reopen_signal
                    )
                except ValueError as exc:
                    blockers.append(f"invalid_decision_invalidation:{exc}")
                    selective = None
                if blockers:
                    cascade = []
                elif selective is None:
                    cascade = _invalidation_cascade(state, reopen_signal)
                else:
                    invalidated_decisions, preserved_decisions, cascade, impact_plan = selective
                    transition["revalidation_plan"] = impact_plan
                    transition["stale_decision_ids"] = _plain_string_list(
                        event.get("stale_decision_ids"), "event.stale_decision_ids"
                    )
                    transition["invalidated_decision_ids"] = invalidated_decisions
                    transition["preserved_decision_ids"] = preserved_decisions
                if not blockers:
                    existing_invalidated = {
                        row.get("identity") for row in next_state.get("invalidated_authorities", []) if isinstance(row, dict)
                    }
                    next_state["signals"] = next_signals
                    next_state["generation"] += 1
                    _apply_route_to_state(next_state, route, reopen_authority)
                    if reopen_authority not in next_state["authority_lineage"]:
                        next_state["authority_lineage"].append(reopen_authority)
                    for identity in cascade:
                        if identity in existing_invalidated:
                            continue
                        next_state["invalidated_authorities"].append(
                            {
                                "generation": next_state["generation"],
                                "identity": identity,
                                "reopened_by": reopen_signal,
                                "proof_identity": invalidated_identity,
                            }
                        )
                        existing_invalidated.add(identity)
                    transition["invalidated_authority_identities"] = cascade
                    transition["superseded_receipt_hashes"] = _receipt_hashes_for_authorities(state, cascade)
                    next_state["history"].append(
                        {
                            "generation": next_state["generation"],
                            "event": "invalidate",
                            **transition,
                            "invalidated_authority_identity": invalidated_identity,
                            "invalidated_authority_identities": cascade,
                        }
                    )

    elif event_type == "complete":
        if state.get("deferred_signals"):
            blockers.append("deferred_stage_owners_remain")
        transition.update({"to_signal": None, "to_stage": "completed"})
        if not blockers:
            next_state["generation"] += 1
            next_state["status"] = "completed"
            next_state["history"].append(
                {
                    "generation": next_state["generation"],
                    "event": "complete",
                    **transition,
                    "proof_identity": state["current"]["authority_identity"],
                }
            )

    receipt = None
    if not blockers:
        receipt = _finalize_transition_receipt(state, next_state, event, transition, event.get("proof_bundle"))

    return {
        "transition_allowed": not blockers,
        "blockers": sorted(set(blockers)),
        "transition": transition,
        "proof": proof_verdict,
        "transition_receipt": receipt,
        "next_state": next_state if not blockers else None,
        "note": "Metadata/state gate only. It prevents stale or unproven owner changes and emits an immutable proof-bound transition receipt; engineering judgment still decides whether the declared proof semantically closes the current owner's contract.",
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
    init.add_argument("--signals", required=True)
    init.add_argument("--authority", required=True)
    init.add_argument("--mission-id", required=True)
    init.add_argument("--max", type=int, default=7, dest="max_refs")
    init.add_argument("--json", action="store_true")

    apply = sub.add_parser("apply")
    apply.add_argument("state")
    apply.add_argument("event")
    apply.add_argument("--now", help="ISO timestamp for deterministic freshness checks")
    apply.add_argument("--json", action="store_true")

    args = parser.parse_args()
    try:
        if args.command == "init":
            payload = initialize_state(
                args.signals,
                authority_identity=args.authority,
                mission_id=args.mission_id,
                max_refs=args.max_refs,
            )
            code = 0
        else:
            state = _read_json(args.state)
            event = _read_json(args.event)
            now = parse_time(args.now) if args.now else None
            payload = apply_event(state, event, now=now)
            code = 0 if payload["transition_allowed"] else 1
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if getattr(args, "json", False):
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        if args.command == "init":
            print("# Owner state initialized")
            print("mission:", payload["mission_id"])
            print("generation:", payload["generation"])
            print("owner:", payload["current"]["signal"], f"[{payload['current']['stage']}]")
        else:
            print("# Owner transition gate")
            print("status:", "PASS" if payload["transition_allowed"] else "BLOCKED")
            if payload["blockers"]:
                print("blockers:", ", ".join(payload["blockers"]))
            if payload["transition_allowed"]:
                ns = payload["next_state"]
                print("generation:", ns["generation"])
                print("owner:", ns["current"]["signal"], f"[{ns['current']['stage']}]")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
