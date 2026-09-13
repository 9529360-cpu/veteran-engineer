# Failure memory and recurring engineering antipatterns

## Contents

- Use patterns as probes, not verdicts
- State and ownership failures
- Retry and duplicate-side-effect failures
- Queue and backpressure failures
- Database and transaction failures
- Cache failures
- Distributed coordination and time failures
- API and compatibility failures
- Security and tenancy failures
- Frontend and browser lifecycle failures
- Deployment and migration failures
- Observability failures
- Modernization failures
- Deep production-system failures

## Use patterns as probes, not verdicts

Recurring production failures are useful because the mechanisms repeat across technologies. Do not diagnose by analogy alone. For each suspected pattern, identify the local owner, evidence, and cheapest falsifier.

Use this structure:

`smell -> hidden mechanism -> expected evidence -> discriminator -> repair boundary`

## State and ownership failures

### Two sources of truth

Smell: UI state, cache, database, runtime session, or secondary service can each authoritatively update the same fact.

Expected failure: oscillation, stale overwrite, lost update, hard-to-reproduce reconciliation bugs.

Repair: choose one authority; make other copies projections with explicit freshness/reconciliation.

### Reused identity without generation

Smell: async response or runtime callback is accepted because an ID matches, even though the underlying document/process/session was replaced.

Expected failure: stale work commits into a new owner after navigation, retry, failover, or recreation.

Repair: bind commits to owner identity plus generation/version.

### Hidden mutable singleton

Smell: process-global client/session/cache/config mutated per user/tenant/request.

Expected failure: cross-request contamination, tenant leakage, race-dependent behavior.

Repair: make scope explicit and immutable where possible.

## Retry and duplicate-side-effect failures

### Retry after unknown commit

Smell: client times out after server may have committed, then blindly retries a non-idempotent mutation.

Expected failure: duplicate charge, order, email, job, or external action.

Repair: define scoped idempotency at the authoritative side-effect boundary and store result/replay semantics.

### Retry storm

Smell: every caller retries a failing dependency immediately with identical policy.

Expected failure: outage amplification and slow recovery.

Repair: bounded retries, exponential backoff plus jitter, total attempt budget, admission control, and circuit/load shedding where appropriate.

### "Exactly once" without a user-visible definition

Smell: queue or workflow is described as exactly-once while external side effects are not transactionally coupled.

Expected failure: duplicates or lost effects at boundary failures.

Repair: define what once means at the product boundary; use idempotency, dedupe, outbox/inbox, reconciliation, or transactional mechanisms that actually cover that boundary.

## Queue and backpressure failures

### Unbounded queue

Smell: producers can outrun consumers indefinitely.

Expected failure: memory/storage growth, stale work, retry avalanche, recovery measured in days.

Repair: capacity limits, admission/backpressure, queue-age SLO, concurrency bound, discard/coalesce policy when valid.

### Concurrency increased at the wrong layer

Smell: worker count rises but shared DB/API/lock capacity does not.

Expected failure: lower throughput, connection exhaustion, rate-limit failures.

Repair: bound concurrency by the real bottleneck and measure saturation.

### Poison payload retry loop

Smell: deterministic business/schema error treated as transient.

Expected failure: expensive infinite retries and queue starvation.

Repair: classify failures, bound attempts, quarantine/DLQ, preserve repair context.

## Database and transaction failures

### Network call inside database transaction

Smell: transaction remains open while calling external API, queue, or slow service.

Expected failure: long locks, connection exhaustion, deadlocks, poor tail latency.

Repair: shrink transaction boundary; use durable intent/outbox and explicit compensation when needed.

### Read-modify-write without concurrency control

Smell: application reads value, computes new value, writes it without lock/version/constraint semantics.

Expected failure: lost updates or invariant violations under concurrent writers.

Repair: constraint, atomic statement, version check, locking, or appropriate isolation with replay-safe retry.

### Migration assumes small data

Smell: blocking schema rewrite/backfill runs inline because it is fast on development data.

Expected failure: production lock, replication lag, deploy timeout, table bloat.

Repair: inspect real size/query plan/lock behavior; split schema change from resumable backfill.

### ORM success hides query shape

Smell: clean object traversal triggers N+1 queries, huge joins, or unbounded materialization.

Expected failure: p95/p99 degradation only at realistic cardinality.

Repair: inspect generated SQL/query plan and bounded data shape.

## Cache failures

### Cache as authority

Smell: correctness depends on ephemeral cache state that cannot be reconstructed reliably.

Expected failure: restart/failover corrupts behavior.

