# React and Next.js engineering playbook

## Contents

- Confirm router/runtime/version before assuming semantics
- Model UI state deliberately
- Separate server, client, and durable state
- Treat effects as synchronization
- Handle async races and optimistic updates
- Design Next.js boundaries from data and trust
- Treat caching/revalidation as correctness
- Validate accessibility and user-visible behavior
- Measure real frontend performance
- Testing and rollout

## Confirm router/runtime/version before assuming semantics

Before changing a React/Next.js application, inspect:

- exact React and Next.js versions from the lockfile/runtime;
- App Router versus Pages Router, or mixed migration state;
- server/client component boundaries;
- route handlers/server actions/API services actually in use;
- deployment target and runtime constraints;
- data/cache library such as TanStack Query/SWR/Apollo;
- authentication/session owner;
- bundler/build configuration and repository-native commands.

Next.js behavior around caching, rendering, routing, and server/client boundaries changes over time. Use current official docs for the exact deployed version rather than relying on remembered defaults.

Current documentation index: https://nextjs.org/docs
React documentation: https://react.dev/

## Model UI state deliberately

Classify state before adding a hook/store:

- ephemeral component interaction state;
- URL/navigation state;
- form state;
- server-owned resource state;
- optimistic/pending mutation state;
- durable browser state;
- auth/session state;
- remote runtime state.

Do not mirror server data into local state without a reconciliation reason. Avoid storing derivable values merely to keep two copies synchronized.

React ties component state to identity/position in the render tree. Be deliberate with keys and conditional structure when identity must reset or persist.

Reference: https://react.dev/learn/preserving-and-resetting-state

## Separate server, client, and durable state

For each fact, name one authority.

Examples:

- DB/service owns persisted entity state;
- query/cache library owns remote fetch freshness in the client;
- URL owns shareable navigation/filter state when appropriate;
- component owns temporary disclosure/input state;
- auth/session subsystem owns authenticated identity.

Do not make a client store the authoritative copy of a server resource because prop flow feels inconvenient.

When server-rendered and client-hydrated views can disagree, define which version wins and how stale data is reconciled.

## Treat effects as synchronization

Use effects to synchronize React with systems outside React: subscriptions, browser APIs, timers, imperative widgets, network mechanisms not already owned by a data layer.

For every effect verify:

- setup/cleanup symmetry;
- dependency correctness;
- repeated setup safety;
- unmount/navigation behavior;
- stale async result suppression;
- ownership of subscriptions/timers/resources.

Do not use an effect merely to derive render state that can be computed during render or handled by the event that caused the change.

## Handle async races and optimistic updates

For UI requests that can overlap, guard commits by request/resource/owner generation or by the data library's cancellation/version mechanism.

Test:

- request A starts, B starts, B returns, A returns late;
- route/tenant/account changes while request is in flight;
- component unmounts before completion;
- duplicate submit/click;
- optimistic mutation fails;
- mutation succeeds but refresh/revalidation is delayed.

Optimistic UI requires an explicit rollback/reconciliation strategy. Do not show durable success before the authoritative boundary succeeded unless the product intentionally models pending state.

## Design Next.js boundaries from data and trust

Choose Server versus Client Component boundaries based on capability and data ownership, not aesthetics.

Keep secrets and privileged credentials on trusted server boundaries. Never assume a module remains server-only merely because current callers happen to be server components; use framework-supported server-only protections where appropriate.

For mutations, trace:

`client action -> framework/server boundary -> authentication -> authorization -> validation -> durable mutation -> revalidation/projection -> visible result`

Do not treat Server Actions, Route Handlers, or API endpoints as implicitly authorized. Validate and authorize the exact operation.

## Treat caching and revalidation as correctness

Caching is a state-consistency feature, not only performance.

For each cache establish:

- key dimensions, including tenant/user/locale/permissions when they affect output;
- freshness requirement;
- read-after-write expectation;
- invalidation/revalidation owner;
- stale/error fallback;
- server/client/CDN layer where the cache actually lives.

When Next.js cache semantics matter, inspect the current version docs because defaults and APIs evolve. Never repair stale data by globally disabling caching before proving the offending cache owner.

## Validate accessibility and user-visible behavior

Critical flows should preserve:

- semantic interactive elements;
- keyboard operation;
- visible focus;
- accessible labels/names;
- error/status announcements;
- logical focus after dialogs/navigation/mutations;
- loading/empty/retryable/terminal/unauthorized states.

Test by role/name and visible postconditions where practical rather than implementation selectors.

## Measure real frontend performance

Do not memoize, lazy-load, virtualize, or split components by instinct.

Measure the relevant path:

- network/server response;
- render/hydration/interaction;
- long tasks/main-thread work;
- bundle/code loading;
- image/font layout behavior;
- field/RUM versus lab results.

Use current Core Web Vitals guidance where relevant. A faster synthetic build is not proof the user interaction improved.

## Testing and rollout

Use the smallest evidence ladder that covers the changed mechanism:

- type/lint/unit for pure logic;
- component tests for interaction states;
- route/API integration for server boundaries;
- browser E2E for critical flows, auth, navigation, reload, and accessibility;
- production-like build/runtime when rendering/caching/bundling differs from dev;
- canary/RUM comparison for high-impact performance changes.

For framework upgrades, separate dependency/runtime migration from unrelated feature work when possible and validate exact built artifacts.

## Mature references

- React managing state: https://react.dev/learn/managing-state
- React preserving/resetting state: https://react.dev/learn/preserving-and-resetting-state
- Next.js documentation: https://nextjs.org/docs
- Playwright best practices: https://playwright.dev/docs/best-practices
- Testing Library queries: https://testing-library.com/docs/queries/about/
