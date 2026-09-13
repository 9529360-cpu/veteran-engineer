# MySQL, MongoDB, SQLite, Elasticsearch/OpenSearch, and mixed data-store engineering

Use this playbook only for data stores detected in the repository. Confirm exact engine/version, topology, consistency model, driver, and operational ownership.

## General rule

Choose a data-store behavior from product invariants and measured access patterns, not from generic technology stereotypes. Verify production configuration because engine defaults and managed-service settings vary.

## MySQL and MariaDB

- Inspect transaction isolation, locking, indexes, collation/charset, SQL mode, replication topology, and DDL behavior for the deployed version.
- Use `EXPLAIN`/execution evidence for material queries; composite-index order matters.
- Be careful with online DDL claims, table rebuilds, long metadata locks, and replication lag on large tables.
- Treat auto-increment/sequence assumptions explicitly under sharding or multi-primary designs.

## MongoDB

- Model document boundaries around atomicity and access patterns; embedding everything or normalizing everything are both cargo cults.
- Define consistency/read concern/write concern from product semantics.
- Inspect compound indexes and query shapes; unbounded arrays/documents become operational problems.
- Treat retryable writes/transactions as mechanisms with duplicate/external-side-effect implications.
- Design schema evolution for mixed document versions during rolling deployments.

## SQLite

- Respect single-file/process/filesystem ownership and writer concurrency limits.
- Confirm journal mode, locking, busy timeout, durability, backup, and network-filesystem constraints for the actual deployment.
- SQLite is excellent for many embedded/local/small-service workloads; do not replace it merely because the system is "production".
- Replace it when measured concurrency, HA, remote multi-writer, operational, or data-governance requirements justify the cost.

## Elasticsearch and OpenSearch

- Treat the search index as a projection unless it is intentionally the system of record.
- Define indexing pipeline, refresh/freshness expectations, versioning, replay/rebuild, alias/cutover, mapping compatibility, shard count, and retention.
- Avoid high-cardinality/unbounded field mappings and uncontrolled dynamic schemas.
- For reindexing, use versioned indices/aliases and verify document counts/queries before cutover.
- Do not use search success as proof that the authoritative database transaction succeeded.

## Mixed stores

For systems with DB + cache + search + object store:

- name the authority for each fact;
- define projection lag and reconciliation;
- define rebuild path;
- avoid synchronous distributed transactions unless requirements justify them;
- instrument state transitions so operators can tell which projection is stale;
- test failure between authoritative commit and projection update.
