# Data consistency and migration patterns

## Contents

- State invariants
- Constraints and transactions
- Isolation and concurrency
- Idempotent persistence
- Expand-and-contract migrations
- Backfills
- Read replicas and consistency
- Caches
- Deletion and retention
- Validation and rollback
- Mature references

## State invariants

Start with a business invariant, not an ORM call.

Examples:

- one active subscription per account;
- balance never becomes negative;
- one executing job per owner;
- username unique within tenant;
- a child resource cannot outlive its owner;
- a consumed token cannot be consumed again.

Ask which invariant must remain true under concurrent requests, retries, crashes, and rolling deployments.

## Constraints and transactions

Use database constraints for durable invariants when the storage engine supports them:

- unique constraints;
- foreign keys;
- check constraints;
- not-null/default semantics;
- transactional conditional updates.

Application validation improves error quality; a constraint protects against concurrent writers and forgotten call paths.

Keep external network calls outside a DB transaction unless the architecture has a compelling reason; long network waits can hold locks and do not make the remote side transactional.

## Isolation and concurrency

"Wrapped in a transaction" is not enough to prove correctness.

Know the storage engine's isolation behavior and anomalies.

PostgreSQL's current docs distinguish Read Committed, Repeatable Read, and Serializable; Serializable may abort a transaction when concurrent execution cannot be serialized, so the application must be prepared to retry the entire transaction:
https://www.postgresql.org/docs/current/transaction-iso.html

Common approaches:

- atomic conditional update (`UPDATE ... WHERE version = ?`);
- optimistic concurrency/version columns;
- row locks when ownership and lock duration are clear;
- unique constraint + handle conflict;
- stronger isolation + bounded whole-transaction retry;
- single-writer actor/partition when architecture supports it.

Pick from the invariant, not preference.

## Idempotent persistence

A dedupe key must be committed in the same authoritative transaction as the side effect it protects when possible.

Risky pattern:

`check key -> perform write -> later save key`

Two concurrent requests can pass the check.

Prefer a unique operation key or equivalent atomic reservation/commit strategy.

## Expand-and-contract migrations

For production schema changes where old/new code coexist:

1. **expand**: add compatible columns/tables/indexes/events;
2. deploy code that can tolerate both forms;
3. backfill existing data in bounded batches;
4. switch reads/writes intentionally;
5. verify correctness and old-version absence;
6. **contract**: remove obsolete schema only later.

Prisma documents this pattern for zero-downtime field evolution:
https://www.prisma.io/docs/guides/database/data-migration

Do not rename/drop a hot column in the same deployment that first teaches the application the new name unless deployment is truly atomic.

## Backfills

Treat large backfills as production workloads.

Define:

- bounded batch size;
- deterministic cursor/order;
- resume checkpoint;
- idempotent update rule;
- concurrency limit;
- lock/IO budget;
- progress metrics;
- verification query;
- pause/abort strategy.

Do not run a multi-million-row transformation synchronously inside an application startup migration unless lock/time risk is proven acceptable.

## Read replicas and consistency

Write acknowledgement does not guarantee every replica can immediately serve the write.

Define whether the product needs:

- eventual consistency;
- read-your-writes;
- monotonic/sequential consistency;
- strong/primary read.

Cloudflare D1's current read-replication Sessions API is a useful concrete example of carrying a bookmark to preserve sequential consistency across replicas:
https://developers.cloudflare.com/d1/best-practices/read-replication/

Do not hide consistency requirements behind arbitrary sleeps.

## Caches

Every cache entry needs a scope and freshness contract.

Classify the value:

- immutable/versioned global;
- global mutable;
- tenant-scoped;
- user/account-scoped;
- permission/version-scoped;
- request-local.

Include every dimension that changes the result in the key.

Authorization must still be enforced before returning protected cached data.

Define invalidation from the mutation owner. Avoid a second cache added merely to mask slow or stale state without proving why the first owner is insufficient.

## Deletion and retention

Delete means different things for:

- logical product visibility;
- primary DB rows;
- object/blob storage;
- caches;
- queues/jobs;
- audit records;
- replicas;
- backups;
- legal holds;
- external providers.

Document the retention contract. Do not claim immediate erasure when backups or external systems intentionally retain data.

## Validation and rollback

For data changes, validate separately:

- migration applies on representative old schema;
- application old/new coexistence;
- constraints after backfill;
- row counts/invariants/checksums where meaningful;
- query plans/locks for hot paths;
- rollback strategy.

Code rollback is not always data rollback. After a destructive or semantic data migration, rolling back application binaries may make the system less compatible.

## Mature references

- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- Prisma expand-and-contract: https://www.prisma.io/docs/guides/database/data-migration
- OWASP multi-tenant security: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- Cloudflare D1 read replication consistency: https://developers.cloudflare.com/d1/best-practices/read-replication/
