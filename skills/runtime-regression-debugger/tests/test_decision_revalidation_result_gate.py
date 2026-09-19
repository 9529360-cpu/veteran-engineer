import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from decision_dependency_graph import apply_changes, empty_graph, normalize_decision_records  # noqa: E402
from decision_revalidation_plan import build_revalidation_plan  # noqa: E402
from decision_revalidation_result_gate import (  # noqa: E402
    commit_red_result,
    evaluate_result,
    expected_result_change_identity,
    initialize_result_session,
)


def record(decision_id, key, value, *, depends=None, owner="a1", signal="product-design", replaces=None):
    return normalize_decision_records(
        [
            {
                "decision_id": decision_id,
                "decision_key": key,
                "semantic_value": value,
                "depends_on_decision_ids": depends or [],
                "replaces_decision_id": replaces,
            }
        ],
        owner_signal=signal,
        owner_authority_identity=owner,
        default_clause_ids=["clause:1"],
        default_evidence_ids=["ev:seed"],
    )[0]


def chain():
    graph = empty_graph()
    graph = apply_changes(graph, decision_records=[record("D1", "design.layout", "dense")])
    graph = apply_changes(
        graph,
        decision_records=[record("D2", "migration.schema", "v2", depends=["D1"], owner="a2", signal="migration")],
    )
    graph = apply_changes(
        graph,
        decision_records=[record("D3", "implementation.api", "v4", depends=["D2"], owner="a3", signal="fullstack")],
    )
    return graph


def diamond():
    graph = empty_graph()
    graph = apply_changes(graph, decision_records=[record("D1", "design.contract", "v1")])
    graph = apply_changes(
        graph,
        decision_records=[
            record("D2", "migration.a", "a", depends=["D1"], owner="a2", signal="migration"),
            record("D3", "migration.b", "b", depends=["D1"], owner="a3", signal="migration"),
        ],
    )
    graph = apply_changes(
        graph,
        decision_records=[record("D4", "implementation.merge", "m", depends=["D2", "D3"], owner="a4", signal="fullstack")],
    )
    return graph


def proof(plan_hash, decision_id, authority, *, passed=True):
    identity = expected_result_change_identity(plan_hash, decision_id, authority)
    return {
        "change_identity": identity,
        "claims": [
            {
                "id": "claim:semantic",
                "claim": "semantic output revalidated",
                "required_level": "focused",
                "evidence_ids": ["ev:result"],
            }
        ],
        "evidence": [
            {
                "id": "ev:result",
                "level": "focused",
                "applies_to": [identity],
                "result": "pass" if passed else "fail",
            }
        ],
    }


def result(session, decision_id, value, *, passed=True):
    task = session["tasks"][decision_id]
    return {
        "source_plan_hash": session["source_plan_hash"],
        "decision_id": decision_id,
        "owner_authority_identity": task["owner_authority_identity"],
        "semantic_value": value,
        "proof_bundle": proof(
            session["source_plan_hash"], decision_id, task["owner_authority_identity"], passed=passed
        ),
    }


def commit_changed(session, graph, decision_id, replacement_id, value):
    old = graph["nodes"][decision_id]
    active_by_key = {
        node["decision_key"]: node_id
        for node_id, node in graph["nodes"].items()
        if node.get("status") == "active"
    }
    current_depends = [active_by_key[graph["nodes"][dep]["decision_key"]] for dep in old.get("depends_on_decision_ids", [])]
    replacement = record(
        replacement_id,
        old["decision_key"],
        value,
        depends=current_depends,
        owner=old["owner_authority_identity"],
        signal=old["owner_signal"],
        replaces=decision_id,
    )
    updated = apply_changes(graph, decision_records=[replacement])
    return commit_red_result(session, decision_id, updated, replacement_id), updated


def test_green_root_prunes_entire_clean_downstream_chain():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    verdict = evaluate_result(session, result(session, "D1", "dense"))
    assert verdict["classification"] == "green"
    assert verdict["pruned_decision_ids"] == ["D2", "D3"]
    assert verdict["next_session"]["completed"] is True
    assert verdict["next_session"]["tasks"]["D2"]["status"] == "pruned"


def test_red_result_does_not_unlock_downstream_until_replacement_is_committed():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red = evaluate_result(session, result(session, "D1", "roomy"))
    assert red["classification"] == "red"
    assert red["next_session"]["tasks"]["D1"]["status"] == "red-awaiting-commit"
    assert red["next_session"]["ready_decision_ids"] == []
    committed, _ = commit_changed(red["next_session"], graph, "D1", "D1@2", "roomy")
    assert committed["unlocked_decision_ids"] == ["D2"]
    assert committed["next_session"]["tasks"]["D1"]["status"] == "red"


def test_green_revalidation_after_red_parent_prunes_remaining_descendants():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red = evaluate_result(session, result(session, "D1", "roomy"))
    committed, updated = commit_changed(red["next_session"], graph, "D1", "D1@2", "roomy")
    session2 = committed["next_session"]
    green = evaluate_result(session2, result(session2, "D2", "v2"))
    assert green["classification"] == "green"
    assert green["pruned_decision_ids"] == ["D3"]
    assert green["next_session"]["completed"] is True
    assert updated["nodes"]["D1@2"]["status"] == "active"


