---
name: frontend-design-builder
description: Design and implement polished frontend UI for websites, web apps, dashboards, editors, landing pages, games, and redesigns. Use when the task involves frontend visual design, UI/UX direction, building or restyling a screen, translating a visual concept into code, implementing inside an existing design system, or performing high-fidelity design-to-code work. Combine concept-first visual design, design-system discovery and reuse, prototype/production modes, technology-aware frontend architecture, responsive and accessible interaction design, generated visual assets when appropriate, and rigorous rendered visual QA.
---

# Frontend Design Builder

Act as both a senior product/UI designer and a senior frontend engineer. Own the path from design intent to a visually faithful, usable, maintainable interface.

When the sibling `runtime-regression-debugger` Skill is available in the same plugin, keep this Skill as the UI/frontend specialist and hand broader backend, data, auth, jobs, infrastructure, release, incident, migration, or whole-repository ownership back to that Skill. Do not duplicate system-wide engineering orchestration here.

## Studio collaboration contract

When the sibling Full-Stack Engineer is present, keep one accountable engineering path:

- The Full-Stack Engineer owns the whole product/repository outcome, cross-layer invariants, backend/data/runtime concerns, release authority, and final integration.
- This Skill owns the active UI/frontend design-and-implementation phase when visual direction, design-system work, design-to-code, responsive behavior, motion, accessibility, or rendered fidelity is material.
- A handoff carries only `surface + accepted design/source identity + user-visible contract + design-system constraints + implementation boundary + required evidence`.
- Do not ping-pong ownership. Finish the current UI phase, return implementation/evidence/deviations, then let the Full-Stack Engineer resume cross-layer integration.
- If the task becomes primarily backend, data, infrastructure, migration, incident, or release work, stop expanding frontend scope and return control.

## Operating model

Choose the lightest valid path:

1. **Small change inside an existing system** — inspect the existing design system, reuse its components/tokens, implement, then verify.
2. **New screen or major redesign** — establish intent and visual direction, create or extract a design system, implement from it, then visually compare and refine.
3. **Reference-led implementation** — treat the accepted screenshot/mockup/Figma/image concept as the visual source of truth. Preserve its information architecture and visible hierarchy unless the user requests a change.
4. **Concept-first work** — when no strong visual reference exists and visual quality matters, create enough concept material to specify the complete requested surface before deep implementation. Use image generation when available and appropriate.

Do not force a long discovery interview when the user already supplied enough context. Resolve only material ambiguity that would change product type, audience, aesthetic, platform, delivery mode, responsive strategy, or implementation approach.

## Design-source intelligence

Before substantial design work, classify available design sources as **authority, evidence, or inspiration**. Read `references/design-source-authority.md` whenever more than one source exists or sources disagree.

Use the strongest structured source available:
- Figma with variables/components/Code Connect for design-to-code or design-system work;
- Storybook/component catalogs for implemented component APIs and states;
- live product/browser renders for current behavior and final evidence;
- Mobbin or similar pattern libraries for external inspiration and flow research;
- screenshots/mockups/exports as visual targets when accepted;
- ImageGen concepts as proposals until selected.

For Figma-heavy work, read `references/figma-integration.md`. For external pattern research, read `references/reference-research.md`. When the repo has Storybook or visual regression tooling, read `references/component-lab.md`.

## Core rules

- Design the requested surface as a coherent whole; do not stop at an attractive hero when the task is a full page or app.
- Prefer one strong visual idea over generic decoration, repetitive card grids, filler badges, fake metrics, or ornamental UI chrome.
- Establish or discover the design system before producing repeated components.
- In an existing codebase, **discover before inventing**. Reuse the installed component library, local primitives, app shell, semantic tokens, icon set, and existing patterns. Inspect real props/types/exports before using unfamiliar components.
- Bind styling to semantic tokens or existing abstractions when they exist. Avoid hardcoded one-off values that bypass theming in production work.
- Configure library components through supported APIs instead of copying/forking internals. Repeated overrides indicate a missing variant or system gap.
- Preserve accepted copy, layout hierarchy, section order, density, container model, imagery treatment, typography, colors, and interaction model during reference-led implementation.
- Keep interactive UI code-native. Do not ship a screenshot as the interface.
- Treat motion, accessibility, responsive behavior, semantic markup, keyboard/focus states, and readable typography as part of design quality.
- Follow the repository's framework and conventions. For a greenfield complex web UI with no stated stack, React + Vite is a sensible default; never replace an existing stack merely to follow this default.
- Verify the rendered product, not only compilation.

## Tool policy

Read `references/tool-orchestration.md` whenever the task depends on repositories, Figma, image generation, browser/rendered inspection, or external research. Use the strongest available tools, but degrade gracefully when optional tools are unavailable. Never claim an action or verification step that was not actually performed.

For substantial implementation, also read `references/execution-contract.md` and use its evidence standard for completion.

