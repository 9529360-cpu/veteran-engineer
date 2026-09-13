# Dependency Outcome and Degradation Engineering

Use this when a user contract crosses an external service, remote API, object store, message system, identity provider, model provider, payment provider, or independently operated internal dependency.

## Model outcomes, not exceptions

A remote call can produce more states than success/failure:

- confirmed success;
- confirmed rejection/failure;
- timeout with unknown remote outcome;
- throttling/backpressure;
- partial or delayed completion;
- stale but syntactically valid data;
- malformed/incompatible response;
- transport failure before request acceptance.

Do not collapse these into one `except -> retry` branch.

## Separate reads from mutations

For reads, decide freshness requirements and degraded behavior. A stale cache may be acceptable for a catalog and unacceptable for authorization or account balance.

For mutations, treat unknown outcome as a first-class state. A timeout can occur after the remote side committed.

## Retrying mutations requires identity

Before automatically retrying a mutating request, establish one of:

- stable idempotency/operation identity understood by the dependency;
- authoritative status lookup by stable identity;
- local durable command plus reconciliation/outbox semantics;
- a safely repeatable operation by construction.

If none exists, retry can duplicate an irreversible effect.

## Respect dependency pressure

429, retry-after, queue full, or elevated latency can be overload signals. Retrying faster converts a dependency problem into a retry storm.

Use:

- bounded exponential backoff with jitter where appropriate;
- caller deadlines and cancellation;
- concurrency/admission limits;
- circuit breaking only when failure semantics justify it;
- bounded queues with explicit rejection/degradation.

## Define stale and fallback semantics

Fallback is not automatically safe.

For each fallback ask:

- what invariant changes;
- how old the data may be;
- whether tenants/users can cross scopes;
- whether fallback can authorize or charge;
- how recovery reconciles divergent state;
- how the operator knows fallback is active.

## Preserve provider contract evidence

Verify current official/provider semantics for:

- idempotency window and key scope;
- status APIs and terminal states;
- retry-after/rate-limit rules;
- webhook/event duplication and ordering;
- timeout/cancellation behavior;
- versioning/deprecation policy.

Do not infer remote guarantees from a local SDK signature.

## Test degraded outcomes

Exercise the smallest representative set that can falsify the design: timeout-after-accept, duplicate request/event, throttling, malformed response, stale read, provider recovery, and reconciliation where material.

Use `scripts/dependency_outcome_matrix.py` when the outcome policy should be explicit before implementation or review.
