# Frontend product patterns

Use this for UI/UX design and frontend implementation. Treat interface design as part of full-stack product engineering, not as decoration added after the code works.

## Contents

- Decide whether design work is required
- Recover product intent and existing design language
- Information architecture and user flows
- Wireframes and layout
- Visual system and hierarchy
- Interaction and state design
- Responsive and adaptive behavior
- Design-system and component contract
- Design-to-code execution
- Visual and browser validation
- State classes and owners
- Forms and data entry
- Effects and lifecycle
- Async freshness
- Optimistic UI
- Error/loading state machines
- Accessibility
- Performance
- Testing
- Mature references

## Decide whether design work is required

Do not force a design ceremony onto every frontend edit.

- For a tiny bug or local consistency fix, preserve the established component, spacing, typography, interaction, and responsive conventions unless those conventions are the defect.
- For a meaningful new screen, workflow, navigation change, dashboard, onboarding flow, redesign, or visually important feature, establish the experience before writing final UI code.
- When the request is ambiguous but the repository already has a coherent design system, infer ordinary implementation details from that system instead of asking the user to choose pixels, component names, or breakpoints.
- When a user-visible product decision materially changes hierarchy, workflow, privacy, money, destructive actions, or accessibility, treat it as a product decision rather than a styling detail.

A useful UI contract is:

`user goal -> entry point -> information hierarchy -> interaction -> state transition -> feedback -> recovery -> completion`

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

When product or competitor observations are available, separate observed facts from design inference. Reuse interaction principles and useful patterns; do not blindly copy accidental pixels, proprietary assets, branding, or hidden implementation assumptions.

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

## Visual system and hierarchy

Use visual choices to communicate importance, grouping, status, and affordance.

Prefer a small coherent system over many one-off values:

- typography scale with clear heading/body/label roles;
- spacing rhythm rather than arbitrary gaps;
- restrained color roles for surfaces, text, borders, emphasis, status, and actions;
- consistent corner radius, border, and elevation semantics;
- icons that reinforce meaning instead of replacing necessary labels;
- motion that communicates state change rather than decorative movement.

Do not use color alone to communicate critical state. Preserve readable contrast and avoid dense decorative chrome that competes with primary content.

## Interaction and state design

Design interactive states before implementation hides them behind happy-path styling.

For each material control or workflow, consider the reachable states that matter:

`rest -> hover/focus -> active -> validating -> submitting -> accepted -> processing -> succeeded`

Exceptional states may include:

`empty`, `disabled`, `validation-error`, `unauthorized`, `conflict`, `rate-limited`, `offline`, `retrying`, `partial-success`, `terminal-failure`, `stale`.

Specify feedback close to the action that caused it. Keep destructive actions visually and interactionally distinct. Avoid optimistic UI unless rollback/reconciliation is understood.

Keyboard, pointer, touch, and assistive-technology behavior should describe the same product state even when the mechanics differ.

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

## Design-to-code execution

When implementation is requested, do not stop at mockups, prose, or a static image.

Carry the design into the active frontend architecture:

`product intent -> flow/hierarchy -> component contract -> client/server state -> implementation -> rendered verification`

Keep design intent visible in acceptance criteria. Examples include:

- the primary action is visible without competing actions of equal emphasis;
- destructive actions require the intended confirmation boundary;
- empty/error/loading states preserve layout and explain the next action;
- the layout remains usable at agreed viewport classes;
- keyboard focus order matches visual/task order;
- implementation reuses the product's real tokens/components where appropriate.

Do not make a visually complete fake surface that is disconnected from real data, authorization, loading, error, or mutation behavior when the requested feature is meant to work end-to-end.

## Visual and browser validation

For meaningful UI work, visible verification is part of completion.

When browser execution is available:

- render the actual changed route/state, not a detached demo unless the product architecture requires one;
- capture representative viewport evidence;
- inspect overflow, clipping, unintended wrapping, density, alignment, and visual hierarchy;
- exercise hover/focus/disabled/loading/error/empty states that materially affect the design;
- verify keyboard flow and accessible names for critical interactions;
- compare the rendered result against the design intent, not merely against a pixel snapshot;
- re-check responsive behavior after implementation changes component structure or content length.

Use visual diffs as evidence of change, not as the sole oracle. A pixel-identical interface can still be unusable or inaccessible, and a legitimate responsive/rendering change can intentionally move pixels.

## State classes and owners

Classify state before adding another store.

Typical classes:

- local ephemeral UI state: open/closed, draft input, focus;
- URL/navigation state: route, query, selected resource when shareable;
- server state: data whose source of truth is remote;
- durable local state: preferences/offline drafts/browser storage;
- runtime state: connection/worker/WebContents/permission lifecycle;
- derived state: values computable from authoritative state.

Do not copy server state into a second client store without a reconciliation contract. Do not persist derived state merely to avoid recomputation unless performance evidence justifies it.

## Forms and data entry

Treat meaningful forms, settings editors, wizards, and autosave surfaces as product state machines rather than collections of inputs.

Keep editable draft, authoritative validation, and durably persisted state distinct. A useful contract is:

`editing representation -> parse/normalize -> client guidance -> authorized server/domain validation and mutation -> persisted state -> visible completion or preserved recovery state`

Editing text may be temporarily incomplete or non-canonical. Do not normalize every keystroke when doing so moves the caret, breaks IME composition, or destroys a value the user is still forming. Client validation is guidance; permissions, uniqueness, quotas, cross-record invariants, and current product policy remain server/domain authority. Bind async validation to the subject plus candidate/draft generation so a stale response cannot overwrite newer input.

