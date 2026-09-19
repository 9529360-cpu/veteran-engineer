import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTER = ROOT / "scripts" / "engineering_context_router.py"
sys.path.insert(0, str(ROOT / "scripts"))
from engineering_context_router import route_signals  # noqa: E402


def run(signals: str) -> dict:
    return route_signals(signals, 7)


def paths(payload: dict) -> set[str]:
    return {item["path"] for item in payload["references"]}


def ordered_paths(payload: dict) -> list[str]:
    return [item["path"] for item in payload["references"]]


def test_desktop_redesign_alias_routes_product_design_before_runtime_context():
    payload = run("desktop-redesign")
    assert payload["unmatched_signals"] == []
    selected = paths(payload)
    order = ordered_paths(payload)
    assert "references/frontend-product-patterns.md" in selected
    assert "references/desktop-product-experience.md" in selected
    assert "references/frontend-design-governance.md" in selected
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected
    assert "references/full-stack-product-engineering.md" not in selected
    assert "references/host-shell-platform-patterns.md" not in selected
    assert "references/runtime-lifecycle-patterns.md" not in selected
    assert order.index("references/frontend-product-patterns.md") < order.index("references/desktop-product-experience.md")


def test_generic_ui_redesign_routes_only_current_design_stage_owner():
    payload = run("interface-redesign")
    assert payload["unmatched_signals"] == []
    selected = paths(payload)
    assert selected == {
        "references/frontend-product-patterns.md",
        "references/frontend-design-governance.md",
    }
    assert "references/frontend-visual-system-patterns.md" not in selected


def test_common_redesign_aliases_hit_the_same_design_lane():
    for signal in ("frontend-redesign", "dashboard-redesign", "navigation-redesign", "workspace-redesign"):
        payload = run(signal)
        assert payload["unmatched_signals"] == [], signal
        selected = paths(payload)
        assert "references/frontend-product-patterns.md" in selected, signal
        assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected, signal
        assert "references/full-stack-product-engineering.md" not in selected, signal


def test_redesign_advances_to_implementation_and_live_review_only_when_stage_is_explicit():
    implementation = paths(run("interface-redesign,fullstack"))
    assert "references/frontend-product-patterns.md" in implementation
    assert "references/full-stack-product-engineering.md" in implementation
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in implementation

    review = paths(run("design-review"))
    assert review == {"references/visual-ui-quality-assurance-product-engineering.md"}


def test_design_review_alias_routes_live_visual_qa_owner():
    for signal in ("design-audit", "visual-qa"):
        payload = run(signal)
        assert payload["unmatched_signals"] == [], signal
        selected = paths(payload)
        assert "references/visual-ui-quality-assurance-product-engineering.md" in selected
        assert "references/frontend-product-patterns.md" not in selected


def test_plain_desktop_ui_does_not_assume_redesign_governance():
    selected = paths(run("desktop-ui"))
    assert "references/frontend-product-patterns.md" in selected
    assert "references/desktop-product-experience.md" in selected
    assert "references/frontend-design-governance.md" not in selected


def test_desktop_plus_ui_composes_current_design_stage_without_future_qa_or_runtime():
    payload = run("desktop,ui")
    selected = paths(payload)
    assert "references/frontend-product-patterns.md" in selected
    assert "references/desktop-product-experience.md" in selected
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected
    assert "references/full-stack-product-engineering.md" not in selected
    assert "references/host-shell-platform-patterns.md" not in selected
    assert "references/runtime-lifecycle-patterns.md" not in selected


def test_plain_desktop_runtime_signal_does_not_force_visual_design():
    payload = run("desktop")
    selected = paths(payload)
    assert "references/runtime-lifecycle-patterns.md" in selected
    assert "references/host-shell-platform-patterns.md" in selected
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected


def test_design_substages_load_only_their_current_owner():
    assert paths(run("product-design")) == {"references/frontend-product-patterns.md"}
    assert paths(run("visual-polish")) == {"references/frontend-visual-system-patterns.md"}
    assert paths(run("design-system")) == {"references/frontend-visual-system-patterns.md"}
    assert paths(run("design-governance")) == {"references/frontend-design-governance.md"}


def test_skill_description_is_trigger_focused_and_process_first_design_gate_is_explicit():
    skill = (ROOT / "SKILL.md").read_text()
    frontend = (ROOT / "references" / "frontend-product-patterns.md").read_text()
    governance = (ROOT / "references" / "frontend-design-governance.md").read_text()
    description_line = next(line for line in skill.splitlines() if line.startswith("description:"))
    assert description_line.startswith(("description: Use when ", 'description: "Use when '))
    assert "Route by outcome before technology" in skill
    assert "Treat process skills as higher precedence than implementation specialists" in skill
    assert "production UI code is blocked until the experience/design contract exists" in skill
    assert "requirement/spec compliance review -> code-quality review -> rendered design QA" in skill
    assert "production UI code is blocked until the experience target" in frontend
    assert "Design-before-code stage exits" in governance
    assert "Red flags that mean the design gate is being skipped" in governance
    assert "distinctiveness check" in governance
    assert "Design tooling is optional; design work is not" in governance


def test_design_synthesis_is_a_distinct_preimplementation_owner():
    payload = run("design-direction")
    assert payload["unmatched_signals"] == []
    selected = paths(payload)
    assert selected == {"references/design-synthesis-prototyping.md"}
    assert "references/frontend-styling-implementation-patterns.md" not in selected
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected


def test_visual_concept_adds_visual_system_without_reopening_css_or_qa():
    selected = paths(run("visual-concept"))
    assert "references/design-synthesis-prototyping.md" in selected
    assert "references/frontend-visual-system-patterns.md" in selected
    assert "references/frontend-styling-implementation-patterns.md" not in selected
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in selected


def test_code_native_design_keeps_paid_design_tools_optional():
    payload = run("code-native-design")
    assert paths(payload) == {"references/design-synthesis-prototyping.md"}
    reference = (ROOT / "references" / "design-synthesis-prototyping.md").read_text()
    assert "paid external design tool is never required" in reference
    assert "Code-native design when no design canvas is available" in reference
    assert "design component -> existing repository component" in reference
