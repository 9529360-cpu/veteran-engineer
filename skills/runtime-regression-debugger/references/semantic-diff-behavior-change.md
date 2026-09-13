# Semantic Diff and Behavior Change Review

Use this after understanding a code diff but before accepting that its line-level shape describes the real system change.

## Contents

- Translate text changes into behavior changes
- Compare authority before and after
- Detect contract and side-effect expansion
- Review removed protections
- Trace deployment and compatibility consequences
- Require evidence for semantic claims

## Translate text changes into behavior changes

Summarize the patch as a before/after system model, not a file list.

At minimum ask whether the change alters:

- who may write authoritative state;
- when a state transition may occur;
- what durable or external effects can escape;
- what public or inter-service contract is accepted/emitted;
- what authorization or tenancy guard is enforced;
- what background trigger can cause work;
- which independently deployed unit participates.

Use `scripts/semantic_change_gate.py` after the model has extracted an explicit before/after manifest. The script checks structural deltas; it does not infer semantics from source code.

## Compare authority before and after

Treat a newly added writer, coordinator, cache authority, or retry path as a semantic change even if only a few lines moved.

Example:

`before: SessionStore is the only writer`

`after: SessionStore + route callback can both write currentSession`

The semantic change is "two writers now exist," not "one callback was added."

## Detect contract and side-effect expansion

Look for newly accepted inputs, newly emitted fields/events, changed default behavior, broader retry scope, new background execution, new durable writes, and new external effects.

Small syntax changes can widen a contract or make an operation repeatable. Review consequences, not diff size.

## Review removed protections

Removed validation, auth guards, generation checks, uniqueness constraints, transaction boundaries, cleanup, timeouts, or reconciliation paths deserve explicit justification.

A refactor that "simplifies" code while deleting a protection is behavior-changing unless equivalence is proven elsewhere.

## Trace deployment and compatibility consequences

If behavior changes across a public protocol, persisted state, event stream, cache format, or independently deployed unit, evaluate old/new overlap and recovery. A semantic diff can be rollout-significant even when source compatibility remains green.

## Require evidence for semantic claims

For each material semantic delta bind at least one of:

- focused test or negative test;
- contract/schema comparison;
- runtime trace;
- state transition proof;
- migration/compatibility check;
- review of authoritative caller/consumer behavior.

Do not call a refactor behavior-preserving solely because types compile or snapshots are unchanged.
