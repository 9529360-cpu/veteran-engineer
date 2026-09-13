# Async jobs, queues, and edge/serverless patterns

## Contents

- Delivery semantics
- Job identity and state
- Idempotent consumers
- Retry classification
- Backpressure and concurrency
- Dead-letter handling
- Transactional outbox and dual writes
- Sagas and compensation
- Long-running workflows
- Serverless/edge constraints
- Stateful coordination
- Polling and schedules
- Mature references

## Delivery semantics

Unless the platform contract proves otherwise, design consumers as if a message can be:

- delivered more than once;
- delayed;
- delivered after producer timeout;
- processed concurrently;
- retried after partial work;
- dead-lettered;
- observed out of order relative to another queue/topic.

Do not equate message acknowledgement with downstream business completion.

## Job identity and state

A durable job should have:

- immutable job ID;
- actor/tenant/account owner;
- operation type/schema version;
- immutable or versioned input reference;
- created/eligible/start/finish timestamps;
- attempt count and next retry time;
- current state;
- terminal result/error summary;
- cancellation semantics;
- correlation/trace ID.

Avoid deriving job ownership from whatever account is currently visible in a UI when the worker runs.

## Idempotent consumers

A worker must assume it can see the same logical operation twice.

Use one or more:

- unique operation/event ID at the authoritative DB boundary;
- conditional state transition (`queued -> running`, version compare);
- inbox/dedupe table;
- provider idempotency key;
- naturally idempotent PUT/upsert/delete semantics;
- compensation/reconciliation when the remote system cannot be made atomic.

Do not implement `if (!seen) doSideEffect(); seen = true` without an atomic boundary.

## Retry classification

Classify before retrying:

- transient network/5xx;
- explicit rate-limit/Retry-After;
- serialization/lock conflict;
- dependency unavailable;
- permanent validation/business rejection;
- unauthorized/revoked credential;
- poison/malformed payload;
- canceled/expired work.

Use bounded attempts or a bounded elapsed-time budget. Preserve the last meaningful error.

## Backpressure and concurrency

Concurrency is a capacity-control decision, not a magic speed knob.

Limit by the true bottleneck:

- DB connections/locks;
- remote API quota;
- CPU/memory;
- browser/WebContents ownership;
- tenant entitlement;
- per-account serialization requirement.

Protect against noisy neighbors using tenant/account queue depth and concurrency controls when shared resources are vulnerable.

Cloudflare Queues documents autoscaling based on backlog/failure ratio and supports configured max concurrency:
https://developers.cloudflare.com/queues/configuration/consumer-concurrency/

A mature open-source example is n8n's queue-mode architecture, where concurrency is applied per worker and its test infrastructure includes queue worker lock timing and throughput harnesses. Re-check current source before borrowing implementation details:
https://github.com/n8n-io/n8n

## Dead-letter handling

A DLQ is not a trash bin.

For exhausted work, preserve:

- job/event identity;
- tenant/account scope;
- attempt/error summary;
- original schema/version reference;
- reason for terminal classification;
- safe replay/redrive procedure.

Cloudflare Queues' DLQ model is a concrete reference:
https://developers.cloudflare.com/queues/configuration/dead-letter-queues/

Never automatically redrive a poison payload forever.

## Transactional outbox and dual writes

A common correctness bug is:

`commit business row -> publish event/message`

These are two independent writes. The process can die after the database commits but before publish, or publish before the database transaction ultimately rolls back.

When a database mutation must reliably produce an event, prefer a transactional outbox or equivalent change-data-capture mechanism:

`business rows + outbox event committed in one transaction -> relay committed event -> broker -> idempotent consumer`

The relay can still publish more than once, so consumers must remain idempotent/deduplicated. Preserve event identity and ordering requirements explicitly.

AWS Prescriptive Guidance documents the transactional outbox pattern and its duplicate-delivery/idempotent-consumer implication:
https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html

Do not solve the dual-write problem with an in-memory "publish after commit" callback when message loss is unacceptable.

## Sagas and compensation

When one business transaction spans multiple independently committed services/datastores, a normal local DB transaction cannot make them atomic.

Use a saga/compensating workflow only when the product can accept its complexity and eventual-consistency semantics. Define for every step:

- local transaction and idempotency key;
- durable next-state/event;
- retry policy;
- compensation and whether compensation itself can fail;
- timeout/cancellation semantics;
- operator-visible terminal states;
- audit/reconciliation path.

Prefer orchestration when a single workflow owner makes state/compensation easier to reason about; use choreography only when event ownership and cyclic-dependency risk are understood.

AWS Prescriptive Guidance explicitly calls out dual-write, ordering, cyclic-dependency, and eventual-consistency risks in saga designs:
https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html

A compensation is a business action, not a database rollback. It can have different semantics and can itself require human reconciliation.

## Long-running workflows

For multi-step workflows, define durable state between steps.

Examples:

`accepted -> reserve -> call provider -> confirm -> project -> notify`

Each step needs:

- idempotent or compensated effect;
- durable transition;
- retry policy;
- cancellation rule;
- timeout/expiry;
- observability.

Do not rely on one process staying alive through a long workflow unless the runtime contract explicitly guarantees it.

## Serverless/edge constraints

Process memory is an optimization cache, not durable truth.

For every runtime re-check current:

- CPU limit;
- memory limit;
- duration/background-work behavior;
- outbound connection/subrequest limits;
- request/body limits;
- region/replica consistency;
- runtime compatibility/version controls.

Cloudflare Workers is a useful example: runtime compatibility dates/flags make platform behavior versioned, and execution/resource limits differ by trigger/plan. Re-research current values instead of freezing them in code or skills:
https://developers.cloudflare.com/workers/configuration/compatibility-dates/
https://developers.cloudflare.com/workers/platform/limits/

## Stateful coordination

When correctness requires a single logical writer or strongly coordinated state, choose a durable coordination primitive rather than a random in-memory singleton.

Cloudflare Durable Objects are one example of an actor-like stateful owner with unique identity and durable strongly consistent storage:
https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/

Do not infer all async JavaScript inside a single-threaded actor is automatically race-free; understand the runtime's interleaving/storage semantics.

## Polling and schedules

Every poller/scheduler needs:

- owner and lease/singleton semantics;
- interval with jitter when fleet synchronization is harmful;
- missed-run/catch-up policy;
- overlap policy;
- timeout;
- cancellation;
- quota/cost budget;
- last-success/last-attempt metrics.

Avoid per-item aggressive polling when a provider supports webhooks/events or batch status lookup.

## Mature references

- Cloudflare Queues: https://developers.cloudflare.com/queues/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cloudflare Workers compatibility dates: https://developers.cloudflare.com/workers/configuration/compatibility-dates/
- AWS Builders' Library retry/backpressure guidance: https://aws.amazon.com/builders-library/
- Google AIP long-running operations: https://google.aip.dev/151
- n8n queue/scaling implementation: https://github.com/n8n-io/n8n
