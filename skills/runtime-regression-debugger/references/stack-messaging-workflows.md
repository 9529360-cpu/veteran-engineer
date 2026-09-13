# Messaging, queues, and durable workflow playbook

## Contents

- Start from delivery semantics, not product names
- Give every logical operation identity
- Separate event, command, job, and workflow contracts
- Design idempotency at the authoritative side effect
- Handle ordering and concurrency explicitly
- Use retries with classification and budgets
- Coordinate DB state and message publication durably
- Treat workflow engines differently from ordinary queues
- Evolve message schemas compatibly
- Validate redelivery, crash, and replay

## Start from delivery semantics, not product names

Before changing Kafka, BullMQ, Celery, Temporal, SQS, Pub/Sub, or another system, establish the semantics actually provided by the configured client/platform:

- at-most-once / at-least-once / stronger transactional scope;
- ordering scope;
- visibility/ack/lease behavior;
- retry/DLQ behavior;
- retention/replay;
- partitioning/routing;
- consumer concurrency;
- failover/rebalance behavior.

Do not describe the product contract as "exactly once" unless the authoritative business side effect is protected against duplicates across the full boundary.

For broker internals, separate producer acknowledgement/durability, partition or queue ownership, consumer offset/ack/visibility semantics, rebalance/failover generations, retention/compaction/DLQ, and quota/backpressure. Diagnose lag as a rate problem: arrival rate, service rate, partition skew, consumer concurrency, broker/storage/network limits, and downstream latency. More consumers cannot exceed partition or downstream capacity. Treat rebalance/revocation as an ownership-generation change, and ensure retention/replay windows exceed realistic incident recovery time.

## Give every logical operation identity

Use immutable identities for logical work, distinct from delivery-attempt IDs.

Examples:

- export operation ID;
- payment reconciliation ID;
- tenant + idempotency key;
- workflow ID;
- source event ID + consumer effect key.

A redelivery should resolve to the same logical operation or be safely deduplicated at the effect boundary.

## Separate event, command, job, and workflow contracts

Use names and schemas that reflect intent:

- **event**: a fact that happened;
- **command/job**: a request to perform work;
- **workflow**: durable multi-step process with state/progress;
- **notification**: delivery of information to a recipient/system.

Do not overload one topic/queue payload with several unrelated semantics merely to reuse infrastructure.

For long-running user work, prefer an operation/workflow resource that exposes state rather than an HTTP request waiting indefinitely.

## Design idempotency at the authoritative side effect

Consumer-level duplicate suppression is useful but not enough if a crash can happen after the side effect and before acknowledgment.

Protect the side effect with mechanisms such as:

- DB unique/idempotency record in the same transaction;
- conditional write/version check;
- provider idempotency key;
- workflow activity semantics plus authoritative dedupe;
- transactional producer/consumer scope where it actually covers the required boundaries.

Design the `timeout after success` case explicitly.

## Handle ordering and concurrency explicitly

Ask what must be ordered and at what key scope.

Global ordering is expensive and rarely required. Often the real invariant is ordering per account/order/resource.

Use partition/routing/concurrency controls that match that key. Still defend against duplicates, old events, and out-of-order delivery unless the platform contract reliably prevents them.

Noisy-neighbor controls may require per-tenant concurrency or quotas in addition to global worker concurrency.

## Use retries with classification and budgets

Classify failures:

- transient dependency/network;
- rate-limited/deferred;
- concurrency/serialization retry;
- permanent business failure;
- malformed/poison payload;
- revoked authorization/tenant state.

Bound attempts and total time. Use backoff/jitter where appropriate. Route exhausted/poison work to an explicit terminal state, DLQ, or operator workflow.

Never retry permission denial, invalid schema, or an unsafe non-idempotent side effect as if it were a transient 500.

## Coordinate DB state and message publication durably

The classic failure is:

`DB commit succeeds -> process crashes before publish`

or:

`publish succeeds -> DB rollback`

When the contract requires both to converge, use a durable pattern such as transactional outbox + relay/CDC, platform transaction semantics that truly span the needed owners, or a workflow/state machine that records progress durably.

Do not rely on "publish immediately after commit" plus retries as proof of no lost work.

## Treat workflow engines differently from ordinary queues

Durable workflow engines such as Temporal persist execution history and replay workflow logic. That changes programming constraints.

Keep workflow/orchestration logic deterministic according to the exact SDK/runtime rules. Put nondeterministic external side effects into supported activity/task boundaries.

Treat retries/timeouts/cancellation/compensation as part of workflow design, not incidental exception handling.

Current Temporal docs: https://docs.temporal.io/

For Kafka, confirm current producer idempotence/transaction settings and consumer isolation semantics for the deployed client/broker version.

Current Kafka docs: https://kafka.apache.org/documentation/

## Evolve message schemas compatibly

Message retention means old payloads can outlive a deployment.

Prefer additive evolution when possible. For breaking semantics, use explicit schema/event versions or parallel topics/contracts.

Test:

- old consumer with new additive payload;
- new consumer with old payload;
- replay of retained messages after migration;
- unknown fields/version;
- producer rollout before/after consumer depending on compatibility.

Do not remove a field merely because current producers stopped emitting it if retained messages still contain/require old semantics.

## Validate redelivery, crash, and replay

Exercise:

- duplicate delivery;
- crash after side effect before ack;
- crash before side effect after claim;
- lease/visibility expiry;
- consumer rebalance/restart;
- dependency timeout after remote success;
- DLQ/terminal transition;
- replay of historical messages;
- old/new consumer coexistence;
- tenant authorization change while job is queued;
- cancellation during long work.

Assert final business state and user/operator-visible job state, not only queue acknowledgement counts.
