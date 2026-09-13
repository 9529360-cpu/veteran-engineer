# Consensus, Coordination, and Leadership Engineering

Use this reference when correctness depends on leader election, distributed locks, leases, quorum, membership, or avoiding split brain.

## First ask whether consensus is actually required

- Prefer single-owner state, database constraints/transactions, idempotency, deterministic partition ownership, or reconciliation when they satisfy the invariant.
- Do not introduce a consensus system merely to avoid designing operation identity or ownership.
- Separate "only one worker should usually do this" from "two concurrent actors would violate a safety invariant".

## Model the safety property

- State exactly what must never happen: two primaries accept writes, two schedulers emit the same irreversible effect, stale config overwrites new config, or a resource is allocated twice.
- State the liveness expectation separately: how long can progress pause during leader loss or partition?
- Identify the authority that decides membership and epoch/term/generation.

## Leases and locks

- A lease expiring does not prove the previous holder stopped executing.
- Use fencing tokens/monotonic epochs at the protected resource when stale holders can still perform writes after losing authority.
- Bound lock/lease scope and hold time; avoid distributed locks around slow external calls when an idempotent state machine is safer.
- Define behavior when lock service is unavailable or partitioned; fail-open versus fail-closed is a product/security decision.

## Quorum and replication

- Reason about which side may make progress after a network partition and what state can be lost after acknowledged writes.
- Do not treat "three replicas" as a consistency guarantee without knowing write/read quorum and failure semantics.
- Distinguish replication, consensus, and durability; a replicated wrong or stale value is still wrong or stale.
- Treat clock time as observational unless the algorithm explicitly tolerates skew/steps; use logical generations for ownership where possible.

## Operational discipline

- Observe leader/term changes, election duration, quorum loss, membership changes, replication lag, and rejected stale writes.
- Test process pause, GC stall, asymmetric partition, delayed packets, old leader recovery, clock jump, and node replacement where they threaten the invariant.
- Make membership changes conservative and auditable; simultaneous topology and application changes multiply ambiguity.
- Prefer mature coordination primitives from the platform/store over implementing consensus algorithms in application code.

The key question is not "which algorithm is famous?" It is "what authority and failure semantics are necessary for this invariant at this scale?"
