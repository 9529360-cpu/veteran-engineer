# Proactive product stewardship

Use this when the engineer has broad authorization to improve, continue, polish, rescue, or own a product/repository without being given a narrowly enumerated ticket list. The goal is to convert that broad trust into evidence-backed product improvements rather than passive ticket execution or subjective redesign.

Broad ownership means: actively find the next highest-leverage product defect that can be fixed safely inside the authorized project. It does **not** mean inventing business policy, changing branding by taste, widening scope without evidence, or bypassing consequential-action authorization.

## Operating contract

Use this loop:

`live product surface -> bounded quality sweep -> evidence-backed candidates -> product-impact ranking -> smallest complete fix -> visible/boundary validation -> cleanup -> next sweep`

Keep the sweep bounded. Inspect enough of the active product to choose the next safe improvement, not every file or every screen.

## What to inspect proactively

When broad product ownership is active, look for material quality debt in these classes:

- user-visible correctness: dead ends, contradictory states, missing completion/recovery, stale or misleading UI;
- experience friction: unclear primary action, poor information hierarchy, confusing navigation, unnecessary steps, weak affordances;
- visual quality: spacing rhythm, alignment, typography hierarchy, density, contrast, surface grouping, inconsistent component treatment, awkward empty space, visual noise;
- interaction quality: hover/focus/pressed/disabled/loading/success/error/empty/offline/partial states, feedback timing, destructive-action boundaries;
- responsive/adaptive quality: clipping, overflow, unusable widths, touch targets, collapsed navigation, table/detail behavior, sticky regions;
- accessibility: semantics, keyboard flow, focus, labels, error communication, contrast, reduced-motion behavior when relevant;
- content quality: ambiguous labels, mechanical copy, inconsistent terminology, missing guidance, overly technical error text;
- product completeness: placeholder surfaces, fake success states, missing onboarding/recovery, disconnected UI and real data/auth/state;
- performance/reliability that users can feel: slow interaction, duplicate work, flicker, layout shift, stale response commits, brittle offline/retry behavior;
- maintainability only when it creates real product risk, repeated regressions, inconsistent behavior, or blocks the next product improvement.

Do not consistently choose invisible backend cleanup merely because it is easier to test. If the product has a user interface, the rendered experience is part of the owned system.

## Distinguish defects from taste

A veteran engineer should have design judgment without turning personal preference into authority.

Treat a finding as stronger when it has one or more of these signals:

- it blocks, delays, misleads, or increases error for a real user task;
- it violates an established design-system/token/component convention;
- it creates inconsistent hierarchy or interaction semantics across comparable surfaces;
- it breaks at a representative viewport or input method;
- it lacks a reachable loading/error/empty/recovery state;
- it violates an accessibility requirement or semantic expectation;
- it is visible in rendered evidence and has a concrete before/after acceptance criterion;
- it repeatedly appears in support, test, analytics, or repository evidence.

Treat these as weak evidence by themselves:

- “this color feels nicer”;
- fashion-driven redesign with no product problem;
- replacing a coherent component library because another library looks newer;
- broad animation, gradient, typography, or layout churn without a user/task reason;
- pixel-level changes that do not improve hierarchy, clarity, consistency, accessibility, or task completion.

Preserve a coherent existing visual language unless that language is itself the defect. Improve the system from inside its established vocabulary before inventing a new one.

## Rank the next improvement by product leverage

Choose the next self-directed candidate using this order of evidence:

`user harm / blocked outcome -> frequency / surface area -> contract incompleteness -> confidence of evidence -> reversibility -> implementation cost`

A smaller visible fix can outrank a technically sophisticated refactor when it removes more real user friction. A severe auth, data, billing, durability, or reliability defect still outranks visual polish when the risk is materially higher.

Useful candidate classes:

- **must fix now**: correctness, security, data, accessibility, or severe usability defect on an active path;
- **high-leverage polish**: visible hierarchy/interaction/responsive/content issue with clear evidence and bounded implementation;
- **companion improvement**: required to make the current feature complete and coherent;
- **defer**: real issue but lower leverage than another active candidate;
- **no change**: coherent behavior where mutation would be taste-driven or would create churn without product benefit.

Record why the selected item wins over plausible alternatives. This keeps initiative aligned with product value rather than novelty.

## UI and frontend design ownership

When a user-visible web, desktop, or mobile surface exists, inspect it as a product designer and frontend engineer, not only as source code.

For meaningful surfaces check:

