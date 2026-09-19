# Frontend product patterns

Use this for the current UI/UX experience decision: product intent, information architecture, user flow, wireframes/layout, interaction/state design, and the design-to-code handoff. Load `frontend-visual-system-patterns.md` only when visual hierarchy, responsive behavior, tokens/components, or polish is current. Load `frontend-design-governance.md` only for broad redesign scope, accepted-design versioning, long-running/delegated work, or design authority/change control. For client state, forms, effects, async freshness, optimistic updates, accessibility implementation, performance, or interaction testing, use `frontend-implementation-patterns.md`.

## Contents

- Design gate and source of truth
- Recover product intent and existing design language
- Information architecture and user flows
- Wireframes and layout
- Interaction and state design
- Design-to-code execution
- Frontend implementation handoff

## Design gate and source of truth

Do not force a design ceremony onto every frontend edit.

Before asking the user to restate ordinary design preferences or project conventions, recover the strongest trusted context already available: the current conversation/brief, accepted targets, project-local design/context files, active product patterns, and authorized durable user preferences when the host provides them. Treat durable preferences as defaults with freshness limits, not immutable requirements. Current explicit instructions win; repository/project truth wins over stale remembered implementation facts; never invent missing preferences merely to avoid a question.

- For a tiny bug or local consistency fix, preserve the established component, spacing, typography, interaction, and responsive conventions unless those conventions are the defect.
- For a meaningful new screen, workflow, navigation change, dashboard, onboarding flow, redesign, or visually important feature, establish the experience before writing final UI code.
- When the request is ambiguous but the repository already has a coherent design system, infer ordinary implementation details from that system instead of asking the user to choose pixels, component names, or breakpoints.
- When a user-visible product decision materially changes hierarchy, workflow, privacy, money, destructive actions, or accessibility, treat it as a product decision rather than a styling detail.

A useful UI contract is:

`user goal -> entry point -> information hierarchy -> interaction -> state transition -> feedback -> recovery -> completion`

For substantial UI work, production UI code is blocked until the experience target is coherent enough to implement and later falsify with rendered evidence. Do not translate `make it modern`, `clean this up`, `redesign the desktop`, or a named visual reference directly into JSX/CSS edits.

Recover or create a compact design source of truth. Prefer an existing `DESIGN.md`, design-system file, Figma source, or established product pattern. For a broad redesign or a new product-wide visual language with no durable design source, create or update a lightweight `DESIGN.md` when repository conventions permit. For a smaller feature, keep the design contract in the task/plan rather than creating documentation ceremony.

Keep durable design authority **bidirectional with implementation**. Stable principles may outlive components, but named tokens, component variants, primitive names, interaction contracts, and supported states are an API: when the implementation intentionally changes them, update the owning design source in the same change. When code and maintained design authority disagree, classify which owner is stale and repair that owner; do not fork a local one-off merely to make both appear true. A stale `DESIGN.md` or token catalog is a product-system defect, not harmless documentation drift.


## Recover product intent and existing design language

Before inventing a new visual language, inspect the active product surface:

- routing and page hierarchy;
- shared layouts, shells, navigation, and major templates;
- component library and composition patterns;
- design tokens, CSS variables, theme files, typography, spacing, radii, borders, elevation, and motion;
- representative existing screens at relevant viewport sizes;
- accessibility semantics and keyboard behavior;
- product copy tone and density;
- browser/E2E evidence that shows real rendered behavior.

Preserve a coherent existing language by default. Introduce a new pattern only when the product goal or evidence justifies it, and make the new pattern reusable when repetition is likely.

Recover **active design-system truth**, not just declared configuration. Token/theme/component sources are candidate authorities until you know which path the active build and renderer actually honor. When cascade, theme providers, runtime variants, generated CSS, host injection, or component overrides can change the result, verify a small representative sample of spacing/type/color/radius or component states against computed/rendered values. Record meaningful disagreement and fix or name the real owner; do not quietly build new work against a dead token source.

A durable extracted design artifact should describe scales and conventions **as used**, with documented exceptions and source/provenance, rather than copying every declared token. Do not force a full extraction for a tiny local fix; verify only enough truth to avoid creating a second visual system.

