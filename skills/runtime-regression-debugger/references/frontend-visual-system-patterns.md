# Frontend visual system patterns

Use this only when the current design decision concerns visual hierarchy, reduction/restyling, responsive/adaptive behavior, reusable visual/component contracts, or rendered visual validation. Keep product intent, information architecture, workflow, and accepted experience semantics under `frontend-product-patterns.md`; use `visual-ui-quality-assurance-product-engineering.md` for final rendered QA authority.

## Contents

- Reduce before restyling
- Visual system and hierarchy
- Responsive and adaptive behavior
- Design-system and component contract
- Visual and browser validation

### Reduce before restyling

When an existing interface feels noisy, generic, over-designed, or `AI-ish`, treat the first question as **what should disappear or quiet down**, not `what new style should replace it?` Capture the real rendered surface first; compounding visual noise is a property of the composition, not something JSX alone can prove.

Use this ordered reduction ladder and stop at the first rung that resolves the defect:

1. **Delete** - remove unsupported furniture: fake metrics/proof, redundant cards/sections/dividers, duplicated actions, ornamental labels, decorative chrome, or controls that do not serve a reachable user job.
2. **Reduce** - lower layer count, simultaneous accents, competing weights, borders/elevation, persistent badges, and other attention claims while preserving necessary structure.
3. **Reconcile** - pull one-off spacing, radius, typography, icon, surface, or component treatment back to the active product system when drift is the cause.
4. **Restyle** - change palette, material, type treatment, or decorative language only after deletion/reduction/reconciliation cannot satisfy the design contract.

Do not call a costume swap a redesign. Replacing purple with cyan, cards with glass, or one font with another leaves a bad information structure intact. Preserve distinctive choices that already serve the product; the purpose of the ladder is to remove accidental competition, not normalize every interface into bland minimalism. For a user-requested redesign, structural or workflow defects remain open even if the surface looks cleaner afterward.

A valid design target can be a user-provided Figma frame, screenshot, mockup, reference URL, an existing in-product pattern, or an explicit wireframe plus visual-system specification. When a broad redesign has no target, explore two or three materially different structural/visual directions if the available design tools make that cheap. Do not generate cosmetic palette variants and call them distinct directions. Ask the user to choose only when the alternatives encode a genuine product/brand decision that repository evidence cannot safely resolve; otherwise choose the strongest evidence-backed direction and continue.


When several design candidates exist, narrow them in this order instead of turning every difference into a preference poll:

1. **Gate** - reject candidates that violate explicit requirements, accessibility, platform constraints, real workflow/state semantics, or another non-negotiable contract. Do not ask the user to choose an objectively invalid option merely because it looks different.
2. **Trade-off** - compare the remaining candidates on concrete product consequences such as density, discoverability, task throughput, information persistence, learning cost, responsiveness, brand expression, or implementation/maintenance burden.
3. **Preference** - ask the user only for the residual subjective or identity decision that evidence cannot settle safely. State the real difference rather than `A/B/C` with no rationale.

A design option is not stronger because more effort was spent rendering it. Preserve disconfirming evidence and rejected-candidate reasons so later implementation pressure does not resurrect a direction that already failed a gate.

When exploration is needed, keep it **disposable by contract**. A sketch/spike exists to answer a design or feasibility question, not to become production code by inertia. Isolate it from authoritative application owners, use representative product content, include enough interaction/state to compare the real idea, render it before trusting it, and record the decision it resolved. After choosing a direction, carry the accepted design decisions into the implementation inventory and build in the real architecture; do not preserve throwaway structure merely because time was spent on it. Delete or clearly quarantine the exploration artifact when its evidence has been captured.

Change freedom deliberately across the design lifecycle:

- **exploration** - high freedom: compare meaningfully different structures/visual theses while the product question is genuinely open;
- **selection/specification** - converge: resolve the chosen hierarchy, states, visual system, and unresolved product clauses;
- **implementation** - low creative freedom on accepted dimensions: translate the target faithfully through real components/data/state while retaining engineering freedom in invisible mechanics;
- **QA repair** - bounded freedom: fix the smallest violated clause; structural/product changes reopen the relevant design decision instead of being smuggled in as polish.

