# Visual Design Authority

Use this for substantial new screens, major redesigns, visually important product surfaces, or any task where the current UI quality is explicitly judged poor. Small local fixes and faithful implementation from an already accepted visual target do not need the full gate.

The goal is to prevent code-first UI and generic AI layout drift. A design is not ready for deep implementation merely because its requirements are understood.

## Before deep implementation

A substantial unresolved UI must have all of these:

- inspected current product/design-system evidence when available;
- one explicit visual brief tied to the product, user, task, and platform;
- a real visual target that covers the requested surface rather than only a hero or decorative fragment;
- a compact design contract for hierarchy, typography, density, layout/container model, color/material, component language, imagery/iconography, responsive behavior, states, and motion where material;
- a passed anti-generic review.

When visual/design tools are available, text-only design descriptions are not enough. Materialize the direction in Figma, generated concept imagery, or a bounded visual prototype before deep production coding.

## Concept competition

When no accepted visual target exists and direction is unresolved, create 2-3 materially different directions before committing.

Directions must differ in meaningful structure such as:

- hierarchy or focal point;
- navigation or task framing;
- density and whitespace strategy;
- composition/container model;
- interaction model;
- content emphasis;
- typography/material language.

Recolors, different gradients, or moving the same cards around are not distinct concepts.

Do not create a user approval checkpoint unless the user asks for one or the competing directions change product semantics/scope. Otherwise select the strongest direction from evidence and continue.

## Selection standard

Choose the direction that best satisfies the product, not the one that is easiest to code.

Reject a direction when it lacks a clear focal point, weakens the primary task, conflicts with the design system without reason, cannot plausibly adapt responsively, or depends on decorative filler to feel complete.

Prefer evidence of:

- product-specific identity rather than generic SaaS styling;
- obvious information hierarchy;
- disciplined typography and spacing rhythm;
- coherent density;
- reusable component language;
- meaningful states and interaction feedback;
- responsive plausibility;
- visual distinction that still serves usability.

Do not reduce this to a numeric beauty score.

## Anti-generic rejection test

A substantial concept fails the gate when several of these are doing the visual work instead of product structure:

- repeated rounded cards around nearly every region;
- bento grids used without task-driven grouping;
- arbitrary purple/blue gradients, glows, glass, or neon;
- meaningless badges, pills, eyebrow labels, fake metrics, or pseudo-system status;
- identical spacing rhythm everywhere;
- weak type hierarchy with one generic font/weight treatment;
- decorative icon rows or icon-label boxes that do not improve the task;
- centered marketing composition applied to an operational product;
- stock imagery or generated decoration with no product role;
- a standard sidebar + topbar + card dashboard copied without product-specific affordances;
- mobile behavior that simply compresses the desktop composition.

Remove or redesign the cause; do not explain it away in handoff notes.

## Tool use

Use the Design Action Fabric to bind this gate to real providers.

- Figma/design canvas: materialize structured layout, components, variables, states, and inspectable visual alternatives.
- Image generation: explore art direction, atmosphere, illustration, character/asset direction, or whole-surface concepts where raster concepts are appropriate.
- Browser/rendered preview: treat the coded product as implementation truth and capture comparison evidence.
- Repository/Storybook: preserve real component and token constraints.

Do not force Figma when another provider produces stronger evidence for the active phase.

## Implementation lock

After selecting a direction, lock one active visual target and one compact design contract. Deep implementation may then begin.

During implementation, do not silently redesign because code is easier another way. If implementation evidence proves the target is invalid, update the target/contract explicitly and continue from the new authority.

For dense surfaces, implement and compare by coherent region so visual drift cannot accumulate.

## Handoff gate

Substantial UI work is not design-complete until:

1. the real product is rendered;
2. the primary viewport is compared against the active visual target;
3. responsive behavior is checked when relevant;
4. typography, hierarchy, spacing/density, container model, color/material, assets/icons, and material states are inspected;
5. actionable P0/P1/P2 visual or interaction issues are fixed when the environment allows.

A successful build is engineering evidence, not visual-quality evidence.

## Evidence ledger

Keep only enough evidence to resume reliably:

- active visual target identity;
- selected concept and rejected direction notes when competition mattered;
- design-system/token/component authority;
- key visual decisions;
- screenshots/canvas evidence used;
- comparison findings and unresolved deviations.

Do not create process documents merely for ceremony.
