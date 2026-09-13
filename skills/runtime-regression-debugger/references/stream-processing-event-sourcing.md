# Stream Processing and Event-Sourcing Engineering

Use this reference for Kafka/Flink/Beam/Kinesis-like streams, stateful event processing, event-time windows, materialized projections, or event-sourced aggregates.

## Declare ordering and identity

State exactly what is ordered and by which key/partition. Global ordering is expensive and often unnecessary.

Carry stable event identity, entity/aggregate identity, source version/sequence, event time, ingestion time, schema version, and tenant scope when consumers need them.

Treat delivery as duplicateable and replayable unless stronger end-to-end semantics are proved.

## Event time, watermarks, and late data

For windowed/event-time processing, define:

- event-time source and clock assumptions;
- watermark strategy;
- allowed lateness;
- update/retraction behavior for late events;
- state retention/cleanup;
- what downstream users see when historical windows change.

A watermark is an operational estimate about completeness, not proof that no older event can arrive.

## Stateful processing and checkpoints

A checkpoint is useful only when it is coordinated with the state and source offsets required to resume consistently.

- Know whether state snapshots and offsets commit atomically or via recoverable protocol.
- Budget checkpoint duration/size and recovery time.
- Test crash during state update, checkpoint, sink commit, and rescale/repartition.
- Ensure sinks tolerate replay or participate in a transactional/idempotent protocol.

"Exactly once" inside a stream engine does not automatically make external email, payment, HTTP, or database side effects exactly once.

## Event sourcing

Use event sourcing only when immutable business history and replayable domain state justify the operational cost.

- Events represent business facts, not arbitrary CRUD diffs.
- Version event schemas for long-lived replay.
- Keep projection rebuild procedures and compatibility tests.
- Use snapshots as an optimization, not replacement authority, unless explicitly designed otherwise.
- Define correction/compensation rather than rewriting historical facts casually.
- Protect aggregate concurrency with explicit versioning/expected sequence where needed.

Do not introduce event sourcing merely because the system already uses Kafka.

## Repartitioning and rescaling

Changing partition keys can be a data migration. Define old/new routing coexistence, state movement, ordering boundaries, consumer ownership, and rollback/cutover behavior.

## Observability

Track consumer lag by time and records, oldest-event age, watermark lag, checkpoint health, state size, skew/hot partitions, replay rate, DLQ/quarantine, and downstream sink failures. Fleet-average lag can hide one hot partition that owns critical tenants.
