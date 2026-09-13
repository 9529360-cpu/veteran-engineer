# Proof-Carrying Change and Evidence Freshness

Use this when a change is consequential, long-running, release-bound, or likely to be reviewed after the original investigation context is gone.

## Purpose

A change should carry enough structured evidence to explain what was changed, what is claimed, what actually proves each claim, and what remains unproven.

Do not treat evidence as timeless. A passing test against an old commit, old schema, old runtime, or old deployment cannot automatically prove a newer artifact.

## Build claims before collecting evidence

For every material claim state:

- the claim itself;
- the invariant or user contract it protects;
- the source/build/runtime identity it applies to;
- the minimum evidence level needed;
- the evidence that supports it;
- residual unknowns that still matter.

Examples of claims:

- duplicate payment retries converge to one durable charge;
- old clients can read data produced by the new server;
- the new migration can resume after a partial batch;
- p99 latency did not regress under the representative workload;
- the exact release candidate starts and serves the critical path.

## Bind evidence to identity

Prefer evidence that names the exact thing tested:

- commit SHA or tree identity;
- package/image digest;
- migration/schema version;
- browser/runtime version;
- test fixture/data snapshot;
- environment/region/cohort;
- deployed release identity.

"CI passed yesterday" is weak if today's head changed. "Production looked healthy" is weak if the candidate was not yet receiving traffic.

## Treat evidence as scoped

Evidence can prove only the mechanism and population it exercised.

A unit test proves a narrow owner. A contract test proves a boundary. A staged end-to-end run proves the exercised path and cohort. A production observation proves only the observed deployment window and population.

Do not silently promote one evidence level into another.

## Evidence expiration

Evidence can become stale when any material dependency changes:

- source identity;
- schema or migration state;
- runtime/platform version;
- dependency version/configuration;
- traffic shape or scale;
- feature flag/default;
- region/topology;
- test data or fixture semantics.

For volatile evidence, define a practical maximum age or an invalidation trigger. Exact artifact identity is usually stronger than calendar age alone.

## Prefer falsifying evidence

A strong evidence bundle includes attempts that could have failed the claim:

- mutation or metamorphic challenge for a regression oracle;
- duplicate/timeout/crash path for an external effect;
- mixed-version cell for compatibility;
- restore/failover for recovery;
- overload/degraded mode for capacity controls.

Evidence that can only pass is documentation, not proof.

## Keep residual unknowns visible

Do not bury uncertainty because a release deadline is near. Record unknowns that could still change the safe action, and separate them from unknowns that are operationally irrelevant.

A release can still be reasonable with residual risk when the change is reversible, blast radius is bounded, monitoring is strong, and stop/recovery controls are proven.

## Use the deterministic gate

Use `scripts/proof_bundle_gate.py` when a structured claim/evidence manifest helps prevent stale or foreign evidence from being used to justify a completion claim.

The script validates declared metadata only. It does not infer whether the evidence itself is truthful or sufficient for the real system.
