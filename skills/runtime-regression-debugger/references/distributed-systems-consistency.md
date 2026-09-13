# Distributed Systems, Consistency, and Concurrency

Use this reference when correctness crosses process, service, queue, region, replica, or retry boundaries.

## Start with the invariant

Do not begin with CAP, consensus, or a vendor feature. State the fact that must remain true and the authority that can decide it.

Examples:

- a payment is captured at most once for one authorization;
- an order cannot consume more inventory than was reserved;
- one logical job may be delivered many times but its external effect occurs once logically;
- a tenant can never observe another tenant's object;
- a resource has one authoritative lifecycle state even if many projections lag.

Separate safety from liveness. Safety means a bad state never occurs. Liveness means useful progress eventually occurs. A fix that restores liveness by weakening safety is not automatically acceptable.

## Reason about distributed time honestly

- Treat clocks as useful measurements, not global ordering authorities.
- Distinguish wall clock from monotonic elapsed time.
- Expect skew, leap handling, NTP corrections, delayed messages, duplicate delivery, and reordering.
- Do not use timestamps alone to prove causality when concurrent writers matter.
- Use versions, fencing tokens, compare-and-swap, sequence numbers, or domain-specific conflict rules when authority requires ordering.

## Delivery and side effects

Assume networks can lose responses after the server committed work. Therefore a timeout does not prove failure.

- Design non-idempotent mutations around a stable logical operation identity.
- Put dedupe/idempotency at the authoritative side-effect boundary, not only at the caller.
- Use transactional outbox/inbox patterns when a database state change and message publication must stay logically coupled.
- Treat "exactly once" claims as scope-specific. Prove what is deduplicated, where identity is stored, how long it survives, and what happens after retention expires.
- For external systems that cannot participate in your transaction, model confirmation/reconciliation explicitly.

## Transactions across boundaries

Avoid distributed transactions by default, but do not replace them with hand-waving eventual consistency. First ask whether one authoritative commit plus asynchronous projection can reduce the number of synchronous authorities.

Choose coordination semantics from the actual invariant:

- **2PC/XA** only when participants and operations support the blocking/coordination trade-off and atomicity truly requires it;
- **saga/compensation** when forward steps can be modeled explicitly; compensation is a new business action, can fail, and may be impossible after an irreversible boundary;
- **TCC/reservation** when confirm/cancel plus expiry/orphan cleanup fit the domain;
- **outbox/inbox** to couple publication/consumption to one local transaction; it does not make arbitrary external effects atomic.

Unknown outcomes are normal: a timeout can mean failed, committed, or still executing. Prefer stable operation identity plus status lookup/reconciliation over blind replay.

For multi-step workflows:

1. define each local transaction;
2. define durable workflow state;
3. define retry identity and ownership;
4. define compensating action where semantically valid;
5. define what cannot be compensated;
6. define operator-visible terminal and ambiguous states;
7. reconcile against authoritative external state when responses are uncertain.

A saga is not automatic rollback. Compensation is a new business action and may itself fail.

## Locks, leases, and leadership

- Prefer database constraints or atomic compare-and-set when they directly enforce the invariant.
- Use distributed locks only when the lock service's failure semantics fit the protected resource.
- A lease needs expiry, renewal, owner identity, and fencing. An expired process may still be running.
- Never assume "only one worker should run" proves only one worker can perform the effect.
- When stale owners can act after a new owner is elected, require a monotonically increasing fencing/version token at the resource boundary.

## Replication and partitions

- Define read-after-write and monotonic-read expectations explicitly.
- Know which reads may go to replicas and what lag does to product behavior.
- Treat failover as a consistency event, not only an availability event.
- Test what happens when producer, consumer, DB primary, replica, cache, or region disagree about current state.
- Avoid multi-primary writes unless conflict semantics are explicit and acceptable to the domain.

## Failure tests worth running

Exercise duplicate command, lost response after commit, stale writer, delayed old event, out-of-order event, redelivery after worker crash, lease expiry during work, replica lag, failover during transaction, split dependency availability, and reconciliation after partial external success.

Prefer a small executable state machine or deterministic concurrency test over paragraphs of confidence when the invariant is subtle.
