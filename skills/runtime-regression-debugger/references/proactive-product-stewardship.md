# Proactive product stewardship

Use this when broad authorization covers continuing, improving, polishing, rescuing, or owning a product/repository without a ticket-by-ticket backlog. Convert that trust into evidence-backed product improvements, not subjective redesign or invented business policy.

## Contents

- Operating contract
- Repository-to-product autopilot
- What to inspect proactively
- Run a Product Health Scan without fake scoring
- Distinguish defects from taste
- Rank the next improvement by product leverage
- UI and frontend design ownership
- Proactive improvements adjacent to non-frontend work
- Product-quality sweep record
- No-change is a valid stewardship result
- Boundaries

## Operating contract

Use:

`live product surface -> bounded quality sweep -> evidence-backed candidates -> product-impact ranking -> smallest complete fix -> real-boundary validation -> next valid frontier -> bounded rescan when needed`

Broad ownership means find and close the next high-leverage defect safely inside scope. It does not authorize branding-by-taste, invented pricing/privacy/safety/business policy, unrelated redesign, or consequential external actions.

## Repository-to-product autopilot

Compose takeover and stewardship without creating another project manager:

`takeover truth -> runnable baseline -> compact product model -> bounded quality sweep -> highest-leverage outcome -> design/technical contract -> vertical implementation -> real-boundary proof -> next frontier`

Keep the product brief small: product/surface type, primary actor/job, core visible path, state/data/security constraints, current design language when applicable, validation/release capability, explicit goal/non-goals, and authorization boundary. Inferred users/positioning remain provisional; source code is not a business strategy oracle.

Maintain a small evidence-backed candidate queue, usually 3-7 items, covering only observed needs such as correctness, incomplete flows, friction, visual/interaction quality, accessibility, reliability/performance, delivery blockers, or missing proof. Keep one active candidate until closed, blocked, invalidated, or preempted by materially stronger fresh evidence; **do not thrash between nearby ranks**.

After a slice, **invalidate or re-rank only candidates** whose evidence, dependencies, owner, or impact changed. Continue the next still-valid candidate. Re-run the bounded sweep only when the **queue is exhausted**, materially stale/blocked, or product/authority/topology change invalidates its ordering.

If user-facing design is unsettled, route to `design-synthesis-prototyping.md` plus the relevant surface owner; stewardship selects work but does not become a second design handbook. Continue authorized reversible repository work autonomously; stop/escalate only for product-sensitive ambiguity, consequential action, missing credentials/capability, or evidence that the requested direction itself needs a human choice.

## What to inspect proactively

Look for material debt on active product paths:

- user-visible correctness, completion, recovery, stale/misleading state;
- experience friction, hierarchy, navigation, affordance, unnecessary steps;
- visual consistency, density, spacing, typography, component treatment;
- interaction states: focus/hover/disabled/loading/success/error/empty/offline/partial;
- responsive/adaptive behavior, clipping, overflow, touch targets, collapsed navigation;
- accessibility semantics, keyboard/focus, labels, errors, contrast, reduced motion;
- content clarity and terminology;
- placeholders, fake success, broken onboarding/recovery, UI disconnected from real auth/data/state;
- user-felt latency, duplicate work, flicker, stale commits, brittle retry/offline behavior;
- maintainability only when it causes product risk, repeated regression, or blocks current delivery.

Do not default to invisible cleanup merely because it is easier to test. When a UI exists, rendered experience is part of the owned system.

## Run a Product Health Scan without fake scoring

A Product Health Scan is a bounded decision instrument, not a dashboard score. Inspect only dimensions that can change the next action:

- correctness/data/security/privacy;
- product completeness/onboarding/recovery;
- UX/accessibility/content;
- rendered visual/responsive/design-system quality;
- performance and material cost amplification;
- reliability/recovery/observability;
- delivery/operability/rollback;
- developer/test confidence when it blocks product work.

For each live candidate record:

`evidence -> affected contract -> consequence -> confidence -> urgency -> owner -> next action -> cheapest falsifier -> dependencies`

