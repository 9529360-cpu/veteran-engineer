# PostgreSQL and Redis engineering playbook

## Contents

- State data invariants before implementation
- Use PostgreSQL constraints and isolation deliberately
- Diagnose with real plans and statistics
- Manage pools and connection budgets
- Evolve schemas with mixed versions in mind
- Treat Redis as a scoped state owner, not magic speed
- Design cache invalidation and distributed coordination explicitly
- Test failure, eviction, lag, and recovery

## State data invariants before implementation

For each write path, state what must remain true under concurrent writers and retries.

Examples:

- one active entitlement per tenant/product;
- balance never spends the same reservation twice;
- idempotency key maps to one logical mutation result;
- resource belongs to exactly one tenant;
- job transition cannot move from terminal success back to running.

Choose DB constraints, transaction isolation, locks, compare-and-swap/version columns, or serialized ownership based on the invariant. Application pre-checks alone are usually insufficient for invariants that must survive concurrency.

## Use PostgreSQL constraints and isolation deliberately

PostgreSQL's default Read Committed semantics do not make multi-statement application logic serializable. Understand the actual reads/writes and anomalies that matter.

At stronger isolation, expect retryable transaction failures and make the complete transaction replay-safe.

Use unique/check/foreign-key/exclusion constraints when they directly encode durable invariants and are compatible with migration needs.

Current transaction documentation: https://www.postgresql.org/docs/current/transaction-iso.html

Do not hold transactions open across slow network calls unless the consistency model truly requires it and the lock/connection cost is understood.

## Diagnose with real plans and statistics

For query performance:

1. capture representative SQL, parameters/data shape, and latency;
2. inspect `EXPLAIN`/`EXPLAIN ANALYZE` safely in an appropriate environment;
3. inspect row estimates versus actuals, scan/join types, sorting, buffers/I/O where available;
4. confirm table/index statistics and data distribution;
5. change query/index/schema only for the measured bottleneck;
6. compare candidate under the same workload.

An index can accelerate reads while increasing write/storage/maintenance cost. Do not add indexes from ORM query shape alone.

Current performance documentation: https://www.postgresql.org/docs/current/performance-tips.html

## Manage pools and connection budgets

Compute connection budgets across instances/workers, not per-process in isolation.

Example:

`20 app replicas * pool max 20 = 400 potential DB connections`

Then add workers, migrations, admin tools, failover headroom, and transaction pooling behavior.

Queueing at the application pool can be healthier than allowing every request to create DB pressure. Measure pool wait, DB saturation, lock waits, and query latency separately.

## Evolve schemas with mixed versions in mind

For incompatible changes use:

`expand -> compatible readers/writers -> backfill -> cutover -> contract`

Avoid:

- dropping/renaming columns before all deployed code stops using them;
- large blocking backfills hidden inside schema migration transactions;
- rewriting applied production migration history;
- assuming rollback can restore destructively removed data.

Make backfills resumable/idempotent and monitor progress/lag. Test application and worker versions that actually coexist.

## Treat Redis as a scoped state owner, not magic speed

Classify each Redis use:

- cache;
- session/token metadata;
- rate limiting;
- ephemeral coordination/lock;
- queue/stream;
- durable-ish state projection.

The required correctness differs for each class. Redis eviction, replication, restart, failover, and TTL behavior can violate assumptions if the product silently treats cached/ephemeral data as authoritative.

Redis data type documentation: https://redis.io/docs/latest/develop/data-types/

## Design cache invalidation and distributed coordination explicitly

For cache entries define:

- key scope including tenant/user/permission/locale/version dimensions;
- TTL/freshness semantics;
- invalidation owner;
- read-after-write expectation;
- stampede behavior;
- negative caching;
- degraded behavior when Redis is unavailable.

Do not fix stale data by adding shorter TTLs without finding the invalidation owner.

For distributed locks, establish what correctness property the lock provides, lease/expiry behavior, owner token/fencing if required, and what happens during pauses/partitions. A Redis key is not automatically a safe global mutex for irreversible side effects.

## Test failure, eviction, lag, and recovery

Relevant tests include:

- concurrent DB writes;
- deadlock/serialization retry;
- replica/read-after-write lag;
- Redis miss/eviction/restart;
- cache stampede;
- stale tenant-scoped cache entry;
- migration interrupted halfway and resumed;
- pool exhaustion;
- failover/reconnect behavior for long-lived clients;
- duplicate idempotency request after process restart.

Assert durable authoritative state, not only ORM/cache return values.
