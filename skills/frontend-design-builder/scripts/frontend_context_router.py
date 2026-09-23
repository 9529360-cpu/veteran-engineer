#!/usr/bin/env python3
"""Deterministic progressive-reference router for Frontend Design Builder.

This is a planning aid, not a classifier or design-quality oracle. It keeps the
active context small by selecting only the references needed for the current
design decision and deferring the rest.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ALIASES = {
    "codeconnect": "code-connect",
    "figma-code-connect": "code-connect",
    "design-tokens": "tokens",
    "visual-regression-testing": "visual-regression",
    "storybook-lab": "storybook",
    "external-research": "research",
    "pattern-research": "research",
    "image-gen": "imagegen",
    "image-generation": "imagegen",
    "mock-up": "mockup",
    "visualqa": "visual-qa",
    "a11y": "accessibility",
    "ux-audit": "product-design",
    "ux-research": "product-design",
    "redesign": "product-design",
    "token-sync": "design-system-sync",
    "component-api": "design-system-sync",
    "figma-motion": "motion",
    "animation": "motion",
    "swift-ui": "swiftui",
    "figma-swiftui": "swiftui",
    "write-to-figma": "figma-write",
    "code-to-figma": "figma-write",
    "figma-library": "figma-library",
    "design-library": "figma-library",
    "figma-board": "figjam",
    "figma-diagram": "figjam",
    "url-to-code": "live-reference",
    "live-url": "live-reference",
    "site-recreation": "live-reference",
}

ROUTES = {
    "product-design": ["references/product-design-cycle.md", "references/design-source-authority.md", "references/visual-direction.md"],
    "design-system-sync": ["references/design-system-sync.md", "references/design-system.md", "references/design-source-authority.md"],
    "figma": ["references/figma-integration.md", "references/design-source-authority.md", "references/design-system.md"],
    "code-connect": ["references/figma-integration.md", "references/design-source-authority.md", "references/design-system.md"],
    "figma-write": ["references/figma-integration.md", "references/design-system.md", "references/tool-orchestration.md"],
    "figma-library": ["references/figma-integration.md", "references/design-system-sync.md", "references/design-system.md"],
    "motion": ["references/figma-integration.md", "references/modes-and-architecture.md", "references/qa-checklist.md"],
    "swiftui": ["references/figma-integration.md", "references/modes-and-architecture.md", "references/design-source-authority.md"],
    "figjam": ["references/figma-integration.md", "references/product-design-cycle.md", "references/design-source-authority.md"],
    "live-reference": ["references/live-reference-workflow.md", "references/tool-orchestration.md", "references/fidelity-protocol.md"],
    "screenshot": ["references/fidelity-protocol.md", "references/design-source-authority.md"],
    "mockup": ["references/fidelity-protocol.md", "references/design-source-authority.md"],
    "reference": ["references/fidelity-protocol.md", "references/design-source-authority.md"],
    "fidelity": ["references/fidelity-protocol.md"],
    "storybook": ["references/component-lab.md", "references/design-system.md"],
    "component-lab": ["references/component-lab.md", "references/design-system.md"],
    "visual-regression": ["references/component-lab.md", "references/qa-checklist.md"],
    "mobbin": ["references/reference-research.md", "references/design-source-authority.md", "references/visual-direction.md"],
    "research": ["references/reference-research.md", "references/design-source-authority.md", "references/visual-direction.md"],
    "inspiration": ["references/reference-research.md", "references/visual-direction.md"],
    "concept": ["references/visual-direction.md", "references/concept-and-assets.md"],
    "greenfield": ["references/visual-direction.md", "references/concept-and-assets.md"],
    "imagegen": ["references/concept-and-assets.md", "references/visual-direction.md"],
    "visual-direction": ["references/visual-direction.md"],
    "design-system": ["references/design-system.md"],
    "tokens": ["references/design-system.md"],
    "existing-system": ["references/design-system.md", "references/execution-contract.md"],
    "production": ["references/execution-contract.md", "references/modes-and-architecture.md"],
    "prototype": ["references/modes-and-architecture.md", "references/visual-direction.md"],
    "responsive": ["references/modes-and-architecture.md", "references/qa-checklist.md"],
    "accessibility": ["references/qa-checklist.md"],
    "qa": ["references/qa-checklist.md"],
    "visual-qa": ["references/qa-checklist.md", "references/fidelity-protocol.md"],
    "tools": ["references/tool-orchestration.md"],
}

MODE_PRIORITY = [
    ("product-design", {"product-design"}),
    ("design-system-sync", {"design-system-sync"}),
    ("figma-library", {"figma-library"}),
    ("figma-write", {"figma-write"}),
    ("figma-motion", {"motion"}),
    ("figma-swiftui", {"swiftui"}),
    ("figjam", {"figjam"}),
    ("live-reference", {"live-reference"}),
    ("figma-design-to-code", {"figma", "code-connect"}),
    ("reference-led", {"screenshot", "mockup", "reference", "fidelity"}),
    ("component-lab", {"storybook", "component-lab", "visual-regression"}),
    ("reference-research", {"mobbin", "research", "inspiration"}),
    ("concept-first", {"concept", "greenfield", "imagegen", "visual-direction"}),
    ("existing-system", {"design-system", "tokens", "existing-system"}),
    ("production", {"production"}),
    ("prototype", {"prototype"}),
    ("validation", {"responsive", "accessibility", "qa", "visual-qa"}),
]


def normalize_signals(signals: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in signals:
        signal = raw.strip().lower()
        if not signal:
            continue
        signal = ALIASES.get(signal, signal)
        if signal not in seen:
            out.append(signal)
            seen.add(signal)
    return out


def primary_mode(signals: list[str]) -> str:
    signal_set = set(signals)
    for mode, owners in MODE_PRIORITY:
        if signal_set.intersection(owners):
            return mode
    return "general-ui"


def _route_order(signals: list[str]) -> list[str]:
    mode_rank: dict[str, int] = {}
    for index, (_, owners) in enumerate(MODE_PRIORITY):
        for owner in owners:
            mode_rank.setdefault(owner, index)
    return sorted(signals, key=lambda s: (mode_rank.get(s, len(MODE_PRIORITY)), signals.index(s)))


def route_signals(
    signals: list[str] | str,
    *,
    skill_root: Path | None = None,
    max_refs: int = 3,
    max_bytes: int = 49152,
) -> dict:
    raw_signals = signals.split(",") if isinstance(signals, str) else signals
    normalized = normalize_signals(raw_signals)
    matched = [signal for signal in normalized if signal in ROUTES]

    candidates: list[str] = []
    seen: set[str] = set()
    for signal in _route_order(matched):
        for ref in ROUTES[signal]:
            if ref not in seen:
                candidates.append(ref)
                seen.add(ref)

    root = skill_root or Path(__file__).resolve().parents[1]
    active: list[dict] = []
    deferred: list[dict] = []
    total_bytes = 0

    for ref in candidates:
        target = root / ref
        if not target.is_file():
            raise FileNotFoundError(f"frontend router references missing resource: {ref}")
        size = target.stat().st_size
        item = {"path": ref, "bytes": size}
        if len(active) >= max_refs:
            item["reason"] = "max_refs"
            deferred.append(item)
            continue
        if active and total_bytes + size > max_bytes:
            item["reason"] = "max_bytes"
            deferred.append(item)
            continue
        active.append(item)
        total_bytes += size

    return {
        "primary_mode": primary_mode(normalized),
        "signals": normalized,
        "matched_signals": matched,
        "active_references": active,
        "deferred_references": deferred,
        "active_bytes": total_bytes,
        "max_refs": max_refs,
        "max_bytes": max_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signals", required=True, help="Comma-separated design/task signals")
    parser.add_argument("--max", type=int, default=3, dest="max_refs")
    parser.add_argument("--max-bytes", type=int, default=49152)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.max_refs < 1:
        raise SystemExit("--max must be >= 1")
    if args.max_bytes < 1:
        raise SystemExit("--max-bytes must be >= 1")
    result = route_signals(args.signals, max_refs=args.max_refs, max_bytes=args.max_bytes)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(result["primary_mode"])
        for item in result["active_references"]:
            print(item["path"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
