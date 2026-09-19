# Frontend implementation patterns

Use this after the experience/design contract is known, or for frontend implementation/debugging that preserves the existing visual world. It owns client state classes, forms/data entry, effects/lifecycle, async freshness, optimistic UI, error/loading state machines, accessibility implementation, user-visible performance, and interaction-oriented testing. It does not redefine product/design intent; use `frontend-product-patterns.md` when the experience itself is changing.

## Contents

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
