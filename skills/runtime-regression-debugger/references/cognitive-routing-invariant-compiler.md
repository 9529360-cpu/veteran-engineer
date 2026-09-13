# Cognitive Routing and Invariant Compilation

Use this when a task is broad enough that loading many playbooks would dilute attention, or when success depends on preserving several cross-layer facts.

## Contents

- Route by mechanism and risk
- Keep the active context small
- Compile prose into invariants
- Bind each invariant to an owner
- Bind each invariant to evidence
- Detect invariant conflicts
- Stop when the invariant set is sufficient

## Route by mechanism and risk

Do not load references because a technology name appears in the repository. Route from the failing or changing mechanism.

Start with:

`task contract -> failing/changing transition -> likely owner -> risk surfaces -> minimum references`

Prefer three to seven relevant references over a broad dump. Add another reference only when new evidence crosses a boundary not already modeled.

Use `scripts/engineering_context_router.py` as a deterministic planning aid when the task spans several mechanisms. Treat its output as suggestions, not as proof.

## Keep the active context small

Separate three kinds of material:

- **active**: directly changes the next decision;
- **supporting**: useful if the active hypothesis survives;
- **background**: true but currently decision-irrelevant.

Do not spend context on background knowledge merely because it is available. Re-route after contrary evidence, a boundary crossing, or a materially changed risk model.

## Compile prose into invariants

Turn vague requirements into falsifiable facts before designing a non-trivial change.

For each material invariant capture:

`actor/resource -> fact that must remain true -> authoritative owner -> violation -> evidence needed`

Examples:

- a user may read only resources authorized for that tenant;
- a payment operation with one stable identity may create at most one logical charge;
- an old client may continue reading records written during the compatibility window;
- a late async completion may not overwrite a newer generation;
- a failed migration batch may resume without duplicating durable effects.

Do not turn implementation choices into invariants. "Use Redis" is not an invariant; "only one active lease generation may mutate the resource" may be.

## Bind each invariant to an owner

An invariant without an enforcement owner is only a wish. Identify whether the owner is a database constraint, transaction boundary, authorization layer, state machine, protocol, queue key, generation token, reconciliation job, or another concrete mechanism.

If two components both appear authoritative for the same fact, resolve that ownership conflict before adding synchronization code.

## Bind each invariant to evidence

For critical invariants, identify evidence that can actually fail when the invariant is violated. Use focused tests, negative tests, integration evidence, migration checks, concurrency probes, runtime traces, or black-box verification as appropriate.

Use `scripts/invariant_matrix.py` to check a structured invariant/evidence matrix for missing owner, violation, or required evidence fields. The script does not invent invariants and does not prove correctness.

## Detect invariant conflicts

Some requirements cannot all be maximized. Examples include strict global ordering versus availability, immediate revocation versus offline operation, or zero data loss versus asynchronous cross-region acknowledgement.

When invariants conflict, surface the tradeoff instead of hiding it behind implementation detail. Escalate only when product/risk semantics cannot be resolved from repository or operator truth.

## Stop when the invariant set is sufficient

Do not enumerate every desirable property. Keep the smallest set that can reject unsafe designs, guide ownership, and determine meaningful validation.