Define dirty state relative to a stable baseline, not merely component activity. Defaults hydrating or formatting changing should not create false unsaved-change warnings. Advance the baseline only when the persistence contract proves the save outcome. If drafts survive navigation, reload, restart, or devices, define their identity, storage owner, privacy/retention boundary, schema version, conflict policy, and cleanup rather than silently upgrading ephemeral input into durable data.

Autosave is a distributed write flow. Debounce controls request frequency; it does not establish write ordering or durability. Use stable object/draft identity and a generation or version where stale saves can complete late; make retries/idempotency explicit when effects are not naturally idempotent; never let save N visually confirm or overwrite draft N+1. After timeout-after-commit, reconcile authoritative state before retrying or clearing dirty state.

Disabling a submit button can reduce accidental double clicks. It does not make a non-idempotent server mutation safe. Model duplicate submit, accepted-versus-durable completion, cancellation, retry, and unknown outcome at the mutation owner. After an ambiguous timeout, reconcile before blindly repeating an irreversible action.

Conditional fields need data semantics: decide whether hidden values remain in draft, are cleared, or are excluded from submission. Disabled, read-only, or hidden presentation is never an authorization boundary; the trusted server still validates and authorizes client-controlled values. Use stable semantic identity for repeated rows when add/remove/reorder can overlap validation or persistence.

When another actor or device can change the same object, choose an explicit conflict policy such as optimistic version check, merge/review, or a documented last-write-wins rule. Do not silently overwrite newer authoritative data because a local draft still passes client validation.

Locale, IME composition, autofill, password managers, pasted content, and mobile keyboard behavior are correctness inputs when relevant. Keep display formatting separate from canonical values, and do not disable paste/autofill/zoom without a concrete product or security reason.

Schema evolution includes old clients and durable drafts. Consider removed/renamed fields, absent-field defaults, queued/offline submissions, changed conditional meaning, and server-error formats consumed by older UIs. Migrate or invalidate stale drafts explicitly when their meaning changed materially.

For material data-entry work, validate representative prefilled/empty states, client and server validation errors, duplicate submit, stale async validation, slow/failing saves, timeout-after-success, unsaved navigation, autosave ordering, conflict/recovery, keyboard/focus/error association, long/localized content, and compact/mobile layouts. Do not add a form-specific gate merely to restate these prose rules; add deterministic validation only when the repository has a fragile machine-checkable invariant.

## Effects and lifecycle

Treat effects as synchronization with an external system, not as a general place to calculate state.

For each effect/subscription/timer:

- identify the external owner;
- define setup cardinality;
- return symmetric cleanup;
- include the inputs that change the subscription identity;
- suppress commits from stale async work;
- test remount/reopen/navigation replacement.

React's current guidance frames effects as synchronization with external systems and requires cleanup for external connections:
https://react.dev/reference/react/useEffect

## Async freshness

A stale response can be correct for the request that produced it and still be wrong for the current UI.

Use a request/version/generation token when identity can change during async work.

Bad guard:

`currentAccountId === requestedAccountId`

Possible failure:

`A request starts -> switch A to B -> switch B to A -> old A response commits`

Prefer monotonic request/owner generation plus the semantic resource key.

## Optimistic UI

Only use optimistic mutation when the user experience benefit is real and the failure model is defined.

Before updating optimistically, decide:

- what is the authoritative mutation;
- whether duplicate submissions are safe;
- what previous state is needed for rollback;
- whether an invalidation/refetch can reconcile;
- what happens when another concurrent update wins;
- whether the optimistic state leaks authorization or availability assumptions.

TanStack Query's optimistic-update guidance is a useful implementation reference because it explicitly plans rollback/refetch on failure:
https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates

## Error/loading state machines

Avoid one boolean when the product can distinguish meaningful states.

Common states:

`idle -> validating -> submitting -> accepted -> processing -> succeeded`

Exceptional states may include:

`validation-error`, `unauthorized`, `conflict`, `rate-limited`, `offline`, `retrying`, `partial-success`, `terminal-failure`, `stale`.

A spinner without a terminal state is a bug magnet.

## Accessibility

Use native semantic controls first.

Minimum engineering checks for interactive product UI:

- keyboard operation;
- no keyboard trap;
- visible/unobscured focus;
- accessible name that matches visible label intent;
- programmatic labels for inputs;
- text error identification and instructions;
- sensible focus movement for dialogs/navigation;
- status updates exposed appropriately when asynchronous actions finish.

WCAG 2.2 is the normative reference:
https://www.w3.org/TR/WCAG22/

## Performance

Measure user-visible work rather than optimizing component counts by instinct.

Separate:

- initial load/bootstrap;
- interaction latency;
- network/server latency;
- long task/main-thread blocking;
- memory growth;
- list/render scale;
- duplicate requests/effects;
- background work.

Do not memoize everything. Fix the dominant measured owner.

For web performance, use current Core Web Vitals guidance when it applies:
https://web.dev/articles/vitals

## Testing

Prefer tests that resemble real user interaction.

Use accessible roles/names for selectors where possible; this both reduces implementation coupling and exposes missing accessibility semantics.

Testing Library's query priority is a useful default:
https://testing-library.com/docs/queries/about/

For browser E2E:

- assert the visible postcondition;
- use fresh semantic locators;
- avoid arbitrary sleep;
- exercise back/forward/reload where routing/state matters;
- exercise slow/failing API responses;
- test duplicate submit/disabled states;
- test keyboard paths for critical UI.

## Mature references

- React useEffect: https://react.dev/reference/react/useEffect
- React state guidance: https://react.dev/learn/managing-state
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Testing Library queries: https://testing-library.com/docs/queries/about/
- Playwright best practices: https://playwright.dev/docs/best-practices
- TanStack Query optimistic updates: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
