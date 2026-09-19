import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from decision_dependency_graph import (  # noqa: E402
    apply_changes,
    authorities_for_decisions,
    empty_graph,
    graph_hash,
    normalize_decision_records,
    reverse_affected_closure,
    validate_graph,
)


def record(decision_id, key, value, *, depends=None, observes=None, replaces=None, owner="a1", signal="product-design"):
    return normalize_decision_records(
        [
            {
                "decision_id": decision_id,
                "decision_key": key,
                "semantic_value": value,
                "depends_on_decision_ids": depends or [],
                "observes_decision_ids": observes or [],
                "replaces_decision_id": replaces,
            }
        ],
        owner_signal=signal,
        owner_authority_identity=owner,
        default_clause_ids=["clause:1"],
        default_evidence_ids=["ev:1"],
    )[0]


def build_graph():
    graph = empty_graph()
    graph = apply_changes(graph, decision_records=[record("D1", "design.layout", {"mode": "dense"})])
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
        decision_records=[record("D4", "review.finding", "note", observes=["D1"], owner="a4", signal="review")],
    )
    return graph


def test_semantic_edges_drive_reverse_affected_closure_but_observation_edges_do_not():
    graph = build_graph()
    assert reverse_affected_closure(graph, ["D1"]) == ["D1", "D2", "D3"]
    assert "D4" not in reverse_affected_closure(graph, ["D1"])


def test_preserved_decision_is_a_change_pruning_barrier_for_its_downstream_closure():
    graph = build_graph()
    assert reverse_affected_closure(graph, ["D1"], preserved_decision_ids=["D2"]) == ["D1"]


def test_replacing_a_decision_versions_the_same_logical_key_and_supersedes_the_old_node():
    graph = empty_graph()
    first = record("D1@1", "design.layout", {"mode": "dense"})
    graph = apply_changes(graph, decision_records=[first])
    second = record("D1@2", "design.layout", {"mode": "roomy"}, replaces="D1@1", owner="a5")
    graph = apply_changes(graph, decision_records=[second])
    assert graph["nodes"]["D1@1"]["status"] == "superseded"
    assert graph["nodes"]["D1@1"]["superseded_by"] == "D1@2"
    assert graph["nodes"]["D1@2"]["status"] == "active"
    validate_graph(graph)
    assert graph_hash(graph).startswith("sha256:")


def test_new_decision_cannot_depend_on_an_already_invalidated_semantic_input():
    graph = empty_graph()
    graph = apply_changes(graph, decision_records=[record("D1", "design.layout", "dense")])
    graph = apply_changes(graph, invalidated_decision_ids=["D1"])
    with pytest.raises(ValueError, match="depends on non-active decision"):
        apply_changes(
            graph,
            decision_records=[record("D2", "migration.schema", "v2", depends=["D1"], owner="a2", signal="migration")],
        )


def test_authority_projection_is_derived_from_affected_decisions_not_whole_owner_lineage():
    graph = build_graph()
    affected = reverse_affected_closure(graph, ["D1"], preserved_decision_ids=["D2"])
    assert authorities_for_decisions(graph, affected) == ["a1"]


def test_logical_dependency_key_survives_upstream_version_replacement_for_future_invalidation():
    graph = empty_graph()
    graph = apply_changes(graph, decision_records=[record("D1@1", "design.layout", "dense")])
    graph = apply_changes(
        graph,
        decision_records=[record("D2@1", "migration.schema", "v2", depends=["D1@1"], owner="a2", signal="migration")],
    )
    graph = apply_changes(graph, invalidated_decision_ids=["D1@1"])
    graph = apply_changes(
        graph,
        decision_records=[record("D1@2", "design.layout", "roomy", replaces="D1@1", owner="a5")],
    )
    assert reverse_affected_closure(graph, ["D1@2"]) == ["D1@2", "D2@1"]
