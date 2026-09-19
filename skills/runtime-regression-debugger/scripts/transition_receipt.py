#!/usr/bin/env python3
"""Build and validate deterministic proof-bound owner transition receipts."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from decision_dependency_graph import validate_decision_records

RECEIPT_SCHEMA = "veteran-transition-receipt-v1"


def _require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def _require_int(value: Any, path: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{path} must be an integer >= {minimum}")
    return value


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


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def hash_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def receipt_hash(receipt: dict) -> str:
    payload = {key: value for key, value in receipt.items() if key != "receipt_hash"}
    return hash_json(payload)


def _owner(value: Any, path: str, *, nullable: bool = False) -> dict | None:
    if value is None and nullable:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    signal = value.get("signal")
    stage = value.get("stage")
    authority = value.get("authority_identity")
    if signal is not None:
        signal = _require_string(signal, f"{path}.signal")
    if stage is not None:
        stage = _require_string(stage, f"{path}.stage")
    if authority is not None:
        authority = _require_string(authority, f"{path}.authority_identity")
    return {"signal": signal, "stage": stage, "authority_identity": authority}


def normalize_decision_context(value: Any, *, default_summary: str) -> dict:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("decision_context must be an object")
    summary = value.get("summary", default_summary)
    summary = _require_string(summary, "decision_context.summary")
    return {
        "summary": summary,
        "open_decisions": _string_list(value.get("open_decisions", []), "decision_context.open_decisions"),
        "assumptions": _string_list(value.get("assumptions", []), "decision_context.assumptions"),
        "dependents": _string_list(value.get("dependents", []), "decision_context.dependents"),
    }


def evidence_ids_from_bundle(proof_bundle: dict | None, claim_ids: list[str]) -> list[str]:
    if not isinstance(proof_bundle, dict):
        return []
    wanted = set(claim_ids)
    out: list[str] = []
    seen: set[str] = set()
    claims = proof_bundle.get("claims")
    if not isinstance(claims, list):
        return []
    for claim in claims:
        if not isinstance(claim, dict) or claim.get("id") not in wanted:
            continue
        refs = claim.get("evidence_ids", [])
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if isinstance(ref, str) and ref.strip() and ref.strip() not in seen:
                seen.add(ref.strip())
                out.append(ref.strip())
    return out


def build_receipt(
    *,
    mission_id: str,
    sequence: int,
    event: str,
    generation_before: int,
    generation_after: int,
    previous_receipt_hash: str | None,
    from_owner: dict | None,
    to_owner: dict | None,
    proof_bundle: dict | None,
    closed_claim_ids: list[str] | None = None,
    closed_clause_ids: list[str] | None = None,
    invalidated_authority_identities: list[str] | None = None,
    superseded_receipt_hashes: list[str] | None = None,
    decision_records: list[dict] | None = None,
    stale_decision_ids: list[str] | None = None,
    invalidated_decision_ids: list[str] | None = None,
    preserved_decision_ids: list[str] | None = None,
    decision_graph_hash_after: str | None = None,
    revalidation_plan_hash: str | None = None,
    revalidation_plan_summary: dict | None = None,
    decision_context: dict | None = None,
) -> dict:
    mission_id = _require_string(mission_id, "mission_id")
    sequence = _require_int(sequence, "sequence", 1)
    event = _require_string(event, "event").lower()
    if event not in {"initialized", "handoff", "invalidate", "complete"}:
        raise ValueError("event must be initialized, handoff, invalidate, or complete")
    generation_before = _require_int(generation_before, "generation_before", 0)
    generation_after = _require_int(generation_after, "generation_after", 1)
    if generation_after != generation_before + 1:
        raise ValueError("generation_after must equal generation_before + 1")
    if sequence != generation_after:
        raise ValueError("receipt sequence must equal generation_after")
    if previous_receipt_hash is not None:
        previous_receipt_hash = _require_string(previous_receipt_hash, "previous_receipt_hash")
    from_owner = _owner(from_owner, "from", nullable=True)
    to_owner = _owner(to_owner, "to", nullable=True)
    closed_claim_ids = _string_list(closed_claim_ids or [], "closed_claim_ids")
    closed_clause_ids = _string_list(closed_clause_ids if closed_clause_ids is not None else closed_claim_ids, "closed_clause_ids")
    invalidated = _string_list(invalidated_authority_identities or [], "invalidated_authority_identities")
    superseded = _string_list(superseded_receipt_hashes or [], "superseded_receipt_hashes")
    decision_records = validate_decision_records(decision_records or [])
    stale_decision_ids = _string_list(stale_decision_ids or [], "stale_decision_ids")
    invalidated_decision_ids = _string_list(invalidated_decision_ids or [], "invalidated_decision_ids")
    preserved_decision_ids = _string_list(preserved_decision_ids or [], "preserved_decision_ids")
    decision_graph_hash_after = _require_string(decision_graph_hash_after, "decision_graph_hash_after")

    if set(stale_decision_ids) & set(preserved_decision_ids):
        raise ValueError("stale decisions cannot be preserved")
    if not set(stale_decision_ids).issubset(set(invalidated_decision_ids)) and stale_decision_ids:
        raise ValueError("stale_decision_ids must be included in invalidated_decision_ids")

    if revalidation_plan_hash is not None:
        revalidation_plan_hash = _require_string(revalidation_plan_hash, "revalidation_plan_hash")
        if not isinstance(revalidation_plan_summary, dict):
            raise ValueError("revalidation_plan_summary must be an object when revalidation_plan_hash is present")
        recompute = _string_list(revalidation_plan_summary.get("recompute_decision_ids", []), "revalidation_plan_summary.recompute_decision_ids")
        preserved_summary = _string_list(revalidation_plan_summary.get("preservation_barrier_decision_ids", []), "revalidation_plan_summary.preservation_barrier_decision_ids")
        pruned_roots = _string_list(revalidation_plan_summary.get("change_pruned_root_decision_ids", []), "revalidation_plan_summary.change_pruned_root_decision_ids")
        waves = revalidation_plan_summary.get("revalidate_waves", [])
        if not isinstance(waves, list):
            raise ValueError("revalidation_plan_summary.revalidate_waves must be a list")
        normalized_waves = [_string_list(wave, f"revalidation_plan_summary.revalidate_waves[{index}]") for index, wave in enumerate(waves)]
        revalidation_plan_summary = {
            "recompute_decision_ids": recompute,
            "revalidate_waves": normalized_waves,
            "preservation_barrier_decision_ids": preserved_summary,
            "change_pruned_root_decision_ids": pruned_roots,
        }
    elif revalidation_plan_summary is not None:
        raise ValueError("revalidation_plan_summary requires revalidation_plan_hash")

    if event == "initialized":
        if generation_before != 0 or previous_receipt_hash is not None or from_owner is not None or to_owner is None:
            raise ValueError("initialized receipt must start generation 0->1 with no previous receipt/from owner")
        if proof_bundle is not None:
            raise ValueError("initialized receipt must not carry a proof bundle")
    else:
        if from_owner is None:
            raise ValueError(f"{event} receipt requires a from owner")
        if event == "complete" and to_owner is not None:
            raise ValueError("complete receipt must not carry a to owner")
        if event != "complete" and to_owner is None:
            raise ValueError(f"{event} receipt requires a to owner")
        if not isinstance(proof_bundle, dict):
            raise ValueError(f"{event} receipt requires a proof bundle")

    default_summary = (
        f"initialize {to_owner.get('signal')}"
        if event == "initialized"
        else f"{event} {from_owner.get('signal')} -> {(to_owner or {}).get('signal') or 'completed'}"
    )
    payload = {
        "schema": RECEIPT_SCHEMA,
        "mission_id": mission_id,
        "sequence": sequence,
        "event": event,
        "generation_before": generation_before,
        "generation_after": generation_after,
        "previous_receipt_hash": previous_receipt_hash,
        "from": from_owner,
        "to": to_owner,
        "proof_bundle_hash": hash_json(proof_bundle) if isinstance(proof_bundle, dict) else None,
        "proof_change_identity": proof_bundle.get("change_identity") if isinstance(proof_bundle, dict) else None,
        "closed_claim_ids": closed_claim_ids,
        "closed_clause_ids": closed_clause_ids,
        "evidence_ids": evidence_ids_from_bundle(proof_bundle, closed_claim_ids),
        "invalidated_authority_identities": invalidated,
        "superseded_receipt_hashes": superseded,
        "decision_records": decision_records,
        "stale_decision_ids": stale_decision_ids,
        "invalidated_decision_ids": invalidated_decision_ids,
        "preserved_decision_ids": preserved_decision_ids,
        "decision_graph_hash_after": decision_graph_hash_after,
        "decision_context": normalize_decision_context(decision_context, default_summary=default_summary),
    }
    if revalidation_plan_hash is not None:
        payload["revalidation_plan_hash"] = revalidation_plan_hash
        payload["revalidation_plan_summary"] = revalidation_plan_summary
    payload["receipt_hash"] = hash_json(payload)
    return payload


def validate_receipt(receipt: Any) -> dict:
    if not isinstance(receipt, dict):
        raise ValueError("receipt must be an object")
    if receipt.get("schema") != RECEIPT_SCHEMA:
        raise ValueError(f"receipt.schema must be {RECEIPT_SCHEMA}")
    mission_id = _require_string(receipt.get("mission_id"), "receipt.mission_id")
    sequence = _require_int(receipt.get("sequence"), "receipt.sequence", 1)
    event = _require_string(receipt.get("event"), "receipt.event").lower()
    if event not in {"initialized", "handoff", "invalidate", "complete"}:
        raise ValueError("receipt.event is invalid")
    before = _require_int(receipt.get("generation_before"), "receipt.generation_before", 0)
    after = _require_int(receipt.get("generation_after"), "receipt.generation_after", 1)
    if after != before + 1 or sequence != after:
        raise ValueError("receipt generation/sequence continuity is invalid")
    previous = receipt.get("previous_receipt_hash")
    if previous is not None:
        previous = _require_string(previous, "receipt.previous_receipt_hash")
    from_owner = _owner(receipt.get("from"), "receipt.from", nullable=True)
    to_owner = _owner(receipt.get("to"), "receipt.to", nullable=True)
    _string_list(receipt.get("closed_claim_ids", []), "receipt.closed_claim_ids")
    _string_list(receipt.get("closed_clause_ids", []), "receipt.closed_clause_ids")
    _string_list(receipt.get("evidence_ids", []), "receipt.evidence_ids")
    _string_list(receipt.get("invalidated_authority_identities", []), "receipt.invalidated_authority_identities")
    _string_list(receipt.get("superseded_receipt_hashes", []), "receipt.superseded_receipt_hashes")
    validate_decision_records(receipt.get("decision_records", []))
    stale_decision_ids = _string_list(receipt.get("stale_decision_ids", []), "receipt.stale_decision_ids")
    invalidated_decision_ids = _string_list(receipt.get("invalidated_decision_ids", []), "receipt.invalidated_decision_ids")
    preserved_decision_ids = _string_list(receipt.get("preserved_decision_ids", []), "receipt.preserved_decision_ids")
    if set(stale_decision_ids) & set(preserved_decision_ids):
        raise ValueError("receipt stale decisions cannot be preserved")
    if stale_decision_ids and not set(stale_decision_ids).issubset(set(invalidated_decision_ids)):
        raise ValueError("receipt stale_decision_ids must be included in invalidated_decision_ids")
    decision_graph_hash_after = receipt.get("decision_graph_hash_after")
    if decision_graph_hash_after is not None:
        _require_string(decision_graph_hash_after, "receipt.decision_graph_hash_after")
    if "revalidation_plan_hash" in receipt:
        _require_string(receipt.get("revalidation_plan_hash"), "receipt.revalidation_plan_hash")
        summary = receipt.get("revalidation_plan_summary")
        if not isinstance(summary, dict):
            raise ValueError("receipt.revalidation_plan_summary must be an object")
        _string_list(summary.get("recompute_decision_ids", []), "receipt.revalidation_plan_summary.recompute_decision_ids")
        _string_list(summary.get("preservation_barrier_decision_ids", []), "receipt.revalidation_plan_summary.preservation_barrier_decision_ids")
        _string_list(summary.get("change_pruned_root_decision_ids", []), "receipt.revalidation_plan_summary.change_pruned_root_decision_ids")
        waves = summary.get("revalidate_waves", [])
        if not isinstance(waves, list):
            raise ValueError("receipt.revalidation_plan_summary.revalidate_waves must be a list")
        for index, wave in enumerate(waves):
            _string_list(wave, f"receipt.revalidation_plan_summary.revalidate_waves[{index}]")
    elif "revalidation_plan_summary" in receipt:
        raise ValueError("receipt.revalidation_plan_summary requires revalidation_plan_hash")
    normalize_decision_context(receipt.get("decision_context"), default_summary="transition")
    proof_hash = receipt.get("proof_bundle_hash")
    proof_identity = receipt.get("proof_change_identity")
    if proof_hash is not None:
        _require_string(proof_hash, "receipt.proof_bundle_hash")
    if proof_identity is not None:
        _require_string(proof_identity, "receipt.proof_change_identity")
    if event == "initialized":
        if before != 0 or previous is not None or from_owner is not None or to_owner is None:
            raise ValueError("initialized receipt shape is invalid")
        if proof_hash is not None or proof_identity is not None:
            raise ValueError("initialized receipt cannot bind proof")
    else:
        if from_owner is None:
            raise ValueError(f"{event} receipt requires from owner")
        if proof_hash is None or proof_identity is None:
            raise ValueError(f"{event} receipt requires proof binding")
        if event == "complete" and to_owner is not None:
            raise ValueError("complete receipt cannot carry to owner")
        if event != "complete" and to_owner is None:
            raise ValueError(f"{event} receipt requires to owner")
    declared = _require_string(receipt.get("receipt_hash"), "receipt.receipt_hash")
    computed = receipt_hash(receipt)
    if declared != computed:
        raise ValueError("receipt hash mismatch")
    return {
        "mission_id": mission_id,
        "sequence": sequence,
        "event": event,
        "generation_before": before,
        "generation_after": after,
        "previous_receipt_hash": previous,
        "receipt_hash": declared,
    }
