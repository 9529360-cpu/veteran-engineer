import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from decision_dependency_graph import apply_changes, empty_graph, normalize_decision_records  # noqa: E402
from decision_revalidation_plan import build_revalidation_plan, validate_plan  # noqa: E402


def record(decision_id, key, value, *, depends=None, replaces=None, owner="a1", signal="product-design"):
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
        default_evidence_ids=["ev:1"],
    )[0]


def graph_chain():
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
    graph = apply_changes(
        graph,
        decision_records=[record("D4", "release.flag", "off", owner="a4", signal="release")],
    )
    return graph


def test_stale_root_recomputes_and_dependents_revalidate_in_waves_while_unrelated_nodes_reuse():
    plan = build_revalidation_plan(graph_chain(), ["D1"])
    assert plan["recompute_decision_ids"] == ["D1"]
    assert plan["revalidate_waves"] == [["D2"], ["D3"]]
    assert plan["reuse_unaffected_decision_ids"] == ["D4"]
    assert plan["owner_worksets"] == [
        {
            "owner_signal": "product-design",
            "owner_authority_identity": "a1",
            "recompute_decision_ids": ["D1"],
            "revalidate_decision_ids": [],
            "first_wave": 0,
        },
        {
            "owner_signal": "migration",
            "owner_authority_identity": "a2",
            "recompute_decision_ids": [],
            "revalidate_decision_ids": ["D2"],
            "first_wave": 1,
        },
        {
            "owner_signal": "fullstack",
            "owner_authority_identity": "a3",
            "recompute_decision_ids": [],
            "revalidate_decision_ids": ["D3"],
            "first_wave": 2,
        },
    ]
    validate_plan(plan)


def test_proven_preservation_barrier_prunes_its_downstream_branch():
    plan = build_revalidation_plan(graph_chain(), ["D1"], preserved_decision_ids=["D2"])
    assert plan["recompute_decision_ids"] == ["D1"]
    assert plan["revalidate_waves"] == []
    assert plan["preservation_barrier_decision_ids"] == ["D2"]
    assert plan["pruned_downstream_decision_ids"] == ["D3"]
    assert plan["reuse_change_pruned_decision_ids"] == ["D2", "D3"]


def test_semantically_equivalent_replacement_change_prunes_without_revalidating_dependents():
    graph = graph_chain()
    replacement = record("D1@2", "design.layout", "dense", replaces="D1", owner="a5")
    plan = build_revalidation_plan(graph, ["D1"], replacement_records=[replacement])
    assert plan["root_actions"][0]["action"] == "replace-equivalent"
    assert plan["recompute_decision_ids"] == []
    assert plan["revalidate_waves"] == []
    assert plan["change_pruned_root_decision_ids"] == ["D1"]
    assert "D2" in plan["reuse_unaffected_decision_ids"]
    assert "D3" in plan["reuse_unaffected_decision_ids"]


def test_semantically_changed_replacement_still_propagates_to_dependents():
    graph = graph_chain()
    replacement = record("D1@2", "design.layout", "roomy", replaces="D1", owner="a5")
    plan = build_revalidation_plan(graph, ["D1"], replacement_records=[replacement])
    assert plan["root_actions"][0]["action"] == "replace-changed"
    assert plan["recompute_decision_ids"] == ["D1"]
    assert plan["revalidate_waves"] == [["D2"], ["D3"]]


def test_preservation_barrier_must_be_on_the_changed_root_affected_path():
    with pytest.raises(ValueError, match="outside affected closure"):
        build_revalidation_plan(graph_chain(), ["D1"], preserved_decision_ids=["D4"])


def test_replacement_can_only_be_supplied_for_a_declared_stale_root():
    graph = graph_chain()
    replacement = record("D2@2", "migration.schema", "v3", replaces="D2", owner="a5", signal="migration")
    with pytest.raises(ValueError, match="non-stale"):
        build_revalidation_plan(graph, ["D1"], replacement_records=[replacement])


def test_diamond_graph_revalidates_each_node_once_and_preservation_prunes_only_its_branch():
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
    assert build_revalidation_plan(graph, ["D1"])["revalidate_waves"] == [["D2", "D3"], ["D4"]]
    pruned = build_revalidation_plan(graph, ["D1"], preserved_decision_ids=["D2"])
    assert pruned["revalidate_waves"] == [["D3"], ["D4"]]
    assert pruned["reuse_change_pruned_decision_ids"] == ["D2"]


def test_multiple_stale_roots_can_mix_equivalent_change_pruning_with_real_revalidation():
    graph = empty_graph()
    graph = apply_changes(
        graph,
        decision_records=[
            record("D1", "design.layout", "dense"),
            record("D5", "security.auth", "strict", owner="a5", signal="security"),
        ],
    )
    graph = apply_changes(
        graph,
        decision_records=[
            record("D2", "implementation.ui", "v1", depends=["D1"], owner="a2", signal="fullstack"),
            record("D6", "implementation.auth", "v1", depends=["D5"], owner="a6", signal="fullstack"),
        ],
    )
    replacements = [
        record("D1@2", "design.layout", "dense", replaces="D1", owner="a7"),
        record("D5@2", "security.auth", "stricter", replaces="D5", owner="a8", signal="security"),
    ]
    plan = build_revalidation_plan(graph, ["D1", "D5"], replacement_records=replacements)
    assert plan["change_pruned_root_decision_ids"] == ["D1"]
    assert plan["recompute_decision_ids"] == ["D5"]
    assert plan["revalidate_waves"] == [["D6"]]
    assert "D2" in plan["reuse_unaffected_decision_ids"]


def test_revalidation_plan_explains_each_candidate_with_a_shortest_semantic_path():
    plan = build_revalidation_plan(graph_chain(), ["D1"])
    assert plan["revalidation_reason_paths"] == {
        "D2": ["D1", "D2"],
        "D3": ["D1", "D2", "D3"],
    }
