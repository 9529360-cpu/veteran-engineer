import datetime as dt
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from owner_transition_gate import apply_event, initialize_state, validate_state  # noqa: E402

NOW = dt.datetime(2026, 9, 18, 10, 0, tzinfo=dt.timezone.utc)


def proof(identity: str, claim_id: str = "handoff-ready", *, result: str = "pass", level: str = "focused"):
    return {
        "change_identity": identity,
        "claims": [
            {
                "id": claim_id,
                "claim": f"{claim_id} is proven for the current authority",
                "required_level": level,
                "evidence_ids": ["e1"],
            }
        ],
        "evidence": [
            {
                "id": "e1",
                "level": level,
                "applies_to": [identity],
                "result": result,
                "observed_at": "2026-09-18T09:30:00Z",
                "max_age_hours": 2,
            }
        ],
    }


def event_base(state, event: str, claim_id: str = "handoff-ready"):
    return {
        "event": event,
        "expected_generation": state["generation"],
        "expected_ledger_head_hash": state["decision_ledger_head_hash"],
        "from_signal": state["current"]["signal"],
        "from_authority_identity": state["current"]["authority_identity"],
        "required_claim_ids": [claim_id],
        "proof_bundle": proof(state["current"]["authority_identity"], claim_id),
    }


def paths(state):
    return [row["path"] for row in state["references"]]


def deferred_signals(state):
    return [row["signal"] for row in state["deferred_signals"]]


def upstream_signals(state):
    return [row["signal"] for row in state["closed_upstream_signals"]]


def test_initialize_binds_primary_owner_generation_and_authority_identity():
    state = initialize_state(
        "product-design,security,migration,release",
        authority_identity="design-contract:v1",
        mission_id="m1",
    )
    assert state["generation"] == 1
    assert state["current"]["signal"] == "product-design"
    assert state["current"]["stage"] == "design"
    assert state["current"]["authority_identity"] == "design-contract:v1"
    assert deferred_signals(state) == ["migration", "release"]
    assert state["authority_lineage"] == ["design-contract:v1"]


