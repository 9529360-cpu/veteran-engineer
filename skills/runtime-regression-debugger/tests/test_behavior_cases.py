import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTER = ROOT / "scripts" / "engineering_context_router.py"
sys.path.insert(0, str(ROOT / "scripts"))
from engineering_context_router import route_signals  # noqa: E402
CASES = json.loads((ROOT / "tests" / "skill_behavior_cases.json").read_text())
TRIGGERS = json.loads((ROOT / "tests" / "skill_trigger_eval_cases.json").read_text())


def route(signal: str) -> dict:
    payload = route_signals(signal, 7)
    assert payload["unmatched_signals"] == []
    return payload


def test_routing_behavior_cases():
    for case in CASES:
        payload = route(case["signal"])
        selected = {item["path"] for item in payload["references"]}
        deferred = {item["path"] for item in payload["deferred_references"]}
        deferred_signals = {item["signal"] for item in payload["deferred_signals"]}
        for ref in case.get("must_include", []):
            assert ref in selected, (case["name"], ref, selected)
        for ref in case.get("must_exclude", []):
            assert ref not in selected, (case["name"], ref, selected)
        for ref in case.get("deferred_must_include", []):
            assert ref in deferred, (case["name"], ref, deferred)
        for signal in case.get("deferred_signal_include", []):
            assert signal in deferred_signals, (case["name"], signal, deferred_signals)
        for signal in case.get("deferred_signal_exclude", []):
            assert signal not in deferred_signals, (case["name"], signal, deferred_signals)
        if "primary_signal" in case:
            assert payload["primary_signal"] == case["primary_signal"], (case["name"], payload["primary_signal"])
        if "primary_stage" in case:
            assert payload["primary_stage"] == case["primary_stage"], (case["name"], payload["primary_stage"])
        if case.get("must_not_be_design_free"):
            assert "references/frontend-product-patterns.md" in selected


def test_trigger_eval_fixture_has_positive_and_negative_pressure_cases():
    assert len(TRIGGERS) >= 8
    assert any(item["should_trigger"] for item in TRIGGERS)
    assert any(not item["should_trigger"] for item in TRIGGERS)
    assert any(item.get("expected_lane") == "desktop-ui" for item in TRIGGERS)
    assert any(item.get("expected_lane") == "desktop" for item in TRIGGERS)
