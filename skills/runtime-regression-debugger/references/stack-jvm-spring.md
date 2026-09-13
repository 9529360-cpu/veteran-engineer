# JVM and Spring service engineering

Use this playbook only when the repository actually contains JVM/Spring evidence. Confirm exact Java/Kotlin, Spring Boot, build-tool, database-driver, and deployment versions before relying on framework behavior.

## Build and repository truth

- Inspect Maven/Gradle modules, dependency management/BOMs, plugins, toolchains, generated sources, profiles, and test source sets.
- Confirm the runtime JDK differs from or matches the build JDK intentionally.
- In multi-module builds, identify which module owns the executable artifact and which publish libraries/contracts.
- Do not upgrade Java, Spring Boot, Gradle/Maven plugins, ORM, and database driver together unless the migration requires it.

## Spring ownership

- Trace request mapping -> filter/security chain -> controller -> application/domain service -> transaction boundary -> repository/client -> event/async side effect.
- Keep transaction boundaries explicit. Do not assume `@Transactional` applies through self-invocation, private methods, or every async boundary.
- Avoid network calls while holding long database transactions.
- Confirm proxy/AOP behavior before diagnosing annotations by appearance.
- Treat bean scope and mutable singleton state carefully; most Spring beans are shared singletons.

## Persistence

- Inspect generated SQL and query plans for JPA/Hibernate paths; clean entity code can hide N+1 and large fetch graphs.
- Define fetch shape deliberately. Avoid blanket eager loading.
- Handle optimistic/pessimistic locking from the business invariant, not as an ORM preference.
- Keep schema migration ownership outside automatic production schema mutation unless repository policy explicitly relies on it.
- Test transaction isolation and retry behavior against the actual database.

## Concurrency and async

- Identify executor ownership, queue bounds, rejection policy, context propagation, and shutdown behavior.
- Do not assume thread-local request/security/transaction context crosses executors or reactive boundaries.
- For Reactor/reactive stacks, verify blocking calls do not execute on latency-sensitive event-loop threads.
- Bound connection pools and worker concurrency against database/downstream capacity.

## Security

- Recover the effective Spring Security filter chain and matcher order from current configuration.
- Authorize the exact resource/action at a trusted boundary; route match alone is rarely enough for object-level policy.
- Confirm CSRF/session/bearer-token behavior from the deployed client model rather than disabling protections to make tests pass.

## Testing and delivery

- Prefer unit tests for deterministic policy, slice/contract tests for framework boundaries, and real integration tests for database/security/serialization behavior.
- Watch test-container or embedded-database semantic differences.
- Validate graceful shutdown, readiness, connection draining, scheduled-job overlap, and migration order in deployment-sensitive services.
- Review JVM memory/container limits, GC behavior, thread counts, pool sizes, and startup/readiness budget when production differs from local development.
