from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from frontend_context_router import normalize_signals, route_signals  # noqa: E402


REFS = {
    "component-lab.md",
    "concept-and-assets.md",
    "design-action-fabric.md",
    "design-source-authority.md",
    "design-system-sync.md",
    "design-system.md",
    "execution-contract.md",
    "fidelity-protocol.md",
    "figma-integration.md",
    "modes-and-architecture.md",
    "live-reference-workflow.md",
    "product-design-cycle.md",
    "qa-checklist.md",
    "reference-research.md",
    "tool-orchestration.md",
    "visual-direction.md",
    "visual-design-authority.md",
}


def _seed_refs(tmp_path: Path) -> Path:
    skill = tmp_path / "frontend-design-builder"
    refs = skill / "references"
    refs.mkdir(parents=True)
    for name in REFS:
        (refs / name).write_text((name + "\n") * 8, encoding="utf-8")
    return skill


def paths(result):
    return [row["path"] for row in result["active_references"]]


def test_figma_prefers_structured_design_source(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma,production", skill_root=root)
    assert result["primary_mode"] == "figma-design-to-code"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/design-source-authority.md",
        "references/design-system.md",
    ]
    assert "references/concept-and-assets.md" not in paths(result)


def test_reference_led_route_composes_fidelity_and_qa(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("screenshot,visual-qa,responsive", skill_root=root)
    assert result["primary_mode"] == "reference-led"
    assert paths(result) == [
        "references/fidelity-protocol.md",
        "references/design-source-authority.md",
        "references/qa-checklist.md",
    ]


def test_storybook_route_uses_component_lab(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("storybook,design-system", skill_root=root)
    assert result["primary_mode"] == "component-lab"
    assert paths(result)[:2] == ["references/component-lab.md", "references/design-system.md"]


def test_greenfield_route_is_concept_first(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("greenfield,imagegen", skill_root=root)
    assert result["primary_mode"] == "concept-first"
    assert paths(result) == ["references/visual-direction.md", "references/concept-and-assets.md"]


def test_research_route_does_not_become_design_authority(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("mobbin,inspiration", skill_root=root)
    assert result["primary_mode"] == "reference-research"
    assert paths(result) == [
        "references/reference-research.md",
        "references/design-source-authority.md",
        "references/visual-direction.md",
    ]


def test_reference_count_budget_defers_extra_context(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma,production,visual-qa", skill_root=root, max_refs=2)
    assert len(result["active_references"]) == 2
    assert result["deferred_references"]
    assert all(row["reason"] == "max_refs" for row in result["deferred_references"])


def test_byte_budget_keeps_one_owner_then_defers(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma", skill_root=root, max_refs=3, max_bytes=1)
    assert len(result["active_references"]) == 1
    assert result["deferred_references"]
    assert all(row["reason"] == "max_bytes" for row in result["deferred_references"])


def test_aliases_normalize_without_duplicates():
    assert normalize_signals(["CodeConnect", "code-connect", "a11y", "visualqa"]) == [
        "code-connect",
        "accessibility",
        "visual-qa",
    ]


def test_unknown_signal_keeps_general_mode_and_zero_context(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("something-new", skill_root=root)
    assert result["primary_mode"] == "general-ui"
    assert result["active_references"] == []
    assert result["matched_signals"] == []


def test_product_design_cycle_owns_redesign_audit(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("ux-audit,research", skill_root=root)
    assert result["primary_mode"] == "product-design"
    assert paths(result)[0] == "references/product-design-cycle.md"


def test_design_system_sync_owns_cross_tool_drift(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("token-sync,figma,storybook", skill_root=root)
    assert result["primary_mode"] == "design-system-sync"
    assert paths(result) == [
        "references/design-system-sync.md",
        "references/design-system.md",
        "references/design-source-authority.md",
    ]


def test_figma_motion_routes_to_motion_and_qa(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma-motion,production", skill_root=root)
    assert result["primary_mode"] == "figma-motion"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/modes-and-architecture.md",
        "references/qa-checklist.md",
    ]


def test_figma_swiftui_routes_to_platform_translation(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma-swiftui", skill_root=root)
    assert result["primary_mode"] == "figma-swiftui"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/modes-and-architecture.md",
        "references/design-source-authority.md",
    ]


def test_figjam_routes_to_evidence_first_product_flow(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma-board", skill_root=root)
    assert result["primary_mode"] == "figjam"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/product-design-cycle.md",
        "references/design-source-authority.md",
    ]


def test_figma_library_route_prefers_sync_contract(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma-library", skill_root=root)
    assert result["primary_mode"] == "figma-library"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/design-system-sync.md",
        "references/design-system.md",
    ]


def test_code_to_figma_route_uses_existing_system_before_write(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("code-to-figma", skill_root=root)
    assert result["primary_mode"] == "figma-write"
    assert paths(result) == [
        "references/figma-integration.md",
        "references/design-system.md",
        "references/tool-orchestration.md",
    ]


def test_live_reference_routes_capture_before_fidelity(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("url-to-code", skill_root=root)
    assert result["primary_mode"] == "live-reference"
    assert paths(result) == [
        "references/live-reference-workflow.md",
        "references/tool-orchestration.md",
        "references/fidelity-protocol.md",
    ]


def test_design_action_route_loads_provider_contract_first(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("figma-tools", skill_root=root)
    assert result["primary_mode"] == "design-action"
    assert paths(result) == [
        "references/design-action-fabric.md",
        "references/tool-orchestration.md",
        "references/figma-integration.md",
    ]


def test_visual_authority_owns_major_ui_quality_recovery(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("major-ui,visual-quality", skill_root=root)
    assert result["primary_mode"] == "visual-authority"
    assert paths(result) == [
        "references/visual-design-authority.md",
        "references/visual-direction.md",
        "references/product-design-cycle.md",
    ]


def test_visual_authority_alias_does_not_collapse_to_generic_product_design(tmp_path):
    root = _seed_refs(tmp_path)
    result = route_signals("ui-redesign", skill_root=root)
    assert result["primary_mode"] == "visual-authority"
    assert paths(result)[0] == "references/visual-design-authority.md"
