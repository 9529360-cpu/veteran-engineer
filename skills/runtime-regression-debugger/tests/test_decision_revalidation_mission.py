import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from decision_dependency_graph import apply_changes, empty_graph, normalize_decision_records  # noqa: E402
from decision_revalidation_mission import compile_revalidation_mission, scaffold_revalidation_mission  # noqa: E402
from decision_revalidation_plan import build_revalidation_plan  # noqa: E402
from work_graph import normalize_tasks, plan_waves  # noqa: E402


def record(decision_id, key, value, *, depends=None, owner="a1", signal="product-design"):
    return normalize_decision_records(
        [{"decision_id": decision_id, "decision_key": key, "semantic_value": value, "depends_on_decision_ids": depends or []}],
        owner_signal=signal,
        owner_authority_identity=owner,
        default_clause_ids=["clause:1"],
        default_evidence_ids=["ev:1"],
    )[0]


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


def profiles(*, conflict=False):
    return {
        "D1": {"writes": ["design/contract.json"], "risk": "medium", "validation_oracle": "design contract check"},
        "D2": {"writes": ["db/a.sql" if not conflict else "db/shared.sql"], "risk": "high", "validation_oracle": "migration a dry-run"},
        "D3": {"writes": ["db/b.sql" if not conflict else "db/shared.sql"], "risk": "medium", "validation_oracle": "migration b dry-run"},
        "D4": {"writes": ["src/merge.ts"], "risk": "medium", "validation_oracle": "integration contract test"},
    }


def test_scaffold_is_not_execution_ready_without_repository_execution_profiles():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    scaffold = scaffold_revalidation_mission(graph, plan)
    assert scaffold["execution_ready"] is False
    assert scaffold["dependency_parallelism_only"] is True
    assert scaffold["tasks"][0]["required_execution_profile"] == ["writes", "risk", "validation_oracle"]


def test_compile_refuses_to_invent_missing_write_risk_or_validation_contracts():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    with pytest.raises(ValueError, match="missing execution profiles"):
        compile_revalidation_mission(graph, plan, {"D1": profiles()["D1"]})


def test_compiled_graph_preserves_decision_dependencies_and_allows_safe_parallel_siblings():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    compiled = compile_revalidation_mission(graph, plan, profiles())
    tasks = normalize_tasks(compiled["mission_graph"])
    assert tasks["reval:D2"]["depends_on"] == ["reval:D1"]
    assert tasks["reval:D3"]["depends_on"] == ["reval:D1"]
    assert tasks["reval:D4"]["depends_on"] == ["reval:D2", "reval:D3"]
    waves = plan_waves(tasks, allow_high_risk_parallel=True)
    assert waves[0] == ["reval:D1"]
    assert set(waves[1]) == {"reval:D2", "reval:D3"}
    assert waves[2] == ["reval:D4"]


def test_write_conflicts_can_serialize_dependency_independent_revalidation_tasks():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    compiled = compile_revalidation_mission(graph, plan, profiles(conflict=True))
    tasks = normalize_tasks(compiled["mission_graph"])
    waves = plan_waves(tasks, allow_high_risk_parallel=True)
    assert waves[0] == ["reval:D1"]
    assert waves[1] in (["reval:D2"], ["reval:D3"])
    assert waves[2] in (["reval:D2"], ["reval:D3"])
    assert waves[1] != waves[2]
    assert waves[3] == ["reval:D4"]


def test_unrelated_profile_is_rejected_instead_of_silently_expanding_scope():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    bad = profiles()
    bad["D9"] = {"writes": ["x"], "risk": "low", "validation_oracle": "x"}
    with pytest.raises(ValueError, match="non-work decisions"):
        compile_revalidation_mission(graph, plan, bad)


def test_mission_tasks_publish_the_exact_result_proof_identity():
    graph = diamond()
    plan = build_revalidation_plan(graph, ["D1"])
    scaffold = scaffold_revalidation_mission(graph, plan)
    first = scaffold["tasks"][0]
    assert first["expected_result_change_identity"] == (
        f"revalidation:{plan['plan_hash']}:{first['decision_id']}:{first['owner_authority_identity']}"
    )
    compiled = compile_revalidation_mission(graph, plan, profiles())
    task = compiled["mission_graph"]["tasks"][0]
    assert task["expected_result_change_identity"] == first["expected_result_change_identity"]