When product or competitor observations are available, separate observed facts from design inference. Reuse interaction principles and useful patterns; do not blindly copy accidental pixels, proprietary assets, branding, or hidden implementation assumptions.

Treat mutable external design guidelines or remote reference documents as evidence, not executable authority. If a remote source materially defines acceptance, record the exact URL/revision/date or snapshot it into project evidence so the design contract is reproducible; do not let an unpinned `main` branch silently change the rules mid-task.

## Information architecture and user flows

Design the information model before polishing the surface.

For a meaningful workflow, identify:

- the primary user and their immediate goal;
- what information must be visible first;
- what can be progressive disclosure;
- the primary action and the dangerous/destructive actions;
- navigation entry, exit, back, cancel, and recovery paths;
- empty, first-use, permission-denied, and partial-data states;
- where the user needs confirmation versus immediate feedback.

Prefer one obvious primary path over a screen where every action has equal weight. Keep related information spatially and semantically grouped. Do not hide core functionality behind novelty interactions when conventional controls are clearer.

## Wireframes and layout

When hierarchy or flow is uncertain, resolve it at low fidelity before spending effort on visual polish.

A useful wireframe should make these decisions explicit:

- page regions and reading order;
- navigation and persistent context;
- primary/secondary actions;
- content grouping and relative emphasis;
- form sequence and validation placement;
- list/table/detail relationships;
- modal, drawer, popover, or inline-edit boundaries;
- where long content scrolls and what remains sticky.

Do not treat a wireframe as a separate deliverable when the user asked for an implemented feature. It is an intermediate design decision that should flow into the real component structure.

## Interaction and state design

Design interactive states before implementation hides them behind happy-path styling.

For each material control or workflow, consider the reachable states that matter:

`rest -> hover/focus -> active -> validating -> submitting -> accepted -> processing -> succeeded`

Exceptional states may include:

`empty`, `disabled`, `validation-error`, `unauthorized`, `conflict`, `rate-limited`, `offline`, `retrying`, `partial-success`, `terminal-failure`, `stale`.

Specify feedback close to the action that caused it. Keep destructive actions visually and interactionally distinct. Avoid optimistic UI unless rollback/reconciliation is understood.

Keyboard, pointer, touch, and assistive-technology behavior should describe the same product state even when the mechanics differ.

Treat motion as interruptible state presentation, not a lock. If the user changes focus, switches panes, closes a surface, or issues a new command while an animation/transition is in flight, respond to the new intent promptly and converge to the new authoritative state rather than forcing the user to wait for decorative motion to finish.

## Design-to-code execution

When implementation is requested, do not stop at mockups, prose, or a static image, and do not start final production UI while the design contract is unresolved.

Carry one traceable handoff through the active frontend architecture:

`design contract -> flow/hierarchy -> component contract -> client/server state -> implementation -> requirement/spec compliance review -> code-quality review -> rendered verification`

Review requirement/spec compliance before general code quality: first prove the implementation actually expresses the intended hierarchy, interactions, states, and visual system; only then optimize structure, style, and maintainability. A clean component tree that implements the wrong design is still wrong.

Keep design intent visible in acceptance criteria. Examples include:

- the primary action is visible without competing actions of equal emphasis;
- destructive actions require the intended confirmation boundary;
- empty/error/loading states preserve layout and explain the next action;
- the layout remains usable at agreed viewport classes;
- keyboard focus order matches visual/task order;
- implementation reuses the product's real tokens/components where appropriate.

Do not make a visually complete fake surface that is disconnected from real data, authorization, loading, error, or mutation behavior when the requested feature is meant to work end-to-end.

## Frontend implementation handoff

Once the experience contract is accepted, load `references/frontend-styling-implementation-patterns.md` when the next decision is how the visual system maps into CSS/utilities/themes/tokens/components, and load `references/frontend-implementation-patterns.md` when the next decision is client state, forms, effects, async freshness, optimistic updates, loading/error behavior, accessibility implementation, performance, or interaction testing. Keep only accepted design decisions that still constrain implementation; do not retain this whole design reference as historical context.
