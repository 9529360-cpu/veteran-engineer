# CDC, Search, Object Storage, and Large Data Movement

Use this reference when data is copied from an authoritative store into streams, indexes, analytical stores, object storage, or replacement systems.

## Declare authority and derivation

- Identify the system of record for every fact and which stores are rebuildable projections.
- Search indexes, caches, warehouses, and materialized views should not silently become competing write authorities.
- Carry stable entity/operation identity and source ordering/version metadata when consumers need to reject stale updates.

## CDC and event capture

- Prefer log/outbox/change-stream mechanisms with documented ordering/checkpoint semantics over polling timestamps when missed/duplicate changes matter.
- Treat capture and apply as at-least-once unless stronger semantics are proved end to end.
- Persist consumer checkpoints only after durable apply; design replay from an earlier checkpoint to be safe.
- Plan schema evolution for old/new producers and consumers; capture streams preserve bad compatibility decisions for a long time.
- Monitor source log retention versus consumer lag so a stalled consumer does not silently fall off the recoverable history window.

## Backfill plus live tail

- Define snapshot boundary, live-tail start position, dedupe/version rule, catch-up condition, and cutover verification.
- Throttle scans/copies by source DB, network, destination write, compaction, and production latency budgets.
- Make backfill partitioned, resumable, retryable, and independently verifiable.
- Compare counts/checksums/domain invariants by ranges or cohorts; aggregate totals alone can hide swapped or duplicated data.

## Search systems

- Treat indexing as a projection with explicit freshness SLO and rebuild path.
- Version index mappings/schema and use parallel indexes/aliases for incompatible mapping changes when supported.
- Budget query fanout, shard count, segment/merge cost, refresh frequency, and high-cardinality aggregations.
- Do not route authorization solely through eventually consistent search results unless stale authorization is acceptable by design.

## Object storage

- Prefer immutable/versioned object keys for large artifacts where overwrite races or CDN/cache ambiguity matter.
- Store metadata/checksum/content type/size and authoritative ownership separately enough to validate uploads and garbage collection.
- Define multipart/resumable upload finalization and cleanup of abandoned parts.
- Treat lifecycle/retention/deletion policies as data-loss mechanisms requiring scope tests and auditability.

## Recovery

- Prove that a derived store can be rebuilt within the required time from authoritative data plus retained change history.
- Keep old projection/read path until new projection parity and cutover criteria are met; deletion is the final migration step, not the first.