def test_handoff_cannot_skip_a_deferred_intermediate_stage_owner():
    state = initialize_state(
        "product-design,security,migration,release",
        authority_identity="design-contract:v1",
        mission_id="m1",
    )
    event = event_base(state, "handoff")
    event.update(
        {
            "target_signal": "fullstack",
            "add_signals": ["fullstack"],
            "next_authority_identity": "implementation-contract:v1",
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "skips_deferred_stage_owner:migration" in verdict["blockers"]
    assert verdict["next_state"] is None


def test_proven_handoff_promotes_next_owner_and_drops_closed_upstream_specialist_context():
    state = initialize_state(
        "product-design,security,migration,release",
        authority_identity="design-contract:v1",
        mission_id="m1",
    )
    event = event_base(state, "handoff", "design-exit")
    event.update(
        {
            "target_signal": "migration",
            "next_authority_identity": "migration-contract:v1",
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    assert next_state["generation"] == 2
    assert next_state["current"]["signal"] == "migration"
    assert next_state["current"]["stage"] == "technical"
    assert next_state["current"]["authority_identity"] == "migration-contract:v1"
    assert set(next_state["active_signals"]) == {"migration", "security"}
    assert deferred_signals(next_state) == ["release"]
    assert upstream_signals(next_state) == ["product-design"]
    assert "references/frontend-product-patterns.md" not in paths(next_state)
    assert "references/data-consistency-migration-patterns.md" in paths(next_state)
    assert next_state["authority_lineage"] == ["design-contract:v1", "migration-contract:v1"]


def test_state_can_advance_from_technical_to_implementation_without_reloading_upstream_design():
    state = initialize_state(
        "product-design,security,migration,release",
        authority_identity="design-contract:v1",
        mission_id="m1",
    )
    first = event_base(state, "handoff", "design-exit")
    first.update({"target_signal": "migration", "next_authority_identity": "migration-contract:v1"})
    state = apply_event(state, first, now=NOW)["next_state"]

    second = event_base(state, "handoff", "migration-exit")
    second.update(
        {
            "target_signal": "fullstack",
            "add_signals": ["fullstack"],
            "next_authority_identity": "implementation-candidate:v1",
        }
    )
    verdict = apply_event(state, second, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    assert next_state["current"]["signal"] == "fullstack"
    assert next_state["current"]["stage"] == "implementation"
    assert set(next_state["active_signals"]) == {"fullstack", "security"}
    assert set(upstream_signals(next_state)) == {"product-design", "migration"}
    assert deferred_signals(next_state) == ["release"]
    assert "references/full-stack-product-engineering.md" in paths(next_state)
    assert "references/frontend-product-patterns.md" not in paths(next_state)
    assert "references/data-consistency-migration-patterns.md" not in paths(next_state)


def test_handoff_requires_fresh_generation_owner_authority_and_proof():
    state = initialize_state("product-design,fullstack", authority_identity="design:v1", mission_id="m1")
    event = event_base(state, "handoff")
    event.update(
        {
            "expected_generation": 0,
            "from_signal": "migration",
            "from_authority_identity": "design:v0",
            "target_signal": "fullstack",
            "next_authority_identity": "impl:v1",
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert {"stale_generation", "stale_owner", "stale_authority_identity"} <= set(verdict["blockers"])


def test_proof_bundle_must_apply_to_exact_current_authority_identity():
    state = initialize_state("product-design,fullstack", authority_identity="design:v1", mission_id="m1")
    event = event_base(state, "handoff")
    event["proof_bundle"] = proof("design:other")
    event.update({"target_signal": "fullstack", "next_authority_identity": "impl:v1"})
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "proof_identity_mismatch" in verdict["blockers"]


def test_backward_handoff_is_blocked_and_requires_invalidation_event():
    state = initialize_state("review,product-design", authority_identity="candidate:v1", mission_id="m1")
    assert state["current"]["stage"] == "review"
    event = event_base(state, "handoff")
    event.update({"target_signal": "product-design", "next_authority_identity": "design:v2"})
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "backward_transition_requires_invalidation" in verdict["blockers"]


def test_invalidation_reopens_smallest_responsible_owner_and_records_invalidated_identity():
    state = initialize_state("review,product-design", authority_identity="candidate:v1", mission_id="m1")
    event = event_base(state, "invalidate", "contract-stale")
    event.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design-contract:v2",
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    assert next_state["generation"] == 2
    assert next_state["current"]["signal"] == "product-design"
    assert next_state["current"]["stage"] == "design"
    assert next_state["invalidated_authorities"][-1]["identity"] == "candidate:v1"
    assert next_state["history"][-1]["event"] == "invalidate"


def test_completion_is_blocked_while_future_stage_owners_remain():
    state = initialize_state("fullstack,release", authority_identity="candidate:v1", mission_id="m1")
    assert state["current"]["stage"] == "implementation"
    event = event_base(state, "complete", "completion-ready")
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "deferred_stage_owners_remain" in verdict["blockers"]


def test_completion_succeeds_only_after_no_future_stage_owner_remains():
    state = initialize_state("fullstack", authority_identity="candidate:v1", mission_id="m1")
    event = event_base(state, "complete", "completion-ready")
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    assert next_state["status"] == "completed"
    assert next_state["generation"] == 2
    assert next_state["history"][-1]["event"] == "complete"


def test_required_claim_ids_are_part_of_the_handoff_contract():
    state = initialize_state("product-design,fullstack", authority_identity="design:v1", mission_id="m1")
    event = event_base(state, "handoff", "design-exit")
    event["required_claim_ids"] = ["different-required-claim"]
    event.update({"target_signal": "fullstack", "next_authority_identity": "impl:v1"})
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "required_claim_not_proven:different-required-claim" in verdict["blockers"]


def test_initial_review_state_normalizes_design_as_closed_upstream():
    state = initialize_state("review,product-design", authority_identity="candidate:v1", mission_id="m1")
    assert state["current"]["signal"] == "review"
    assert upstream_signals(state) == ["product-design"]
    assert deferred_signals(state) == []
    validate_state(state)


def test_invalidation_cannot_reopen_a_downstream_owner():
    state = initialize_state("product-design", authority_identity="design:v1", mission_id="m1")
    event = event_base(state, "invalidate", "contract-stale")
    event.update(
        {
            "reopen_signal": "fullstack",
            "add_signals": ["fullstack"],
            "reopen_authority_identity": "implementation:v1",
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "invalidation_target_must_not_be_downstream" in verdict["blockers"]


def test_invalidated_authority_identity_cannot_be_reused_for_later_handoff():
    state = initialize_state("review,product-design", authority_identity="candidate:v1", mission_id="m1")
    invalidate = event_base(state, "invalidate", "contract-stale")
    invalidate.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design:v2",
        }
    )
    state = apply_event(state, invalidate, now=NOW)["next_state"]

    handoff = event_base(state, "handoff", "design-exit")
    handoff.update(
        {
            "target_signal": "review",
            "next_authority_identity": "candidate:v1",
        }
    )
    verdict = apply_event(state, handoff, now=NOW)
    assert verdict["transition_allowed"] is False
    assert "next_authority_previously_invalidated" in verdict["blockers"]


def test_tampered_signal_partition_is_rejected_before_transition():
    state = initialize_state(
        "product-design,security,migration",
        authority_identity="design:v1",
        mission_id="m1",
    )
    state["deferred_signals"] = []
    with pytest.raises(ValueError, match="signal partitions must cover mission signals exactly"):
        validate_state(state)


def state_through_review():
    state = initialize_state(
        "product-design,migration",
        authority_identity="design:v1",
        mission_id="cascade",
    )
    event = event_base(state, "handoff", "design-exit")
    event.update({"target_signal": "migration", "next_authority_identity": "migration:v1"})
    state = apply_event(state, event, now=NOW)["next_state"]

    event = event_base(state, "handoff", "migration-exit")
    event.update({
        "target_signal": "fullstack",
        "add_signals": ["fullstack"],
        "next_authority_identity": "implementation:v1",
    })
    state = apply_event(state, event, now=NOW)["next_state"]

    event = event_base(state, "handoff", "implementation-exit")
    event.update({
        "target_signal": "review",
        "add_signals": ["review"],
        "next_authority_identity": "review-candidate:v1",
    })
    return apply_event(state, event, now=NOW)["next_state"]


def test_reopening_design_invalidates_every_downstream_primary_authority_derived_from_it():
    state = state_through_review()
    assert state["authority_lineage"] == ["design:v1", "migration:v1", "implementation:v1", "review-candidate:v1"]

    event = event_base(state, "invalidate", "design-contract-stale")
    event.update({
        "reopen_signal": "product-design",
        "reopen_authority_identity": "design:v2",
    })
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    invalidated = [row["identity"] for row in next_state["invalidated_authorities"]]
    assert invalidated == ["design:v1", "migration:v1", "implementation:v1", "review-candidate:v1"]
    assert next_state["history"][-1]["invalidated_authority_identities"] == invalidated
    assert next_state["current"]["authority_identity"] == "design:v2"

    reuse = event_base(next_state, "handoff", "design-exit")
    reuse.update({"target_signal": "migration", "next_authority_identity": "migration:v1"})
    reuse_verdict = apply_event(next_state, reuse, now=NOW)
    assert reuse_verdict["transition_allowed"] is False
    assert "next_authority_previously_invalidated" in reuse_verdict["blockers"]


def test_reopening_implementation_invalidates_only_that_owner_and_its_downstream_lineage():
    state = state_through_review()
    event = event_base(state, "invalidate", "implementation-contract-stale")
    event.update({
        "reopen_signal": "fullstack",
        "reopen_authority_identity": "implementation:v2",
    })
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    invalidated = [row["identity"] for row in verdict["next_state"]["invalidated_authorities"]]
    assert invalidated == ["implementation:v1", "review-candidate:v1"]
    assert "design:v1" not in invalidated
    assert "migration:v1" not in invalidated


def decision_record(decision_id, decision_key, semantic_value, *, depends=None, replaces=None):
    return {
        "decision_id": decision_id,
        "decision_key": decision_key,
        "semantic_value": semantic_value,
        "depends_on_decision_ids": depends or [],
        "replaces_decision_id": replaces,
    }


def state_with_decision_graph_through_review():
    state = initialize_state(
        "product-design,migration",
        authority_identity="design:v1",
        mission_id="decision-graph",
    )
    first = event_base(state, "handoff", "design-exit")
    first.update(
        {
            "target_signal": "migration",
            "next_authority_identity": "migration:v1",
            "decision_records": [
                decision_record("D.design@1", "design.layout", {"mode": "dense"})
            ],
        }
    )
    state = apply_event(state, first, now=NOW)["next_state"]

    second = event_base(state, "handoff", "migration-exit")
    second.update(
        {
            "target_signal": "fullstack",
            "add_signals": ["fullstack"],
            "next_authority_identity": "implementation:v1",
            "decision_records": [
                decision_record(
                    "D.migration@1",
                    "migration.schema",
                    {"version": 2},
                    depends=["D.design@1"],
                )
            ],
        }
    )
    state = apply_event(state, second, now=NOW)["next_state"]

    third = event_base(state, "handoff", "implementation-exit")
    third.update(
        {
            "target_signal": "review",
            "add_signals": ["review"],
            "next_authority_identity": "review:v1",
            "decision_records": [
                decision_record(
                    "D.implementation@1",
                    "implementation.api",
                    {"version": 4},
                    depends=["D.migration@1"],
                )
            ],
        }
    )
    return apply_event(state, third, now=NOW)["next_state"]


def test_clause_level_invalidation_prunes_preserved_subgraph_and_keeps_unaffected_authorities_reusable():
    state = state_with_decision_graph_through_review()
    event = event_base(state, "invalidate", "design-stale")
    event["proof_bundle"]["claims"].append(
        {
            "id": "migration-still-valid",
            "claim": "migration decision remains semantically valid despite the design correction",
            "required_level": "focused",
            "evidence_ids": ["e2"],
        }
    )
    event["proof_bundle"]["evidence"].append(
        {
            "id": "e2",
            "level": "focused",
            "applies_to": [state["current"]["authority_identity"]],
            "result": "pass",
            "observed_at": "2026-09-18T09:30:00Z",
            "max_age_hours": 2,
        }
    )
    event["required_claim_ids"] = ["design-stale", "migration-still-valid"]
    event.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design:v2",
            "stale_decision_ids": ["D.design@1"],
            "preserved_decision_ids": ["D.migration@1"],
            "preservation_claims": {"D.migration@1": "migration-still-valid"},
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    receipt = verdict["transition_receipt"]
    assert receipt["invalidated_decision_ids"] == ["D.design@1"]
    assert receipt["preserved_decision_ids"] == ["D.migration@1"]
    assert receipt["invalidated_authority_identities"] == ["design:v1", "review:v1"]
    assert receipt["revalidation_plan_hash"] == verdict["transition"]["revalidation_plan"]["plan_hash"]
    assert receipt["revalidation_plan_summary"] == {
        "recompute_decision_ids": ["D.design@1"],
        "revalidate_waves": [],
        "preservation_barrier_decision_ids": ["D.migration@1"],
        "change_pruned_root_decision_ids": [],
    }
    next_state = verdict["next_state"]
    assert next_state["decision_dependency_graph"]["nodes"]["D.design@1"]["status"] == "invalidated"
    assert next_state["decision_dependency_graph"]["nodes"]["D.migration@1"]["status"] == "active"
    assert next_state["decision_dependency_graph"]["nodes"]["D.implementation@1"]["status"] == "active"

    # The preserved migration authority can be reused after the reopened design
    # owner produces a new version of the stale decision.
    handoff = event_base(next_state, "handoff", "design-v2-exit")
    handoff.update(
        {
            "target_signal": "migration",
            "next_authority_identity": "migration:v1",
            "decision_records": [
                decision_record(
                    "D.design@2",
                    "design.layout",
                    {"mode": "roomy"},
                    replaces="D.design@1",
                )
            ],
        }
    )
    reuse = apply_event(next_state, handoff, now=NOW)
    assert reuse["transition_allowed"] is True
    assert reuse["next_state"]["current"]["authority_identity"] == "migration:v1"


def test_precise_invalidation_without_pruning_invalidates_only_reverse_semantic_closure_plus_current_reviewer():
    state = state_with_decision_graph_through_review()
    event = event_base(state, "invalidate", "design-stale")
    event.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design:v2",
            "stale_decision_ids": ["D.design@1"],
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is True
    assert verdict["transition_receipt"]["invalidated_decision_ids"] == [
        "D.design@1",
        "D.migration@1",
        "D.implementation@1",
    ]
    assert verdict["transition_receipt"]["invalidated_authority_identities"] == [
        "design:v1",
        "migration:v1",
        "implementation:v1",
        "review:v1",
    ]


def test_preservation_barrier_must_be_inside_the_actual_affected_closure():
    state = initialize_state(
        "product-design,migration",
        authority_identity="design:v1",
        mission_id="unrelated-preservation",
    )
    first = event_base(state, "handoff", "design-exit")
    first.update(
        {
            "target_signal": "migration",
            "next_authority_identity": "migration:v1",
            "decision_records": [
                decision_record("D.design@1", "design.layout", {"mode": "dense"}),
            ],
        }
    )
    state = apply_event(state, first, now=NOW)["next_state"]

    second = event_base(state, "handoff", "migration-exit")
    second.update(
        {
            "target_signal": "fullstack",
            "add_signals": ["fullstack"],
            "next_authority_identity": "implementation:v1",
            "decision_records": [
                decision_record(
                    "D.migration@1",
                    "migration.schema",
                    {"version": 2},
                    depends=["D.design@1"],
                ),
                decision_record(
                    "D.audit@1",
                    "migration.audit-log",
                    {"retention_days": 30},
                ),
            ],
        }
    )
    state = apply_event(state, second, now=NOW)["next_state"]

    third = event_base(state, "handoff", "implementation-exit")
    third.update(
        {
            "target_signal": "review",
            "add_signals": ["review"],
            "next_authority_identity": "review:v1",
            "decision_records": [
                decision_record(
                    "D.implementation@1",
                    "implementation.api",
                    {"version": 4},
                    depends=["D.migration@1"],
                )
            ],
        }
    )
    state = apply_event(state, third, now=NOW)["next_state"]

    event = event_base(state, "invalidate", "design-stale")
    event["proof_bundle"]["claims"].append(
        {
            "id": "audit-still-valid",
            "claim": "the independent audit-log decision remains valid",
            "required_level": "focused",
            "evidence_ids": ["e2"],
        }
    )
    event["proof_bundle"]["evidence"].append(
        {
            "id": "e2",
            "level": "focused",
            "applies_to": [state["current"]["authority_identity"]],
            "result": "pass",
            "observed_at": "2026-09-18T09:30:00Z",
            "max_age_hours": 2,
        }
    )
    event["required_claim_ids"] = ["design-stale", "audit-still-valid"]
    event.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design:v2",
            "stale_decision_ids": ["D.design@1"],
            "preserved_decision_ids": ["D.audit@1"],
            "preservation_claims": {"D.audit@1": "audit-still-valid"},
        }
    )

    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert any("not in the affected closure" in item for item in verdict["blockers"])


def test_preservation_claim_must_be_present_and_passing_before_it_can_prune_invalidation():
    state = state_with_decision_graph_through_review()
    event = event_base(state, "invalidate", "design-stale")
    event.update(
        {
            "reopen_signal": "product-design",
            "reopen_authority_identity": "design:v2",
            "stale_decision_ids": ["D.design@1"],
            "preserved_decision_ids": ["D.migration@1"],
            "preservation_claims": {"D.migration@1": "missing-claim"},
        }
    )
    verdict = apply_event(state, event, now=NOW)
    assert verdict["transition_allowed"] is False
    assert any("preservation claim is not proven" in item for item in verdict["blockers"])


def test_legacy_owner_state_without_decision_graph_upgrades_on_first_new_transition():
    state = initialize_state("product-design,migration", authority_identity="design:v1", mission_id="legacy-upgrade")
    state.pop("decision_dependency_graph")
    state.pop("decision_dependency_graph_hash")
    receipt = state["last_transition_receipt"]
    for field in [
        "decision_records",
        "stale_decision_ids",
        "invalidated_decision_ids",
        "preserved_decision_ids",
        "decision_graph_hash_after",
    ]:
        receipt.pop(field, None)
    from transition_receipt import receipt_hash
    receipt["receipt_hash"] = receipt_hash(receipt)
    state["decision_ledger_head_hash"] = receipt["receipt_hash"]
    state["history"][-1]["receipt_hash"] = receipt["receipt_hash"]

    validate_state(state)
    payload = event_base(state, "handoff", "design-exit")
    payload["expected_ledger_head_hash"] = state["decision_ledger_head_hash"]
    payload.update({"target_signal": "migration", "next_authority_identity": "migration:v1"})
    verdict = apply_event(state, payload, now=NOW)
    assert verdict["transition_allowed"] is True
    next_state = verdict["next_state"]
    assert next_state["decision_dependency_graph"] == {"schema_version": 1, "nodes": {}}
    assert next_state["last_transition_receipt"]["decision_graph_hash_after"] == next_state["decision_dependency_graph_hash"]
