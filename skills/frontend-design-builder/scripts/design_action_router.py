#!/usr/bin/env python3
"""Capability-aware design action router for Frontend Design Builder.

This script does not call design tools. It converts the host's currently
available tool names plus a design intent into a small provider plan so the
Skill can choose real actions without loading every design reference/tool.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Iterable


def _alts(*groups: Iterable[str]) -> tuple[frozenset[str], ...]:
    return tuple(frozenset(group) for group in groups)


CAPABILITY_REQUIREMENTS: dict[str, tuple[frozenset[str], ...]] = {
    "design.inspect.visual": _alts({"get_screenshot"}),
    "design.inspect.context": _alts({"get_design_context"}),
    "design.inspect.structure": _alts({"get_metadata"}, {"use_figma"}),
    "design.inspect.variables": _alts({"get_variable_defs"}, {"use_figma"}),
    "design.inspect.motion": _alts({"get_motion_context"}),
    "design.system.libraries": _alts({"get_libraries", "search_design_system"}),
    "design.canvas.write": _alts({"use_figma"}),
    "design.file.create": _alts({"create_new_file"}),
    "design.capture.url": _alts({"generate_figma_design"}),
    "design.asset.import": _alts({"upload_assets"}),
    "design.asset.export": _alts({"download_assets"}),
    "design.codeconnect.read": _alts(
        {"get_code_connect_map"},
        {"get_context_for_code_connect"},
        {"get_code_connect_suggestions"},
    ),
    "design.codeconnect.write": _alts(
        {"add_code_connect_map"},
        {"send_code_connect_mappings"},
    ),
    "design.figjam.inspect": _alts({"get_figjam"}),
    "design.diagram.create": _alts({"generate_diagram"}),
    "design.deck.generate": _alts({"generate_deck"}),
    "design.shader.inspect": _alts({"list_file_shaders"}, {"list_shaders", "get_shader"}),
    "design.shader.write": _alts({"create_shader", "update_shader"}),
    "design.plugin.inspect": _alts({"list_generative_plugins", "get_generative_plugin"}),
    "design.plugin.write": _alts({"create_generative_plugin", "update_generative_plugin"}),
}


@dataclass(frozen=True)
class IntentSpec:
    required: tuple[str, ...]
    preferred: tuple[str, ...] = ()
    prerequisites: tuple[str, ...] = ()
    fallback: str = "Use repository/browser/image references and state which structured design actions were unavailable."


INTENTS: dict[str, IntentSpec] = {
    "design-to-code": IntentSpec(
        required=("design.inspect.context", "design.inspect.visual"),
        preferred=("design.codeconnect.read", "design.inspect.variables", "design.system.libraries", "design.inspect.motion"),
        prerequisites=("figma-design-to-code",),
        fallback="Use screenshots/exports as the visual target, inspect the repository design system, and do not claim exact Figma extraction.",
    ),
    "canvas-edit": IntentSpec(
        required=("design.canvas.write",),
        preferred=("design.inspect.structure", "design.inspect.visual", "design.inspect.variables"),
        prerequisites=("figma-use",),
    ),
    "design-system": IntentSpec(
        required=("design.canvas.write", "design.system.libraries"),
        preferred=("design.inspect.variables", "design.codeconnect.read", "design.codeconnect.write"),
        prerequisites=("figma-use", "figma-generate-library"),
        fallback="Treat code tokens/components as authority and document that design-library mutation is unavailable.",
    ),
    "code-to-design": IntentSpec(
        required=("design.canvas.write",),
        preferred=("design.capture.url", "design.system.libraries", "design.codeconnect.read", "design.inspect.visual"),
        prerequisites=("figma-use", "figma-generate-design"),
        fallback="Generate a code-native reference/render and keep design write-back explicitly pending.",
    ),
    "live-url-to-design": IntentSpec(
        required=("design.capture.url",),
        preferred=("design.file.create", "design.canvas.write", "design.system.libraries"),
        prerequisites=("figma-generate-design",),
        fallback="Capture browser evidence and reconstruct from code without claiming a design-file write.",
    ),
    "asset-roundtrip": IntentSpec(
        required=("design.asset.import", "design.asset.export"),
        preferred=("design.inspect.visual",),
        fallback="Use repository-managed assets and record that design-file asset round-trip is unavailable.",
    ),
    "code-connect": IntentSpec(
        required=("design.codeconnect.read", "design.codeconnect.write"),
        preferred=("design.system.libraries", "design.inspect.context"),
        prerequisites=("figma-code-connect",),
        fallback="Document the intended production-component mapping without claiming it was published to Figma.",
    ),
    "motion": IntentSpec(
        required=("design.inspect.motion",),
        preferred=("design.inspect.context", "design.inspect.visual", "design.canvas.write"),
        prerequisites=("figma-implement-motion",),
        fallback="Infer motion only from accepted visual/runtime evidence and mark Figma motion data unverified.",
    ),
    "figjam-diagram": IntentSpec(
        required=("design.diagram.create",),
        preferred=("design.figjam.inspect",),
        prerequisites=("figma-generate-diagram",),
        fallback="Produce a text/Mermaid specification without claiming an editable FigJam artifact was created.",
    ),
    "slides": IntentSpec(
        required=("design.deck.generate",),
        preferred=("design.canvas.write", "design.inspect.visual"),
        fallback="Produce a slide/deck specification without claiming a Figma Slides file was created.",
    ),
    "shader": IntentSpec(
        required=("design.shader.write",),
        preferred=("design.shader.inspect",),
        prerequisites=("figma-shaders",),
        fallback="Keep the visual effect code-native; do not claim a Figma shader resource was created.",
    ),
    "generative-plugin": IntentSpec(
        required=("design.plugin.write",),
        preferred=("design.plugin.inspect",),
        prerequisites=("figma-generative-plugins",),
        fallback="Keep automation in the repository/host workflow; do not claim a Figma generative plugin was published.",
    ),
}


ALIASES = {
    "figma-to-code": "design-to-code",
    "design-to-code": "design-to-code",
    "figma-write": "canvas-edit",
    "write-to-figma": "canvas-edit",
    "canvas-write": "canvas-edit",
    "figma-library": "design-system",
    "design-library": "design-system",
    "code-to-figma": "code-to-design",
    "url-to-figma": "live-url-to-design",
    "live-url-to-figma": "live-url-to-design",
    "asset-sync": "asset-roundtrip",
    "figma-assets": "asset-roundtrip",
    "codeconnect": "code-connect",
    "figma-code-connect": "code-connect",
    "figma-motion": "motion",
    "diagram": "figjam-diagram",
    "figjam": "figjam-diagram",
    "deck": "slides",
    "figma-slides": "slides",
    "figma-shader": "shader",
    "figma-plugin": "generative-plugin",
}


def normalize_tool_name(name: str) -> str:
    value = str(name or "").strip()
    for prefix in ("mcp__Figma__", "mcp__figma__"):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break
    value = value.rsplit("/", 1)[-1].rsplit(".", 1)[-1]
    return value.strip().lower().replace("-", "_")


def normalize_tools(tools: Iterable[str]) -> set[str]:
    return {normalize_tool_name(tool) for tool in tools if str(tool or "").strip()}


def normalize_intent(intent: str) -> str:
    key = str(intent or "").strip().lower().replace("_", "-")
    return ALIASES.get(key, key)


def capability_satisfied(capability: str, tools: set[str]) -> bool:
    alternatives = CAPABILITY_REQUIREMENTS[capability]
    return any(group.issubset(tools) for group in alternatives)


def matching_tools(capability: str, tools: set[str]) -> list[str]:
    out: set[str] = set()
    for group in CAPABILITY_REQUIREMENTS[capability]:
        out.update(group.intersection(tools))
    return sorted(out)


def route_design_action(intent: str, tools: Iterable[str]) -> dict:
    mode = normalize_intent(intent)
    if mode not in INTENTS:
        raise ValueError(f"unsupported design action intent: {intent}")
    available_tools = normalize_tools(tools)
    spec = INTENTS[mode]

    available_capabilities = sorted(
        capability for capability in CAPABILITY_REQUIREMENTS
        if capability_satisfied(capability, available_tools)
    )
    missing_required = [
        capability for capability in spec.required
        if capability not in available_capabilities
    ]
    usable_preferred = [
        capability for capability in spec.preferred
        if capability in available_capabilities
    ]

    recommended_tools: set[str] = set()
    for capability in (*spec.required, *usable_preferred):
        recommended_tools.update(matching_tools(capability, available_tools))

    provider = "figma" if not missing_required else "fallback"
    return {
        "intent": mode,
        "provider": provider,
        "required_capabilities": list(spec.required),
        "preferred_capabilities": list(spec.preferred),
        "available_capabilities": available_capabilities,
        "missing_required": missing_required,
        "usable_preferred": usable_preferred,
        "recommended_tools": sorted(recommended_tools),
        "prerequisite_skills": list(spec.prerequisites) if provider == "figma" else [],
        "fallback": None if provider == "figma" else spec.fallback,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intent", required=True, choices=sorted(INTENTS))
    parser.add_argument("--tools", default="", help="Comma-separated host tool names")
    args = parser.parse_args()
    result = route_design_action(args.intent, args.tools.split(","))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
