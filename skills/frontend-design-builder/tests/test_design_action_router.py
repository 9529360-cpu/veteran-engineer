from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from design_action_router import route_design_action  # noqa: E402


FULL_FIGMA_TOOLS = [
    "mcp__Figma__get_screenshot",
    "mcp__Figma__get_design_context",
    "mcp__Figma__get_motion_context",
    "mcp__Figma__get_metadata",
    "mcp__Figma__get_variable_defs",
    "mcp__Figma__get_code_connect_map",
    "mcp__Figma__get_context_for_code_connect",
    "mcp__Figma__get_libraries",
    "mcp__Figma__search_design_system",
    "mcp__Figma__use_figma",
    "mcp__Figma__create_new_file",
    "mcp__Figma__generate_figma_design",
    "mcp__Figma__upload_assets",
    "mcp__Figma__download_assets",
    "mcp__Figma__add_code_connect_map",
    "mcp__Figma__generate_diagram",
    "mcp__Figma__generate_deck",
]


def test_design_to_code_requires_context_and_visual_evidence():
    result = route_design_action("figma-to-code", FULL_FIGMA_TOOLS)
    assert result["provider"] == "figma"
    assert result["missing_required"] == []
    assert result["required_capabilities"] == [
        "design.inspect.context",
        "design.inspect.visual",
    ]
    assert "get_design_context" in result["recommended_tools"]
    assert "get_screenshot" in result["recommended_tools"]
    assert result["prerequisite_skills"] == ["figma-design-to-code"]


def test_design_to_code_degrades_without_exact_figma_context():
    result = route_design_action("design-to-code", ["get_screenshot"])
    assert result["provider"] == "fallback"
    assert result["missing_required"] == ["design.inspect.context"]
    assert result["fallback"]
    assert result["prerequisite_skills"] == []


def test_design_system_requires_canvas_write_and_library_discovery():
    result = route_design_action(
        "figma-library",
        ["mcp__Figma__use_figma", "mcp__Figma__get_libraries", "mcp__Figma__search_design_system"],
    )
    assert result["provider"] == "figma"
    assert result["missing_required"] == []
    assert result["prerequisite_skills"] == ["figma-use", "figma-generate-library"]


def test_code_to_design_uses_write_path_and_prefers_capture_when_available():
    result = route_design_action(
        "code-to-figma",
        ["use_figma", "generate_figma_design", "get_libraries", "search_design_system", "get_screenshot"],
    )
    assert result["provider"] == "figma"
    assert "design.capture.url" in result["usable_preferred"]
    assert "generate_figma_design" in result["recommended_tools"]


def test_asset_roundtrip_needs_both_directions():
    result = route_design_action("asset-sync", ["download_assets"])
    assert result["provider"] == "fallback"
    assert result["missing_required"] == ["design.asset.import"]
    full = route_design_action("asset-sync", ["download_assets", "upload_assets"])
    assert full["provider"] == "figma"


def test_code_connect_needs_read_and_write_contracts():
    result = route_design_action(
        "codeconnect",
        ["get_code_connect_map", "send_code_connect_mappings"],
    )
    assert result["provider"] == "figma"
    assert result["missing_required"] == []
    assert result["prerequisite_skills"] == ["figma-code-connect"]


def test_motion_and_figjam_are_separate_modes():
    motion = route_design_action("figma-motion", ["get_motion_context", "get_screenshot"])
    assert motion["provider"] == "figma"
    assert motion["intent"] == "motion"

    diagram = route_design_action("figjam", ["generate_diagram", "get_figjam"])
    assert diagram["provider"] == "figma"
    assert diagram["intent"] == "figjam-diagram"


def test_advanced_resources_do_not_activate_from_basic_canvas_tools():
    shader = route_design_action("shader", ["use_figma", "get_screenshot"])
    plugin = route_design_action("generative-plugin", ["use_figma"])
    assert shader["provider"] == "fallback"
    assert plugin["provider"] == "fallback"


def test_canvas_write_plan_requires_preflight_and_postwrite_evidence():
    result = route_design_action(
        "canvas-edit",
        ["use_figma", "get_screenshot", "get_metadata"],
    )
    assert result["provider"] == "figma"
    assert result["mutates_design"] is True
    assert result["preflight_capabilities"] == ["design.inspect.structure"]
    assert result["success_evidence"] == [
        "design.inspect.structure",
        "design.inspect.visual",
    ]
    assert "inspect-before-retry" in result["retry_policy"]


def test_read_only_design_to_code_does_not_claim_design_mutation():
    result = route_design_action("design-to-code", FULL_FIGMA_TOOLS)
    assert result["mutates_design"] is False
    assert result["preflight_capabilities"] == []
    assert result["retry_policy"] == "read-only-or-idempotent"


def test_design_system_plan_uses_ledger_idempotent_recovery():
    result = route_design_action(
        "design-system",
        ["use_figma", "get_libraries", "search_design_system", "get_screenshot"],
    )
    assert result["mutates_design"] is True
    assert "design.system.libraries" in result["preflight_capabilities"]
    assert result["retry_policy"] == "ledger-idempotent-inspect-before-retry"


def test_fallback_never_claims_provider_mutation_or_retry_safety():
    result = route_design_action("canvas-edit", [])
    assert result["provider"] == "fallback"
    assert result["mutates_design"] is False
    assert result["preflight_capabilities"] == []
    assert result["success_evidence"] == []
    assert result["retry_policy"] == "fallback-no-provider-mutation"