Repair: keep durable authority elsewhere unless the cache technology is intentionally the durable store.

### Missing auth/tenant dimension in cache key

Smell: cache key omits principal, tenant, permission version, locale, or other authority dimension.

Expected failure: data leakage or wrong result reuse.

Repair: include every dimension that changes authority or semantics; invalidate on policy change when required.

### Stampede/thundering herd

Smell: many requests recompute the same expired/missing key simultaneously.

Expected failure: dependency spike during expiry or cold start.

Repair: request coalescing, jittered expiry, stale-while-revalidate where valid, bounded regeneration.

## Distributed coordination and time failures

### Distributed lock as a substitute for ownership design

Smell: broad lock added to make races disappear without defining authority or lease failure behavior.

Expected failure: deadlock, lease expiry overlap, unavailable control plane.

Repair: first reduce shared mutation; if lock is necessary, define fencing/version semantics and failure recovery.

### Clock equality assumptions

Smell: correctness depends on wall clocks being identical across machines or time zones.

Expected failure: expiry/order bugs, DST failures, skew-dependent authorization or job behavior.

Repair: use monotonic clocks for durations, server-authoritative timestamps for ordering where possible, and explicit timezone semantics.

### Event order assumed globally

Smell: consumers treat arrival order as causal order across partitions/producers.

Expected failure: stale overwrite or invalid state transitions.

Repair: use per-entity sequence/version, causal contract, or reconciliation.

## API and compatibility failures

### Flag-day contract change

Smell: producer and every consumer must deploy simultaneously.

Expected failure: partial rollout breaks live traffic.

Repair: additive/parallel change, compatibility window, explicit removal phase.

### Database schema used as public API

Smell: external clients depend directly on table/storage representation.

Expected failure: persistence refactors become public breaking changes.

Repair: define resource/domain contract and adapter boundary.

### Error text parsed as protocol

Smell: callers branch on human-readable error strings.

Expected failure: localization or copy change breaks behavior.

Repair: stable machine-readable code/type plus human detail.

## Security and tenancy failures

### UI-only authorization

Smell: hidden button or client route is treated as permission enforcement.

Expected failure: direct API access bypasses policy.

Repair: authorize object/action at a trusted server boundary.

### Tenant ID treated as proof

Smell: client or queued payload supplies tenant ID and downstream code trusts it.

Expected failure: cross-tenant access.

Repair: derive/verify tenant scope from authenticated authority at every protected boundary.

### Secret leaks through observability

Smell: URLs, headers, payloads, environment, or support bundles are logged wholesale.

Expected failure: credentials/PII copied into long-retention telemetry.

Repair: structured allowlist logging and redaction at source.

## Frontend and browser lifecycle failures

### Async stale commit

Smell: older request finishes after a newer selection/navigation and overwrites state.

Repair: request generation/abort semantics and authoritative server-state ownership.

### Effect without symmetric cleanup

Smell: event listener, timer, subscription, observer, worker, or resource is recreated without cleanup.

Expected failure: duplicate work and leaks after rerender/navigation.

Repair: setup/cleanup symmetry and lifecycle tests.

### Optimistic UI without reconciliation

Smell: success is shown before server authority but rollback/conflict behavior is undefined.

Expected failure: UI and durable state diverge.

Repair: define rollback/revalidation/conflict state first.

## Deployment and migration failures

### Build-many instead of build-once-promote

Smell: staging and production rebuild from the same tag separately.

Expected failure: different dependency/toolchain artifacts under one version.

Repair: immutable artifact identity promoted through environments.

### Schema rollback assumed reversible

Smell: application rollback expects old code to understand data already written by new code.

Expected failure: rollback makes incident worse.

Repair: design coexistence and forward-compatible data first; do not equate app rollback with data rollback.

### Mutable release metadata promoted before artifacts

Smell: channel/index points clients to artifact before artifact/manifest is globally valid.

Expected failure: clients discover incomplete release.

Repair: publish immutable artifacts first; mutable discovery metadata last.

## Observability failures

### High-cardinality dimensions without budget

Smell: user IDs, request URLs, arbitrary payload fields become metric labels.

Expected failure: telemetry cost/explosion and privacy risk.

Repair: bounded dimensions; put detailed context in sampled traces/logs when allowed.

### Alert on implementation noise

Smell: every exception pages regardless of user impact.

Expected failure: alert fatigue hides real incidents.

Repair: tie alerts to actionable symptoms, SLO burn, saturation, queue age, or critical state transition failure.

## Modernization failures

### Big-bang rewrite

Smell: years of behavior are replaced before production parity can be measured.

