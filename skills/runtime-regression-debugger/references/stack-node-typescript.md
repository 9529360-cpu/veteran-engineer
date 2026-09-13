# Node.js and TypeScript backend playbook

## Contents

- Recover runtime and framework truth
- Keep request and domain boundaries explicit
- Manage async cancellation, timeouts, and context
- Treat event-loop pressure and concurrency as resources
- Validate schema at trust boundaries
- Make shutdown and resource ownership explicit
- Observe without leaking context
- Test real lifecycle and failure behavior

## Recover runtime and framework truth

Inspect before editing:

- exact Node.js version/runtime image;
- package manager and lockfile;
- TypeScript configuration and module mode;
- actual server framework and active entrypoint;
- process model: single process, cluster, worker threads, serverless, containers;
- DB/client pool owners;
- queue/consumer processes;
- repository-native test/build/typecheck scripts.

Do not assume CommonJS/ESM, fetch availability, module resolution, test runner, or framework defaults from memory. Confirm repository and deployed runtime truth.

Node.js current docs: https://nodejs.org/docs/latest/api/

## Keep request and domain boundaries explicit

Separate:

- transport parsing/serialization;
- authentication/authorization;
- schema validation;
- domain invariants;
- transaction/persistence;
- external adapters;
- async publication;
- response/error mapping.

Do not scatter business authorization across route handlers and ORM callbacks if a stable policy boundary exists.

Prefer typed internal contracts, but remember TypeScript types disappear at runtime. Validate untrusted network, queue, file, config, and persistence inputs where corruption or privilege escalation matters.

## Manage async cancellation, timeouts, and context

Every outbound dependency should have an intentional time budget. Carry cancellation/abort signals across internal boundaries when the underlying API supports meaningful cancellation.

Do not add retries around a non-idempotent operation before deciding whether replay is safe.

Use request context for correlation/tenant metadata only when ownership is clear. Node's `AsyncLocalStorage` is the standard runtime primitive for asynchronous context propagation; avoid hand-rolled global mutable context.

Current reference: https://nodejs.org/api/async_context.html

## Treat event-loop pressure and concurrency as resources

Node is not infinitely concurrent.

Measure before tuning:

- event-loop delay/utilization;
- CPU hot paths;
- heap/allocation growth;
- file/socket handles;
- DB connection pool saturation;
- outbound dependency concurrency;
- queue lag.

CPU-heavy work can starve request handling. Consider worker threads/process isolation only when profiling proves CPU work is material and the communication/lifecycle cost is justified.

Bound promise fan-out. `Promise.all` over an unbounded dataset can overload DB pools, memory, sockets, and downstream APIs even if each individual call is async.

## Validate schema at trust boundaries

Use the repository's established runtime validation mechanism where available.

Validate:

- HTTP body/query/path inputs;
- webhook payload/version/signature metadata;
- queue/event envelopes;
- environment/config at startup;
- external API responses when provider drift can cause unsafe behavior.

Normalize failures into stable application errors. Do not leak raw library exceptions or stack traces to untrusted callers.

## Make shutdown and resource ownership explicit

For servers/workers in containers or orchestrators:

1. stop accepting new work or become unready;
2. allow bounded in-flight work to complete/cancel;
3. stop polling/claiming new jobs;
4. flush/close telemetry as supported;
5. close DB/cache/network clients;
6. exit within platform grace period.

Register lifecycle handlers once at the real process owner. Avoid arbitrary sleeps as shutdown coordination.

Keep timers, listeners, sockets, browser sessions, workers, and pools paired with cleanup. Repeated restart/reload tests can expose lifecycle leaks that unit tests miss.

## Observe without leaking context

Use structured logs/traces/metrics with stable request/job correlation.

Do not put secrets, tokens, raw request bodies, or sensitive user content into `AsyncLocalStorage`, logs, trace baggage, or metric labels merely because propagation is convenient.

Node also exposes diagnostics facilities; prefer supported runtime instrumentation over invasive monkey patches where feasible.

Reference: https://nodejs.org/api/diagnostics_channel.html

## Test real lifecycle and failure behavior

Test with the real framework/server process when semantics matter:

- graceful shutdown during requests/jobs;
- aborted client request;
- dependency timeout/429/5xx;
- DB pool exhaustion;
- duplicate idempotency key;
- queue redelivery;
- malformed runtime input despite correct TypeScript types;
- ESM/CJS/build artifact behavior in production mode;
- source maps/error reporting in packaged output.

For framework-specific APIs such as Express/Fastify/Nest/Hono, consult the exact current framework docs and repository conventions instead of forcing one architecture pattern onto all of them.
