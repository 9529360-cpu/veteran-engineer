# Cognitive Routing and Invariant Compilation

Use this when a task is broad enough that loading many playbooks would dilute attention, or when success depends on preserving several cross-layer facts.

## Contents

- Route by mechanism and risk
- Promote owners through proof-backed transitions
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

### Arbitrate multi-signal tasks by next-decision ownership

When several valid signals coexist, do not make all matching specialists co-equal. Select the owner whose decision must be settled **now**, keep only domain/risk constraints that materially shape that decision, and queue other workflow stages. A useful split is:

`primary owner -> active domain/risk companions -> deferred stage owners`

Requirements, design, technical-contract, implementation, review, and release knowledge are different workflow stages even when one mission eventually needs all of them. Incident and regression diagnosis are exceptions: keep the failing mechanism in the active set because deferring it would hide the cause under investigation. An explicit stage-advance signal may move an accepted upstream contract forward—for example, `fullstack` can make implementation current while the accepted design remains supporting context.

Treat `deferred_references` as a queue of unopened owners, not a second active context. Revalidate the authoritative artifact/revision before promoting a deferred owner.

## Promote owners through proof-backed state transitions

For multi-stage work, treat owner changes as state transitions rather than conversational suggestions. Keep a compact transition state:

`mission signals -> generation -> current owner/stage -> authority identity -> active companions -> future owners -> closed upstream owners -> history`

Use `scripts/owner_transition_gate.py` when a handoff must survive worker boundaries, long-running execution, review, or restart. The gate composes with `scripts/proof_bundle_gate.py`; it checks metadata/identity and cannot decide whether a claim is semantically true.

A forward handoff must prove all of these mechanically before the next owner becomes current:

- the event targets the exact current generation, owner, and authority identity;
- the proof bundle applies to that same authority identity and the declared required exit claims pass;
- the target signal is already in the mission or is explicitly added;
- no already-queued intermediate stage owner is skipped;
- the next owner receives a new authority identity rather than silently reusing stale state.

Do not keep old specialists loaded after their stage closes merely to preserve context. Carry the accepted artifact/revision identity through `authority_lineage`; load the new stage owner plus same-stage/domain constraints. Closed upstream owners remain reopenable evidence history, not active prompt budget.

Backward movement is not a normal handoff. When runtime/review evidence contradicts an accepted upstream contract, use an explicit **invalidation** transition: bind the contradiction proof to the current candidate identity, reopen the smallest responsible owner, and invalidate that owner's most recent authority plus every downstream primary authority derived from it. Preserve earlier unaffected lineage, version/repair the authoritative artifact, then resume downstream from the new generation. This prevents a reviewer or worker from silently rewriting upstream truth or reusing a candidate that depended on a stale contract.

Completion is also a transition. Do not mark the mission complete while requested future-stage owners remain queued. A completion proof closes the current authority only after the mission's declared stage queue is empty or the user explicitly changed scope elsewhere in the controlling contract.

The default lifecycle is therefore:

`active owner -> exit proof -> handoff -> next generation`

with the repair path:

`contradictory evidence -> invalidate current authority -> reopen smallest responsible owner -> new revision -> reconverge`

Treat stale-generation, stale-owner, stale-authority, skipped-stage, foreign-proof, and unproven-claim failures as blocked transitions rather than prompts for the next specialist to improvise around the gate.

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
