# Frontend product patterns

## Contents

- State classes and owners
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
