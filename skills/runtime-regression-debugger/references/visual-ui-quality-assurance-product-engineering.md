# Visual UI quality assurance product engineering

Use this when a user-visible web, desktop, or mobile surface needs more than code-level correctness: visual hierarchy, density, responsive behavior, interaction states, accessibility presentation, and design-system consistency must be inspected in a rendered product state.

This is not a pixel-police playbook and not a license for subjective redesign. It turns visual/product quality into an evidence matrix that can catch interfaces which technically work but are confusing, brittle, inconsistent, or visibly unfinished.

## Quality contract

Use this loop:

`real route/state -> representative data/content pressure -> viewport/input matrix -> rendered inspection -> evidence-backed finding -> smallest coherent fix -> rendered re-check -> focused regression -> baseline/cleanup`

Visual QA should answer two different questions:

1. **Does the interface communicate and behave correctly for the user?**
2. **Is the implementation visually coherent across the realistic states in which that contract can fail?**

A screenshot can support both questions, but it is not sufficient by itself.

## Inspect the real product surface

Prefer the actual route, shell, data wiring, permissions, and component tree over a detached mock. A component sandbox is useful for isolated states, but it cannot prove navigation, layout composition, authorization, real content, or end-to-end state behavior.

For each reviewed surface record:

- route/screen/component identity;
- user goal and primary action;
- source build/commit when evidence can drift;
- data source or representative fixture;
- theme/appearance when variants exist;
- viewport class and effective content width;
- input mode when interaction differs;
- product state such as loading, empty, error, populated, disabled, offline, partial, or success.

Do not claim the product surface is visually verified when only source code or a detached component was inspected.

## Visual hierarchy and attention budget

A coherent interface makes importance legible before the user reads every label.

Inspect:

- whether page/screen context is immediately identifiable;
- whether one primary action dominates appropriately;
- whether secondary and destructive actions are visually distinct;
- whether status, warning, and error emphasis matches consequence;
- whether headers, sections, cards, tables, and controls form a clear reading order;
- whether decoration competes with task-critical information;
- whether too many simultaneous accents create visual noise.

Common defects include:

- every button using primary emphasis;
- oversized headers consuming task space;
- important status hidden in low-contrast metadata;
- destructive controls adjacent to primary actions with equal treatment;
- card grids with no meaningful grouping;
- excessive borders, shadows, badges, gradients, or icons that flatten hierarchy rather than improve it.

Do not equate “more visual treatment” with “more polished.” Restraint is often the stronger design decision.

## Spacing, alignment, density, and rhythm

Review layout as a system rather than one screenshot crop.

Look for:

- consistent page gutters and section spacing;
- shared baselines and edge alignment;
- predictable spacing between labels, controls, helper text, and validation;
- table/list density appropriate to task frequency and information volume;
- line length and wrapping that preserve scanability;
- whitespace that groups information rather than producing unexplained holes;
- repeated components using the same padding, radius, border, elevation, and icon geometry.

A one-off two-pixel difference is rarely a product defect. Repeated drift that makes comparable surfaces feel unrelated is.

Prefer existing tokens and layout primitives. If the product lacks them and the defect repeats, introduce the smallest reusable convention that removes the inconsistency.

## Typography and color roles

Typography and color should encode hierarchy and state, not decorate arbitrary elements.

Check:

- heading/body/label/helper/code/numeric roles;
- readable size, weight, line height, and line length;
- muted text that remains legible;
- status colors with text/icon/shape support rather than color alone;
- consistent link and interactive affordances;
- focus and selection visibility;
- theme-specific contrast in light/dark/high-contrast modes when supported.

Do not introduce new font families, arbitrary weights, or bespoke colors when existing tokens already express the role.

## Content pressure is part of visual correctness

Interfaces that look good with ideal demo text often fail in production.

Review representative pressure cases such as:

- empty/zero items;
- one item versus many items;
- long names, titles, emails, identifiers, paths, URLs, and unbroken tokens;
- long translated strings or locale formatting;
- large numeric values, negative values, percentages, and dates;
- optional fields absent;
- images/avatars missing or slow;
- permission-restricted or partially available data;
- validation/helper/error text appearing together;
- user-generated content at realistic limits.

Decide intentionally whether content wraps, truncates, scrolls, expands, collapses, or moves to another layout. Do not let CSS accidents choose the policy.

## Viewport and responsive matrix

A single desktop screenshot is weak evidence for a responsive product.

Choose viewport classes from the product and changed surface, not from fashionable device names. Record enough cases to falsify the layout contract, for example:

- narrow phone or compact window;
- medium/tablet or split-view width;
- ordinary desktop;
- wide desktop where line length/density can become awkward.

Also consider browser zoom, text scaling, virtual keyboard, safe areas, display density, and host-window chrome when they materially affect the surface.

At each relevant transition inspect:

- navigation and persistent context;
- primary action reachability;
- table/list/detail transformation;
- dialogs/drawers/popovers;
- sticky/fixed elements;
- overflow and horizontal scrolling;
- clipped labels/icons;
- content reordering and reading order;
- minimum touch/control sizes.

Do not add arbitrary breakpoints merely to make one screenshot pass. Fix the component/layout constraint that causes the pressure failure.

## State matrix

