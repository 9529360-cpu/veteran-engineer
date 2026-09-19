import datetime as dt
import copy
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from decision_ledger_gate import append_receipt, init_ledger, project_ledger, validate_ledger  # noqa: E402
from owner_transition_gate import apply_event, initialize_state  # noqa: E402
from transition_receipt import receipt_hash, validate_receipt  # noqa: E402

NOW = dt.datetime(2026, 9, 18, 10, 0, tzinfo=dt.timezone.utc)


def proof(identity: str, claim_id: str):
    return {
        "change_identity": identity,
        "claims": [{
            "id": claim_id,
            "claim": f"{claim_id} closes the owner contract",
            "required_level": "focused",
            "evidence_ids": [f"ev-{claim_id}"],
        }],
        "evidence": [{
            "id": f"ev-{claim_id}",
            "level": "focused",
            "applies_to": [identity],
            "result": "pass",
            "observed_at": "2026-09-18T09:30:00Z",
            "max_age_hours": 2,
        }],
    }


def event(state: dict, event_type: str, claim_id: str, **extra):
    payload = {
        "event": event_type,
        "expected_generation": state["generation"],
        "expected_ledger_head_hash": state["decision_ledger_head_hash"],
        "from_signal": state["current"]["signal"],
        "from_authority_identity": state["current"]["authority_identity"],
        "required_claim_ids": [claim_id],
        "closed_clause_ids": [f"clause:{claim_id}"],
        "decision_context": {
            "summary": f"close {claim_id}",
            "open_decisions": ["future-decision"] if event_type != "complete" else [],
            "assumptions": ["repo-truth-remains-current"],
            "dependents": ["downstream-owner"],
        },
        "proof_bundle": proof(state["current"]["authority_identity"], claim_id),
    }
    payload.update(extra)
    return payload


def test_initial_state_binds_a_valid_genesis_receipt_and_ledger_head():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="m1")
    receipt = state["last_transition_receipt"]
    meta = validate_receipt(receipt)
    assert meta["event"] == "initialized"
    assert meta["sequence"] == 1
    assert receipt["receipt_hash"] == state["decision_ledger_head_hash"]
    assert state["decision_ledger_entry_count"] == state["generation"] == 1

    ledger = init_ledger(receipt)
    verified = validate_ledger(ledger)
    assert verified["entry_count"] == 1
    assert verified["head_hash"] == receipt["receipt_hash"]


def test_handoff_receipt_binds_exact_proof_claim_evidence_and_decision_context():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="m1")
    verdict = apply_event(
        state,
        event(state, "handoff", "design-exit", target_signal="migration", next_authority_identity="migration:v1"),
        now=NOW,
    )
    assert verdict["transition_allowed"] is True
    receipt = verdict["transition_receipt"]
    assert receipt["previous_receipt_hash"] == state["decision_ledger_head_hash"]
    assert receipt["closed_claim_ids"] == ["design-exit"]
    assert receipt["closed_clause_ids"] == ["clause:design-exit"]
    assert receipt["evidence_ids"] == ["ev-design-exit"]
    assert receipt["decision_context"]["summary"] == "close design-exit"
    assert receipt["proof_change_identity"] == "design:v1"
    assert verdict["next_state"]["decision_ledger_head_hash"] == receipt["receipt_hash"]
    assert verdict["next_state"]["decision_ledger_entry_count"] == 2


def test_append_only_ledger_rejects_stale_head_and_tampered_receipts():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="m1")
    ledger = init_ledger(state["last_transition_receipt"])
    verdict = apply_event(
        state,
        event(state, "handoff", "design-exit", target_signal="migration", next_authority_identity="migration:v1"),
        now=NOW,
    )
    receipt = verdict["transition_receipt"]
    with pytest.raises(ValueError, match="stale ledger head"):
        append_receipt(ledger, receipt, expected_head_hash="sha256:" + "0" * 64)

    ledger = append_receipt(ledger, receipt, expected_head_hash=ledger["head_hash"])
    assert validate_ledger(ledger)["entry_count"] == 2

    tampered = copy.deepcopy(ledger)
    tampered["entries"][1]["decision_context"]["summary"] = "rewritten after the fact"
    with pytest.raises(ValueError, match="receipt hash mismatch"):
        validate_ledger(tampered)