def test_red_revalidation_unlocks_next_node_only_after_commit():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red1 = evaluate_result(session, result(session, "D1", "roomy"))
    commit1, graph2 = commit_changed(red1["next_session"], graph, "D1", "D1@2", "roomy")
    red2 = evaluate_result(commit1["next_session"], result(commit1["next_session"], "D2", "v3"))
    assert red2["next_session"]["ready_decision_ids"] == []
    commit2, _ = commit_changed(red2["next_session"], graph2, "D2", "D2@2", "v3")
    assert commit2["unlocked_decision_ids"] == ["D3"]


def test_invalid_or_insufficient_proof_keeps_task_pending_without_mutation():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    verdict = evaluate_result(session, result(session, "D1", "dense", passed=False))
    assert verdict["classification"] == "pending"
    assert verdict["next_session"] == session


def test_result_from_an_old_plan_is_rejected_as_stale_plan():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    payload = result(session, "D1", "dense")
    payload["source_plan_hash"] = "sha256:old"
    verdict = evaluate_result(session, payload)
    assert verdict == {
        "classification": "stale-plan",
        "blockers": ["source_plan_hash_mismatch"],
        "next_session": None,
    }


def test_blocked_downstream_result_cannot_skip_dependency_convergence():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    verdict = evaluate_result(session, result(session, "D2", "v2"))
    assert verdict["classification"] == "pending"
    assert verdict["blockers"] == ["dependencies_not_converged"]


def test_exact_green_result_replay_is_idempotent_but_conflicting_replay_is_stale():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    payload = result(session, "D1", "dense")
    first = evaluate_result(session, payload)
    replay = evaluate_result(first["next_session"], payload)
    assert replay["classification"] == "green"
    assert replay["idempotent_replay"] is True
    changed = result(session, "D1", "roomy")
    stale = evaluate_result(first["next_session"], changed)
    assert stale["classification"] == "stale-plan"
    assert stale["blockers"] == ["task_already_converged"]


def test_red_commit_requires_exact_semantic_replacement():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red = evaluate_result(session, result(session, "D1", "roomy"))
    wrong = record("D1@2", "design.layout", "different", owner="a1", replaces="D1")
    updated = apply_changes(graph, decision_records=[wrong])
    with pytest.raises(ValueError, match="semantic hash"):
        commit_red_result(red["next_session"], "D1", updated, "D1@2")


def test_diamond_mixed_green_red_only_unlocks_merge_after_both_siblings_converge():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red1 = evaluate_result(session, result(session, "D1", "v2"))
    commit1, graph2 = commit_changed(red1["next_session"], graph, "D1", "D1@2", "v2")
    session2 = commit1["next_session"]
    assert set(session2["ready_decision_ids"]) == {"D2", "D3"}

    green2 = evaluate_result(session2, result(session2, "D2", "a"))
    assert green2["next_session"]["tasks"]["D4"]["status"] == "blocked"
    red3 = evaluate_result(green2["next_session"], result(green2["next_session"], "D3", "b2"))
    commit3, _ = commit_changed(red3["next_session"], graph2, "D3", "D3@2", "b2")
    assert commit3["unlocked_decision_ids"] == ["D4"]


def test_diamond_all_green_prunes_merge_without_running_it():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red1 = evaluate_result(session, result(session, "D1", "v2"))
    commit1, _ = commit_changed(red1["next_session"], graph, "D1", "D1@2", "v2")
    green2 = evaluate_result(commit1["next_session"], result(commit1["next_session"], "D2", "a"))
    green3 = evaluate_result(green2["next_session"], result(green2["next_session"], "D3", "b"))
    assert green3["pruned_decision_ids"] == ["D4"]
    assert green3["next_session"]["completed"] is True


def test_independently_stale_recompute_root_is_not_pruned_when_parent_is_green():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1", "D2"])
    session = initialize_result_session(graph, plan)
    assert session["tasks"]["D1"]["status"] == "ready"
    assert session["tasks"]["D2"]["status"] == "blocked"
    green1 = evaluate_result(session, result(session, "D1", "dense"))
    assert green1["next_session"]["tasks"]["D2"]["status"] == "ready"
    assert "D2" in green1["unlocked_decision_ids"]


def test_red_commit_rejects_dependency_topology_changes_that_require_a_fresh_plan():
    graph = chain()
    plan = build_revalidation_plan(graph, ["D1"])
    session = initialize_result_session(graph, plan)
    red = evaluate_result(session, result(session, "D1", "roomy"))
    extra = record("DX", "security.policy", "strict", owner="ax", signal="security")
    graph2 = apply_changes(graph, decision_records=[extra])
    wrong = record("D1@2", "design.layout", "roomy", depends=["DX"], owner="a1", replaces="D1")
    updated = apply_changes(graph2, decision_records=[wrong])
    with pytest.raises(ValueError, match="fresh revalidation plan"):
        commit_red_result(red["next_session"], "D1", updated, "D1@2")