Do not confuse strict implementation fidelity with conservative design exploration. Before acceptance, one boring implementation-shaped option is not safer than comparing real alternatives; after acceptance, continuing to invent alternatives is drift.

## Visual system and hierarchy

Use visual choices to communicate importance, grouping, status, and affordance. Treat visual structure as information, not ornament: borders, labels, numbering, dividers, badges, rails, panels, and containers should explain grouping, sequence, state, or action. Do not add structural chrome merely because a generated interface looks empty without it.

Prefer a small coherent system over many one-off values. Resolve the system in this order when the task permits: `task/information structure -> hierarchy/type/space -> components/tokens -> color/material/depth -> motion/decoration`. Later layers may reinforce earlier ones but must not substitute for them.

- typography scale with clear heading/body/label roles;
- spacing rhythm rather than arbitrary gaps;
- restrained color roles for surfaces, text, borders, emphasis, status, and actions;
- consistent corner radius, border, and elevation semantics;
- icons that reinforce meaning instead of replacing necessary labels;
- motion that communicates state change rather than decorative movement.

Do not use color alone to communicate critical state. Preserve readable contrast and avoid dense decorative chrome that competes with primary content.

## Responsive and adaptive behavior

Design around content pressure and task priority, not device-brand breakpoints.

For each meaningful viewport transition decide:

- what reflows versus what disappears;
- whether navigation collapses, relocates, or changes interaction model;
- whether tables become horizontally scrollable, stacked, summarized, or switch to cards;
- whether primary actions remain reachable without excessive scrolling;
- how dialogs, drawers, sidebars, and sticky regions behave;
- minimum usable widths for important controls and data.

Do not validate only one desktop screenshot. Check at least the viewport classes actually relevant to the product and change.

## Design-system and component contract

Treat reusable UI as a contract between design and implementation.

Before creating a new primitive, search for an existing component that already owns the semantics. Reuse or extend it when doing so preserves clarity.

For a new reusable component define, when material:

- semantic purpose;
- variants and sizes;
- interactive states;
- content constraints;
- accessibility behavior;
- responsive behavior;
- token dependencies;
- composition rules and escape hatches;
- what belongs in the primitive versus a product-specific wrapper.

Avoid creating a generic component abstraction from a single accidental use case. Avoid encoding product policy into purely visual primitives.

For product-wide drift, first classify the problem as a shared-owner defect, consumer misuse, intentional exception, or legacy path. Treat tokens and variant names as semantic contracts rather than aliases for raw values; do not add a shared abstraction merely because two surfaces look similar. Fix the canonical shared owner only when evidence shows a genuinely shared cause, and keep product-specific behavior in owned wrappers.

When consumers cannot move atomically, migrate shared token/prop/variant contracts compatibly and give temporary aliases a removal condition; when one application ships atomically, do not invent a distributed migration problem. Validate shared primitive or token changes across representative real consumers, content pressure, responsive states, interaction states, and accessibility before deleting the legacy owner.

## Visual and browser validation

For meaningful UI work, visible verification is part of completion. Compare the real implementation against the design contract or source target, not merely against the pre-change code. For an existing surface, capture before/after evidence when practical; for a new surface, use the selected target/design contract as baseline.

When a source visual exists, inspect the source target and the latest rendered screenshot side by side before handoff. Browser/DOM inspection alone cannot replace that comparison because hierarchy, spacing, typography, imagery, and overall composition drift can remain invisible at the code level. If the pair would still attract material design-review comments, keep the relevant clause open and iterate.

When browser or desktop execution is available:

- render the actual changed route/state, not a detached demo unless the product architecture requires one;
- capture representative viewport evidence;
- inspect overflow, clipping, unintended wrapping, density, alignment, and visual hierarchy;
- exercise hover/focus/disabled/loading/error/empty states that materially affect the design;
- verify keyboard flow and accessible names for critical interactions;
- compare the rendered result against the design intent, not merely against a pixel snapshot;
- re-check responsive behavior after implementation changes component structure or content length.

Use visual diffs as evidence of change, not as the sole oracle. A pixel-identical interface can still be unusable or inaccessible, and a legitimate responsive/rendering change can intentionally move pixels.

When the visual contract is accepted and the current problem becomes CSS/utility/theme/token implementation, hand off to `frontend-styling-implementation-patterns.md` rather than continuing to invent visual direction inside production styles.