Expected failure: hidden contracts rediscovered after cutover.

Repair: characterize, create seams, migrate vertical capabilities, compare, cut over, retire.

### Permanent dual-write

Smell: old and new systems both remain authoritative because migration never completed.

Expected failure: divergent truth and endless reconciliation.

Repair: define cutover authority, reconciliation period, and removal criterion before dual-write begins.

### Dependency upgrade mixed with behavior change

Smell: framework/runtime major upgrade ships with unrelated product refactor.

Expected failure: regression source becomes ambiguous and rollback difficult.

Repair: separate compatibility upgrade from product behavior where practical.

## Deep production-system failures

### Backup-success illusion

Smell: backup jobs are green, but nobody has restored the full application path within the required RTO/RPO.

Expected failure: restore discovers missing logs/keys/config/dependencies only during a real disaster.

Repair: scheduled timed restore/game-day with application-level invariant validation and measured bottlenecks.

### WAL/binlog retention cliff

Smell: a replica, CDC consumer, or backup archive lags near the source retention window.

Expected failure: one stall falls off recoverable history and turns catch-up into full rebuild or data-loss risk.

Repair: alert on time-to-retention-cliff, preserve checkpoints, and size retention from worst credible recovery lag.

### Connection-recovery stampede

Smell: every client reconnects or retries immediately when a dependency/LB returns.

Expected failure: handshake/socket/CPU/NAT pressure causes a second outage after the first dependency recovered.

Repair: jittered bounded reconnect, staged traffic restore, admission control, and capacity headroom for recovery traffic.

### Timeout stack multiplication

Smell: client, proxy, service mesh, SDK, and application each retry independently.

Expected failure: one logical request fans into an exponential-looking attempt storm and exhausts the recovering dependency.

Repair: assign one end-to-end deadline/retry owner where possible; bound attempts and propagate deadlines.

### GC-flag roulette

Smell: pause or memory incident triggers heap/GC/JIT flag changes before allocation, live-set, RSS, and runtime-version evidence exists.

Expected failure: temporary symptom movement, higher memory, new tail latency, or hidden off-heap leak.

Repair: measure allocation/retention/runtime mechanism first; change one justified control and compare equivalent workloads.

### Cache synchronized expiry

Smell: large hot key set shares the same TTL or deployment-time warmup boundary.

Expected failure: mass miss -> origin overload -> timeout/retry -> more misses.

Repair: TTL jitter, single-flight/coalescing, bounded refresh, stale serving where valid, and origin admission limits.

### Global limiter as global outage dependency

Smell: every request synchronously depends on one globally precise rate-limit store.

Expected failure: limiter-store latency/outage becomes product-wide unavailability.

Repair: decide whether approximate local/regional budgeting plus reconciliation is sufficient; fail open/closed by risk class, not by accident.

### Stream exactly-once overclaim

Smell: stream engine checkpoint semantics are treated as proof that external HTTP/email/payment/database effects occur once.

Expected failure: crash after external effect but before checkpoint causes replay and duplicate side effect.

Repair: stable operation identity plus sink transaction/idempotency/reconciliation at the external authority.

### Watermark means complete

Smell: downstream treats a watermark as proof no earlier event can arrive.

Expected failure: late events corrupt historical windows or financial/usage aggregates silently.

Repair: explicit lateness policy, revisions/retractions, state retention, and user-visible finality semantics.

### Search projection used as authorization authority

Smell: search index visibility determines permission because filtering there is convenient.

Expected failure: stale or mis-indexed ACL data leaks results, counts, snippets, or existence.

Repair: keep authorization authoritative outside eventual search projection or prove the stale-security contract is acceptable.

### Fleet average hides noisy tenant

Smell: platform health uses only global averages.

Expected failure: one tenant/shard/cell hits pool, queue, cache, or query limits while fleet graphs look healthy.

Repair: bounded-cardinality heavy-hitter and per-cell/tenant-class views with fairness/admission controls.

### Full-traffic recovery relapse

Smell: a dependency or region returns and immediately receives 100% traffic/backlog/retry load.

Expected failure: cold caches, reconnects, replay, and backlog drain exceed steady-state capacity and trigger a second incident.

Repair: staged recovery cohorts with saturation/latency stop conditions and preserved headroom.

### Root-cause-first incident behavior

Smell: team keeps experimenting in production to fully explain the failure while data/value/blast radius continues worsening.

Expected failure: incident expands and evidence is destroyed by speculative changes.

Repair: protect invariants, contain, recover reversibly, preserve evidence, then pursue root cause with bounded hypotheses.