Use `confirmed`, `supported`, or `hypothesis`; a hypothesis gets a `probe`. TODO count, dependency age, file size, test count, or repository metrics are not defects without a live consequence.

When useful, run `scripts/product_stewardship_gate.py <manifest> --json` with `mode: "health-scan"`. It validates record shape/evidence discipline; it does not compute health or certify truth.

## Distinguish defects from taste

A finding is stronger when it blocks/delays/misleads a real task, violates an established component/token/interaction convention, breaks a representative viewport/input method, lacks a reachable loading/error/empty/recovery state, violates accessibility semantics, has rendered evidence plus a concrete acceptance criterion, or recurs in support/test/analytics/repository evidence.

Weak evidence alone includes “this looks nicer,” fashion-driven redesign, swapping a coherent component library for novelty, broad animation/gradient/typography churn, or pixel changes that do not improve hierarchy, clarity, consistency, accessibility, or completion.

Preserve a coherent visual language unless that language is itself the defect. Improve from inside the current vocabulary before inventing a replacement.

## Rank the next improvement by product leverage

Use:

`user harm / blocked outcome -> frequency / surface area -> contract incompleteness -> confidence -> reversibility -> implementation cost`

Severe auth/data/billing/durability/reliability/accessibility problems outrank polish when consequence is materially higher. A small visible fix may outrank a sophisticated refactor when it removes more user friction.

Useful classes are **must fix now**, **high-leverage polish**, **companion improvement**, **defer**, and **no change**. Record why the selected item outranks plausible alternatives so initiative follows product value rather than novelty.

## UI and frontend design ownership

For user-visible web/desktop/mobile candidates, stewardship owns selection and prioritization; specialist design owners own design decisions:

- `frontend-product-patterns.md` for hierarchy/workflow/interaction/design-to-code;
- `frontend-visual-system-patterns.md` for visual hierarchy, responsive behavior, component/token contracts;
- `visual-ui-quality-assurance-product-engineering.md` for rendered/task evidence and repair;
- `accessibility-product-engineering.md` for accessibility semantics/presentation;
- `user-onboarding-activation-product-engineering.md` for setup/activation/time-to-value.

Rendered evidence is required when the claim depends on what a user sees or can interact with. Capture route/state/viewport, then hand detailed visual diagnosis to the visual-QA owner. A clean screenshot cannot prove auth/data/recovery correctness; source suspicion cannot prove a visible defect when the surface can falsify it.

## Proactive improvements adjacent to non-frontend work

Close only companion experience work implied by the mechanism: async work needs truthful pending/success/failure/retry/cancel states; new permission states need meaningful denied/limited presentation; billing/entitlement changes need accurate access/renewal state; performance work may need visible flicker/loading cleanup; migration fields need old/new-client compatibility and graceful empty states.

Do not redesign unrelated screens while touching backend/data/auth/runtime/infrastructure.

## Product-quality sweep record

For larger self-directed cycles, keep only: product goal/authorization, active surfaces and evidence source, material findings with user impact, selected candidate and why it wins, scope/deferrals, focused regression oracle, and visible/real-boundary validation oracle.

Use `scripts/product_stewardship_gate.py` only when that structure improves discipline. It is not a taste oracle.

## No-change is a valid stewardship result

Do not mutate a coherent surface merely because broad authorization exists. A valid sweep may conclude that the UI is coherent, evidence is too subjective, or a higher-impact non-UI problem should win. Record what was inspected, the evidence, and what would justify revisiting.

## Boundaries

- Do not invent business strategy, pricing, entitlement, privacy, safety, or legal policy.
- Do not publish, deploy, change production traffic, or take other consequential actions without required authorization.
- Do not replace coherent visual language for fashion/personal taste.
- Do not hide correctness/security/data/accessibility defects behind polish.
- Do not call a UI finished without visible evidence when material render/browser validation is available.
- Do not turn every task into a redesign; initiative stays proportional to evidence and user impact.