Visual QA must cover more than the populated happy path.

Select the states that can materially change layout, meaning, or action availability:

- initial/loading/skeleton;
- empty/first-use;
- populated/normal;
- validation error;
- permission denied or limited access;
- network/server error;
- offline/retrying;
- disabled/read-only;
- submitting/processing;
- success/confirmation;
- partial success/conflict/stale data when the domain supports them.

Not every surface needs every state. The engineer should declare relevant states and prove each declared state was inspected, rather than silently omitting inconvenient cases.

## Interaction quality

Static appearance is only part of the product.

Inspect material controls in:

`rest -> hover -> focus -> pressed -> disabled -> loading/submitting -> success/error`

Check:

- clear affordance before interaction;
- visible keyboard focus;
- feedback close to the action;
- prevention of duplicate destructive or expensive submissions;
- stable layout while labels/spinners/status change;
- menus/popovers/tooltips staying within usable bounds;
- dialogs opening with sensible focus and closing/restoring focus correctly;
- touch/pointer/keyboard paths preserving the same product semantics.

Animations and transitions should clarify change. Excess motion, delayed feedback, or decorative animation that hides state is a quality defect.

## Accessibility presentation

Accessibility is not separate from visual quality.

Coordinate with `accessibility-product-engineering.md` for normative semantics. During visual QA inspect:

- visible/unobscured focus;
- contrast and non-color state cues;
- zoom/text scaling without clipping or lost actions;
- error placement and identification;
- reading/visual order alignment;
- target size and spacing;
- reduced-motion behavior when motion is material;
- screen-reader-visible state changes paired with understandable visual feedback.

A design that only works at default font size or with a mouse is not visually complete.

## Design-system consistency

Compare the changed surface with the nearest established product patterns, not an abstract design trend.

Check whether comparable elements use the same:

- tokens;
- typography roles;
- spacing scale;
- control variants;
- icon set and sizing;
- field/error/help patterns;
- table/list/card conventions;
- empty-state language;
- modal/drawer behavior;
- loading skeleton/spinner convention.

If the existing pattern is itself harmful or inaccessible, fix the shared owner rather than copying the defect into another screen.

## Before/after evidence

For an existing surface, capture enough evidence to explain the defect and prove the correction. This can be screenshots, browser snapshots, recordings, DOM/accessibility inspection, or another stable rendered artifact.

A useful before/after record states:

- exact route/state/fixture;
- viewport/input/theme;
- defect and user impact;
- changed design rule or component owner;
- visible postcondition;
- any intentional visual differences outside the immediate target.

For a new surface there may be no “before” screenshot. Use the intended design contract or comparable product pattern as the baseline and state that explicitly.

Do not update a visual baseline merely because a diff exists. First classify the diff as intended, regression, environment noise, or stale baseline.

## Visual regression automation

Screenshot or image-diff tests are useful when:

- the surface is deterministic enough to render repeatably;
- visual drift has meaningful regression risk;
- fonts/assets/animations/timestamps/data can be stabilized;
- the baseline has an owner and review discipline.

Control common noise:

- freeze or mask time/random IDs where appropriate;
- wait for intended fonts/assets/data, not arbitrary sleeps;
- disable or settle nonessential animation;
- use stable fixtures;
- keep browser/viewport/device-scale inputs explicit;
- avoid masking the exact region whose behavior matters.

A pixel diff is evidence, not the product contract. Pair visual regression with semantic interaction/accessibility checks and real state wiring.

## Triage visual diffs

Classify each meaningful diff:

- **intended improvement**: matches acceptance criteria;
- **regression**: breaks hierarchy, layout, content, interaction, accessibility, or consistency;
- **environmental noise**: rendering/font/animation/data instability that should be stabilized;
- **baseline debt**: accepted behavior changed earlier without a reviewed baseline update;
- **unknown**: requires a discriminator before approval.

Do not approve hundreds of changed pixels as a batch without understanding the shared cause.

## Evidence matrix

For meaningful visual work, keep a compact matrix that makes omissions obvious:

`surface + viewport + state + content case + input/theme -> evidence -> finding -> acceptance result`

The matrix does not need the Cartesian product of every possible dimension. Choose the combinations most likely to break the design contract, then make those choices explicit.

Use `scripts/visual_quality_gate.py` when a structured visual-QA manifest helps enforce this evidence discipline.

## Completion claims

Use evidence-aware language:

- **implemented**: visual changes exist in source;
- **focused-validated**: component/interaction tests pass;
- **rendered-validated**: representative real surfaces/states were rendered and inspected;
- **visual-regression-validated**: reviewed stable visual baselines/diffs pass;
- **end-to-end-validated**: rendered interaction and real data/auth/state path pass together.

If rendering/browser execution is unavailable, do not claim rendered or visual-regression validation. Record the evidence boundary instead.

## Boundaries

- Do not redesign by personal taste alone.
- Do not replace real interaction/accessibility tests with screenshots.
- Do not treat pixel identity as usability correctness.
- Do not hide overflow or content-pressure failures by masking them in visual tests.
- Do not approve visual baseline churn without understanding the diff.
- Do not fabricate rendered evidence when no browser/device execution was available.
- Do not change brand identity or product policy merely to make a screen look different.
