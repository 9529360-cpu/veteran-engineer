# .NET and ASP.NET Core engineering

Use this playbook only when .NET project/solution evidence is present. Confirm TargetFramework, SDK pinning, ASP.NET Core, EF Core, hosting model, and deployment runtime before implementation.

## Build and solution truth

- Inspect `.sln`, project references, central package management, `global.json`, target frameworks, build configurations, publish settings, and generated code.
- Distinguish framework-dependent from self-contained/AOT publish behavior when it affects runtime compatibility.
- Avoid mixing target-framework migration, EF major upgrade, hosting change, and product refactor in one opaque change.

## Request and dependency ownership

- Trace middleware order -> routing -> authentication -> authorization -> endpoint/controller -> service -> data/external dependency -> response.
- Middleware order is behavior. Verify the effective pipeline instead of assuming registration names are enough.
- Respect DI lifetimes: singleton, scoped, and transient objects have different concurrency and disposal semantics.
- Never capture request-scoped services in long-lived singletons or background tasks without an explicit scope.

## Async and cancellation

- Keep I/O asynchronous end to end when the dependency supports it; avoid sync-over-async blocking.
- Propagate `CancellationToken` through request-owned I/O where cancellation is semantically safe.
- Treat background work as a hosted/job owner with explicit lifetime, persistence, retry, and shutdown semantics rather than fire-and-forget request tasks.

## EF Core and data

- Inspect generated SQL/query plan for material queries; LINQ readability does not guarantee efficient SQL.
- Bound result sets and avoid accidental client-side materialization.
- Define concurrency tokens/transactions from invariants, not ORM defaults.
- Separate schema migration deployment from large data backfills when operational risk differs.
- Confirm provider-specific behavior against the real database rather than in-memory substitutes.

## Security

- Distinguish authentication scheme, claims transformation, policy authorization, resource-based authorization, antiforgery, and cookie/bearer behavior.
- Do not trust route/tenant IDs without verifying them against authenticated authority.
- Protect Data Protection/key-ring lifecycle when cookies/tokens depend on shared keys across replicas.

## Operations

- Validate Kestrel/reverse-proxy forwarding, scheme/host handling, request limits, graceful shutdown, health/readiness, connection pools, and container limits.
- Treat configuration precedence and environment overrides as runtime behavior.
- Verify trimming/AOT assumptions if enabled; reflection-heavy libraries can fail only in published artifacts.
