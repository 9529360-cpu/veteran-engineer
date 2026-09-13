# Database Internals and Query Engineering

Use this reference when correctness or performance depends on how the database actually executes, stores, locks, replicates, or plans work.

## Query from the engine's point of view

Before adding a cache, shard, or index, inspect the real workload and execution plan.

- Capture representative query shape, cardinality, parameter distribution, row width, result size, frequency, and concurrency.
- Read the actual/estimated plan with the database's native tooling when possible.
- Compare estimated versus actual row counts; large estimation errors often explain bad join/order/index choices.
- Distinguish CPU, random I/O, sequential I/O, memory spill, lock wait, network transfer, and client-side processing.
- Check whether the application is issuing N+1 queries, overfetching columns, paginating with expensive offsets, or repeatedly parsing/serializing large values.

## Index discipline

An index is a write-time and storage-time data structure, not free speed.

- Design indexes around actual predicates, join keys, ordering, selectivity, and covering needs.
- Validate column order and prefix use rather than adding every filtered column.
- Watch write amplification, page churn, bloat/fragmentation, vacuum/maintenance cost, and duplicate indexes.
- Do not create an index from one slow-query screenshot without checking workload frequency and plan change.
- For very large tables, plan online/concurrent index operations and failure cleanup explicitly.

## Transactions, MVCC, and locks

- Know what the repository's database and isolation level actually guarantee.
- "In a transaction" does not automatically prevent lost updates, write skew, phantom-like anomalies, deadlocks, or stale reads.
- Inspect lock acquisition order and transaction duration for deadlock-prone paths.
- Keep external network calls out of database transactions unless there is an exceptional documented reason.
- Make retryable serialization/deadlock failures replay the entire logical transaction safely.
- Use constraints for invariants the database can enforce better than application races can.

## Connection pools and admission

- A database has finite active work capacity. More client connections can reduce throughput once CPU, I/O, memory, or lock contention saturates.
- Budget pool sizes across all application instances, workers, migrations, admin tools, and failover replicas.
- Separate queued application concurrency from active DB concurrency.
- Treat pool exhaustion as an overload symptom that needs ownership and backpressure, not merely a reason to increase the pool.

## Replication, durability, and failover

- Know commit durability settings, replica mode, lag behavior, promotion rules, and read routing.
- Define whether a just-written value must be visible on the next read and route accordingly.
- During failover, consider acknowledged-but-not-replicated writes, duplicate retries, sequence/identity behavior, and old-primary fencing.
- Test restore from backup and point-in-time recovery; a successful backup job is not proof of recoverability.

### Storage-engine mechanics when SQL-level evidence is insufficient

Identify the exact engine/version and trace acknowledgement, WAL/binlog/redo, page/segment/LSM layout, checkpoint/flush/compaction, MVCC cleanup, replication receive/apply, crash recovery, and promotion/fencing semantics.

- B-tree/page engines can surface write amplification, page churn, checkpoint spikes, buffer pressure, and version/vacuum debt.
- LSM engines trade write throughput for compaction/read amplification and can collapse under unbounded compaction debt.
- Replication lag has receive, durable, and apply components; one scalar lag metric can hide the bottleneck.
- Long readers/transactions can retain versions or logs far beyond their visible workload cost.

Correlate latency with fsync/storage queue depth, dirty/checkpoint work, compaction/vacuum debt, lock waits, replica apply rate, and resource saturation before weakening durability or changing engine knobs.

## Schema and data evolution

- Separate logical schema compatibility from physical backfill cost.
- Estimate table size, lock mode, rewrite behavior, WAL/binlog volume, replica impact, and rollback before large migrations.
- Prefer expand -> backfill -> verify -> cutover -> contract for incompatible changes.
- Preserve old/new application coexistence for the real deployment window.
- Use chunked, resumable, observable backfills with stable progress identity for large data changes.

## Hotspots and partitioning

Partition only after proving the bottleneck and the future access pattern.

- Identify hot keys, monotonically growing indexes, skewed tenants, temporal hotspots, and fan-out queries.
- Choose a partition/shard key that distributes writes while preserving important queries and ownership boundaries.
- Price rebalancing, global uniqueness, cross-shard transactions, secondary indexes, backups, and tenant movement before committing.
- A shard boundary is a long-lived product/data contract; do not choose one from current table size alone.
