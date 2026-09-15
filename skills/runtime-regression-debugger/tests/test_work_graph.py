from __future__ import annotations

import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "work_graph.py"
SPEC = importlib.util.spec_from_file_location("veteran_work_graph", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
work_graph = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(work_graph)


def tasks(*items: dict) -> dict[str, dict]:
    return work_graph.normalize_tasks({"tasks": list(items)})


class WorkGraphThroughputTests(unittest.TestCase):
    def test_low_conflict_tasks_fill_the_first_wave_before_a_broad_conflict(self) -> None:
        graph = tasks(
            {"id": "A", "writes": ["src"], "risk": "low"},
            {"id": "B", "writes": ["src/b"], "risk": "low"},
            {"id": "C", "writes": ["src/c"], "risk": "low"},
        )
        self.assertEqual(
            work_graph.plan_waves(graph, allow_high_risk_parallel=False),
            [["B", "C"], ["A"]],
        )

    def test_high_risk_task_does_not_idle_ready_low_risk_siblings(self) -> None:
        graph = tasks(
            {"id": "A-high", "writes": ["infra/a"], "risk": "high"},
            {"id": "B-low", "writes": ["src/b"], "risk": "low"},
            {"id": "C-low", "writes": ["src/c"], "risk": "medium"},
        )
        self.assertEqual(
            work_graph.plan_waves(graph, allow_high_risk_parallel=False),
            [["B-low", "C-low"], ["A-high"]],
        )

    def test_max_parallel_is_an_explicit_capacity_ceiling(self) -> None:
        graph = tasks(*[
            {"id": f"T{index}", "writes": [f"src/{index}"], "risk": "low"}
            for index in range(1, 5)
        ])
        waves = work_graph.plan_waves(
            graph,
            allow_high_risk_parallel=False,
            max_parallel=2,
        )
        self.assertEqual([len(wave) for wave in waves], [2, 2])
        self.assertEqual(sorted(task for wave in waves for task in wave), ["T1", "T2", "T3", "T4"])

    def test_explicit_high_risk_parallel_override_remains_available(self) -> None:
        graph = tasks(
            {"id": "H1", "writes": ["infra/one"], "risk": "high"},
            {"id": "H2", "writes": ["infra/two"], "risk": "high"},
        )
        self.assertEqual(
            work_graph.plan_waves(graph, allow_high_risk_parallel=True),
            [["H1", "H2"]],
        )

    def test_invalid_parallel_limit_fails_closed(self) -> None:
        graph = tasks({"id": "T1", "writes": ["src/a"], "risk": "low"})
        with self.assertRaisesRegex(RuntimeError, "positive integer"):
            work_graph.plan_waves(graph, allow_high_risk_parallel=False, max_parallel=0)


if __name__ == "__main__":
    unittest.main()