1. **Visual hierarchy** - Can the user immediately identify context, primary content, and primary action? Are secondary/destructive actions appropriately de-emphasized?
2. **Layout and density** - Are spacing, alignment, grouping, line length, table/card density, and whitespace coherent at realistic content sizes?
3. **Typography and color roles** - Do heading/body/label/status roles communicate structure? Are contrast and status semantics readable without excessive decoration?
4. **Interaction states** - Are hover/focus/pressed/disabled/loading/success/error/empty/stale/partial states intentional rather than accidental?
5. **Responsive behavior** - Does the layout remain usable under content pressure and representative viewport classes rather than only one desktop width?
6. **Accessibility** - Do semantics, keyboard order, focus, names, labels, instructions, status updates, and contrast preserve the same product meaning?
7. **Content and terminology** - Are labels/action copy/error text specific, human-readable, and consistent with the product domain?
8. **Consistency** - Does the surface reuse established tokens/components/patterns, and are exceptions intentional?

Read `frontend-product-patterns.md` for implementation details and `accessibility-product-engineering.md` when accessibility is material.

## Design initiative without over-design

When the existing UI is visibly weak or inconsistent and the user has delegated broad product ownership:

- recover the existing design system, tokens, shared components, and representative screens first;
- fix hierarchy and interaction before decorative detail;
- prefer reusable improvements when the same defect repeats across surfaces;
- preserve brand identity unless the user explicitly authorized brand work;
- use established primitives before adding dependencies or a parallel component system;
- keep product-specific policy out of purely visual primitives;
- avoid a full redesign when a focused layout/component/state correction solves the problem;
- if no coherent system exists, establish the smallest useful token/component conventions rather than inventing a large design framework.

Good initiative is visible as fewer user decisions, clearer hierarchy, more complete states, stronger consistency, and lower friction—not as maximum visual change.

## Work from rendered evidence when available

Source inspection can reveal likely UI defects, but meaningful visual claims need rendered evidence when the environment supports it.

For a material UI improvement:

`active route/state -> representative data -> representative viewport/input -> rendered inspection -> implementation -> rendered re-check`

Inspect at least the states and viewport classes that can falsify the intended improvement. Look for overflow, clipping, unintended wrapping, density, alignment, hierarchy, focus, touch/keyboard reachability, empty/error/loading behavior, and content-length pressure.

A screenshot alone is not a complete oracle. Also verify real state/data/auth wiring and interaction semantics. Conversely, green unit tests do not prove that a user interface is visually coherent.

For material visual changes, read `visual-ui-quality-assurance-product-engineering.md`. Use `scripts/visual_quality_gate.py` when an explicit surface/viewport/state/content/input evidence matrix would prevent screenshot-only validation or overclaiming.

If browser or visual execution is unavailable, continue lower-boundary implementation and be explicit that visual verification remains unproven rather than claiming the design is finished.

## Proactive improvements adjacent to non-frontend work

Backend, data, auth, runtime, or infrastructure changes can expose product-experience debt. Close only the companion work implied by the mechanism.

Examples:

- a new async workflow needs meaningful pending, success, failure, retry, and cancellation states in the UI;
- a new permission rule needs a clear denied/limited-access presentation rather than a generic 500;
- a new billing/entitlement state needs accurate user-visible access and renewal status;
- a performance fix may require eliminating visible flicker or duplicate loading transitions;
- a migration that changes available fields may require old/new client compatibility and graceful empty states.

Do not use broad ownership as an excuse to redesign unrelated screens while touching a backend path.

## Product-quality sweep record

For larger self-directed improvement cycles, a compact record can prevent the engineer from defaulting to whichever subsystem is easiest to modify:

- product goal and authorization scope;
- active surfaces inspected and evidence source;
- UI quality dimensions checked when a UI exists;
- evidence-backed candidate findings with user impact;
- selected next candidate and why it outranks alternatives;
- scope boundary and deliberate deferrals;
- focused regression oracle;
- visible or real-boundary validation oracle.

Use `scripts/product_stewardship_gate.py` when a structured quality-sweep record materially improves discipline. It is a planning/closure aid, not a design taste oracle.

## No-change is a valid stewardship result

Do not mutate a coherent surface simply because broad authorization exists. A product-quality sweep may conclude that the active UI is consistent, the visible issue is too subjective, or a higher-impact non-UI defect should win.

A no-change decision should still state what was inspected, what evidence was considered, and what would justify revisiting it.

## Boundaries

- Do not invent business strategy, pricing, entitlement, privacy, safety, or legal policy under the label of product polish.
- Do not change production traffic, publish externally, or perform other consequential actions without the required authorization.
- Do not replace a coherent visual language for fashion or personal taste alone.
- Do not hide correctness, security, data, or accessibility defects behind cosmetic polish.
- Do not call a UI “finished” without visible evidence when rendering/browser validation is available and material.
- Do not turn every task into a redesign; initiative should be proportional to evidence and user impact.
