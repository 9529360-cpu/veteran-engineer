# Temporal Debugging and State Transitions

Use this when correctness depends on ordering, lifecycle, retries, delayed completion, clocks, timeouts, initialization, or concurrent actors.

## Contents

- Turn symptoms into a timeline
- Separate logical order from wall-clock order
- Track generations and mutation rights
- Extract the state machine when transitions are implicit
- Model late and duplicate work
- Model timeout-after-success
- Instrument the transition, not the symptom
- Prove the fix under reordered execution

## Turn symptoms into a timeline

For timing-sensitive failures, reconstruct the smallest event sequence that can produce the bad state.

Represent events as:

`Tn | actor | generation | observed state | action | durable effect | emitted signal`

Then identify which alternative ordering changes the outcome. A useful timeline exposes a race; a decorative chronology does not.

## Separate logical order from wall-clock order

Do not assume timestamps define authority. Wall clocks can skew, callbacks can arrive late, queues can reorder, and retries can outlive the request that created them.

Prefer monotonic sequence, generation, term/epoch, version/CAS token, or single-writer ownership when the invariant needs ordering.

## Track generations and mutation rights

For every async completion ask:

- what generation/request/session/tenant/resource did it start under;
- is that generation still authoritative when it completes;
- what prevents a stale completion from mutating newer state;
- what happens after navigation, reconnect, failover, cancellation, or restart.

A boolean "still loading" flag is rarely enough to prove temporal ownership.

## Extract the state machine when transitions are implicit

Recover states from observable behavior and durable fields, not enum names alone. For each transition record actor/command, precondition, authoritative owner, durable mutation, side effect, acknowledgement, legal next states, retry/duplicate semantics, and terminal states. Separate command acceptance from transition completion; expose illegal transitions rather than letting retries or races invent them. Use `scripts/state_machine_check.py` when a small executable model can reject ambiguous transition logic.

## Model late and duplicate work

Explicitly test or reason about:

- old request returns after new request;
- cancellation races with success;
- worker retries after another worker completed;
- event replay occurs after projection rebuild;
- listener fires after owner disposal;
- reconnect duplicates subscription or registration;
- lease expires while the old holder is paused.

## Model timeout-after-success

A local timeout means the caller lacks an outcome; it does not prove the remote side failed. For durable/external effects, define stable operation identity and a query/reconcile path before adding retries.

## Instrument the transition, not the symptom

When runtime evidence is needed, capture identity and order at the authoritative transition: operation ID, generation, actor, state version, dependency outcome, durable commit, and acknowledgement. Avoid high-cardinality user data or secrets.

## Prove the fix under reordered execution

A timing fix should survive the ordering that caused the bug. Prefer deterministic scheduling, controlled deferred completion, fake clocks, barriers, or concurrency tests over arbitrary sleeps and "run it many times" confidence.
