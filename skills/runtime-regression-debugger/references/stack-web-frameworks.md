# Vue, Nuxt, Angular, Svelte, Remix, Astro, and other web framework engineering

Use this playbook when non-React frontend framework evidence is present. Confirm the exact framework/router/rendering mode and deployed adapter before implementation.

## Framework-independent contract

Regardless of framework, map:

`route/navigation -> loader/query -> authorization-visible state -> user action -> mutation -> server authority -> invalidation/revalidation -> visible completion/error`

Keep local UI state, server state, URL state, durable browser state, and remote/runtime state distinct.

## Rendering and routing

- Determine CSR, SSR, SSG/prerender, streaming, server-component/island, or hybrid behavior from the actual repository.
- Do not read browser-only globals during server rendering without a guarded client boundary.
- Treat hydration mismatches as ownership/timing problems, not something to suppress blindly.
- Recover route guards/loaders/middleware and distinguish UX navigation checks from trusted server authorization.

## Reactivity and state

- Understand the framework's dependency tracking and lifecycle semantics before adding watchers/effects/subscriptions.
- Prefer derived state over duplicated writable copies.
- Clean up subscriptions/listeners/timers and suppress stale async results after route/component ownership changes.
- Avoid global stores becoming mutable process-wide authorities for tenant/user state in SSR environments.

## Data fetching and mutations

- Define cache/revalidation semantics explicitly rather than assuming framework defaults match product freshness.
- For optimistic UI, define rollback and server reconciliation first.
- Abort or generation-guard stale requests when route/selection ownership changes.
- Preserve stable machine-readable server errors instead of encoding behavior in rendered copy.

## Accessibility and browser behavior

- Preserve semantic controls, focus management, keyboard operation, accessible names, and validation descriptions.
- Test navigation/history, hard refresh, deep links, slow network, offline/retry behavior where product-relevant.
- Measure bundle/runtime cost before adding broad client-side dependencies.

## Framework migration

For Vue/Nuxt/Angular/Svelte or router/build-system major migrations:

- separate compatibility upgrade from unrelated redesign;
- characterize route/data/error behavior;
- migrate one vertical feature or shell boundary at a time when feasible;
- compare build output, SSR/hydration, asset paths, environment handling, and deployment adapter behavior;
- preserve old/new coexistence where independently cached clients can overlap.
