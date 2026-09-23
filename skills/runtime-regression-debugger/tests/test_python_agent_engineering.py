import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from engineering_context_router import route_signals  # noqa: E402


def paths(payload):
    return [item["path"] for item in payload["references"]]


def test_python_agent_route_is_specialized_and_implementation_scoped():
    payload = route_signals("python-agent", 7)
    assert payload["primary_signal"] == "python-agent"
    assert payload["primary_stage"] == "implementation"
    assert paths(payload) == [
        "references/python-agent-system-engineering.md",
        "references/ai-llm-product-engineering.md",
        "references/async-edge-job-patterns.md",
    ]


def test_python_agent_framework_aliases_reach_same_owner():
    for alias in ("langchain", "langgraph", "autogen", "react-agent", "react-loop", "python-agent-system"):
        payload = route_signals(alias, 7)
        assert payload["signals"] == ["python-agent"]
        assert payload["primary_reference"] == "references/python-agent-system-engineering.md"


def test_python_agent_diagnostic_preserves_failure_owner():
    payload = route_signals("bug,python-agent,tool-calling", 7)
    assert payload["primary_signal"] == "bug"
    assert payload["primary_stage"] == "diagnostic"
    assert "references/python-agent-system-engineering.md" in paths(payload)
    assert "references/causal-debugging-experiment-design.md" in paths(payload)


def test_python_agent_eval_fixture_covers_core_failure_classes():
    fixture = json.loads((ROOT / "evals" / "python_agent_scenarios.json").read_text())
    scenarios = fixture["scenarios"]
    ids = {row["id"] for row in scenarios}
    assert len(scenarios) >= 8
    assert {
        "tool-schema-mismatch",
        "state-lost-between-turns",
        "react-loop-no-stop",
        "timeout-after-side-effect",
        "multi-agent-handoff",
        "external-provider-failure",
        "direct-code-authorized",
    }.issubset(ids)
    for row in scenarios:
        assert row["request"]
        assert row["must_do"]
        assert row["must_not"]