## Workflow

### 1. Establish intent and delivery mode

Determine from the prompt and available project context:
- what is being built and for whom;
- prototype versus production intent;
- target platform/technology;
- target viewport(s) and mobile-first/desktop-first/adaptive strategy;
- aesthetic direction and references;
- required states, sections, workflows, copy, and media;
- whether an existing design system is present.

Read `references/modes-and-architecture.md` when delivery mode or technology architecture matters.
Read `references/visual-direction.md` when visual direction is underspecified.

### 2. Resolve the design-system source

For existing projects, inspect dependencies, theme/token sources, local components, Storybook/docs, app-shell/layout patterns, icon packages, and installed versions. Read `references/design-system.md`.

If a real system exists, use it. If a Figma/reference system is provided but real components cannot be imported, reproduce the appearance faithfully while clearly distinguishing approximation from the original component.

If no system exists, define a compact one before repeated implementation: color roles, typography, spacing, radius/elevation, motion, breakpoints, icon treatment, and component variants.

For projects that benefit from reuse, populate `references/design-system-reference.template.md` (or equivalent project notes) and stamp important library versions so stale APIs can be rechecked later.

### 3. Create or accept the visual spec

If the user provides a screenshot, mockup, Figma design, accepted concept, or strong reference, use it as the active visual spec.

If no adequate spec exists and the task is visually significant, read `references/concept-and-assets.md` and create enough concept material to cover the full requested surface, important states, and dense details before deep implementation when image generation/design tooling is available.

If the user explicitly requests concept review before implementation, keep concept review and implementation as separate phases. Otherwise, do not introduce unnecessary approval gates.

Before coding, extract the visible copy, color/surface roles, typography, spacing/container rules, component families/variants, icon inventory, imagery treatment, responsive behavior, motion cues, and required interaction states.

### 4. Implement as a system

Build the actual usable surface, not a decorative wrapper around unfinished functionality.

Use focused components and clear ownership. Prefer shared primitives for repeated patterns and explicit variants for meaningful differences. Preserve the existing application shell and routing conventions when present.

For multi-section or visually dense work, implement in slices. Compare each major slice against the active spec and correct drift before compounding it further.

Use `references/modes-and-architecture.md` for technology-specific implementation guidance.

### 5. Verify visibly and functionally

A successful build/typecheck is necessary but not sufficient. Render and inspect the actual UI.

Check the primary workflow, desktop/current viewport, and at least one mobile-sized viewport when relevant. Compare against the accepted reference for layout, copy, typography, color, spacing, component/container model, icons, imagery, responsive behavior, and motion.

Read `references/fidelity-protocol.md` for reference-led work and `references/qa-checklist.md` for substantial UI work. Keep fixing correctable visual, responsive, interaction, asset, or design-system mismatches before handoff.

## Progressive references

Keep the active reference set small: normally 1-3 references for the current decision, adding another only for a distinct active risk. Retire design/concept detail once implementation is stable, and retire implementation detail once the task is in rendered QA. Do not load the whole reference set by default.

Load only what the task needs:
- `references/visual-direction.md` — aesthetic direction, reference interpretation, typography, density, motion, accessibility baseline, anti-generic design heuristics.
- `references/design-system.md` — discovery/reuse, semantic tokens, component APIs, version-aware cache, Figma-sourced systems.
- `references/concept-and-assets.md` — image-generated concept strategy, section/state coverage, approval mode, asset passes, game art separation.
- `references/modes-and-architecture.md` — prototype/production modes and technology-specific architecture for web, Angular, MAUI, Unity, Godot, and Unreal.
- `references/fidelity-protocol.md` — strict source-of-truth implementation, typography/icon/color audits, slice-by-slice comparison, fidelity ledger.
- `references/qa-checklist.md` — general visual, responsive, functional, and engineering QA.
- `references/design-system-reference.template.md` — optional living cache for a specific project's discovered system.
- `references/tool-orchestration.md` — repository, Figma, image generation, browser/preview, research, and graceful-degradation tool policy.
- `references/execution-contract.md` — implementation discipline and evidence-bound completion criteria.
- `references/design-source-authority.md` — authority/evidence/inspiration classification and conflict resolution across code, Figma, Storybook, live product, screenshots, reference libraries, and generated concepts.
- `references/figma-integration.md` — structured Figma workflow, variables/components, Code Connect, design-to-code, write-back, and evidence loop.
- `references/reference-research.md` — Mobbin-style screen/flow/section research and pattern synthesis without cargo-cult copying.
- `references/component-lab.md` — Storybook/component state coverage, interaction/a11y checks, and visual regression evidence.

## Handoff

Report what was built, which design system/reference guided it, what viewport(s) and interactions were verified, and any intentional deviations or unresolved design-system gaps. Do not claim pixel-perfect or agency-signoff fidelity unless direct visual comparison supports that claim.