def test_invalidation_receipt_supersedes_the_reopened_owner_and_downstream_receipts_only():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="m1")
    ledger = init_ledger(state["last_transition_receipt"])

    verdict = apply_event(state, event(state, "handoff", "design-exit", target_signal="migration", next_authority_identity="migration:v1"), now=NOW)
    ledger = append_receipt(ledger, verdict["transition_receipt"], expected_head_hash=ledger["head_hash"])
    state = verdict["next_state"]

    verdict = apply_event(
        state,
        event(
            state,
            "handoff",
            "migration-exit",
            target_signal="fullstack",
            add_signals=["fullstack"],
            next_authority_identity="implementation:v1",
        ),
        now=NOW,
    )
    ledger = append_receipt(ledger, verdict["transition_receipt"], expected_head_hash=ledger["head_hash"])
    state = verdict["next_state"]

    verdict = apply_event(
        state,
        event(
            state,
            "invalidate",
            "design-stale",
            reopen_signal="product-design",
            reopen_authority_identity="design:v2",
        ),
        now=NOW,
    )
    receipt = verdict["transition_receipt"]
    assert receipt["invalidated_authority_identities"] == ["design:v1", "migration:v1", "implementation:v1"]
    assert receipt["superseded_receipt_hashes"] == [ledger["entries"][0]["receipt_hash"], ledger["entries"][1]["receipt_hash"], ledger["entries"][2]["receipt_hash"]]
    ledger = append_receipt(ledger, receipt, expected_head_hash=ledger["head_hash"])
    projection = project_ledger(ledger)
    assert projection["current"]["authority_identity"] == "design:v2"
    assert set(projection["superseded_receipt_hashes"]) == set(receipt["superseded_receipt_hashes"])


def test_state_transition_rejects_a_stale_decision_ledger_head_even_when_generation_and_owner_match():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="m1")
    payload = event(state, "handoff", "design-exit", target_signal="migration", next_authority_identity="migration:v1")
    payload["expected_ledger_head_hash"] = "sha256:" + "f" * 64
    verdict = apply_event(state, payload, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "stale_decision_ledger_head" in verdict["blockers"]


def test_state_validation_rejects_rewritten_last_receipt_even_if_other_state_fields_are_unchanged():
    state = initialize_state("product-design", authority_identity="design:v1", mission_id="m1")
    state["last_transition_receipt"]["decision_context"]["summary"] = "rewritten"
    from owner_transition_gate import validate_state
    with pytest.raises(ValueError, match="receipt hash mismatch"):
        validate_state(state)


def test_ledger_replay_verifies_decision_dependency_projection_hash_not_only_receipt_chain():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="graph-ledger")
    ledger = init_ledger(state["last_transition_receipt"])
    payload = event(
        state,
        "handoff",
        "design-exit",
        target_signal="migration",
        next_authority_identity="migration:v1",
        decision_records=[
            {
                "decision_id": "D.design@1",
                "decision_key": "design.layout",
                "semantic_value": {"mode": "dense"},
                "clause_ids": ["clause:design-exit"],
            }
        ],
    )
    verdict = apply_event(state, payload, now=NOW)
    ledger = append_receipt(ledger, verdict["transition_receipt"], expected_head_hash=ledger["head_hash"])
    verified = validate_ledger(ledger)
    assert verified["active_decision_ids"] == ["D.design@1"]
    assert verified["decision_graph_hash"] == verdict["next_state"]["decision_dependency_graph_hash"]
    projection = project_ledger(ledger)
    assert projection["decisions_by_clause"]["clause:design-exit"] == ["D.design@1"]

    # Simulate an attacker rewriting provenance and then recomputing only the
    # receipt/ledger hash chain. The independent graph projection commitment
    # must still fail because decision_graph_hash_after was not recomputed.
    forged = copy.deepcopy(ledger)
    forged_receipt = forged["entries"][-1]
    forged_receipt["decision_records"][0]["semantic_value"] = {"mode": "roomy"}
    from decision_dependency_graph import hash_json
    forged_receipt["decision_records"][0]["semantic_hash"] = hash_json(
        {"decision_key": "design.layout", "semantic_value": {"mode": "roomy"}}
    )
    forged_receipt["receipt_hash"] = receipt_hash(forged_receipt)
    forged["head_hash"] = forged_receipt["receipt_hash"]
    with pytest.raises(ValueError, match="decision graph hash mismatch"):
        validate_ledger(forged)
