# Action Attribution and State Change

Use this reference when repository, CI, release, plugin, deployment, or other remote state changes between observations and the identity of the actor matters.

A changed state proves only that the state changed. It does **not** prove who changed it.

## Keep an initiated-action ledger

For every consequential remote action initiated in the current mission, retain a compact row:

`action identity -> requested effect -> target/source identity -> acknowledgement -> expected downstream effects -> observed postcondition`

Examples include branch creation, file update, PR merge, workflow dispatch, release upload, plugin update, deployment, tag creation, or an action that predictably triggers automation.

Treat platform-triggered consequences of an action you initiated as part of that causal chain until evidence separates them. A merge you initiated may cause CI, packaging, release automation, version commits, or deployment later; delayed completion does not turn that work into an unrelated actor.

## Attribution rule

Before saying that "another agent", "another host", "another workflow", "someone else", or an external actor caused a change, require actor-specific evidence that distinguishes it from the current mission's own causal chain.

Acceptable evidence can include:
- a distinct authenticated actor/session/workflow identity exposed by the authoritative system;
- an independently created commit/PR/release with provenance that cannot descend from an action initiated here;
- an audit/event record identifying the actor;
- a user statement that another actor performed the mutation;
- another independently observed mutation path whose identity is incompatible with the current mission.

Timing, a changed SHA/version/release ID, a conflict response, or the fact that a second read differs from the first is **not** actor evidence.

When actor evidence is absent, say only that the authoritative state advanced or changed and classify attribution as `unknown/ambiguous`. Do not invent a collaborator.

## Reconcile self-caused and ambiguous outcomes

When a mutation response is lost, delayed, rejected as stale, or returns a conflict:

1. read the authoritative target;
2. compare the observed result with every still-plausible initiated action and its expected downstream effects;
3. if the observed state exactly matches an initiated action's intended result, treat the result as compatible with the current mission and continue from the verified state;
4. if multiple causal paths remain possible, keep attribution unknown;
5. only label an external actor after independent actor evidence excludes the current mission's causal chain.

A conflict such as "release changed" is a freshness signal, not proof that another person or model changed it.

## Context compaction and replay

Tool orchestration, streamed hosts, connector retries, delayed automation, or context compaction can separate an initiating action from its later visible effect. Preserve the initiated-action ledger in the compact mission checkpoint before dropping detailed transcript context.

On resume, reacquire only stale authority and reconcile it against that ledger before narrating causality.

Never use "I do not remember doing this" as evidence that another actor did it.

## Reporting

Separate:
- **fact**: what authoritative state exists now;
- **causal evidence**: which initiated action or actor-specific record can explain it;
- **attribution confidence**: self-caused, externally proven, or ambiguous.

If the current state is correct but actor identity is ambiguous, report the correct state and the ambiguity. Do not manufacture a parallel developer merely to make the timeline sound coherent.
