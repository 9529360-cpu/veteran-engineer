# Veteran engineering judgment

Use this when the hard part is choosing what not to change, how much complexity is justified, or how much evidence a decision deserves.

## Contents

- Optimize for system lifetime
- Separate essential from accidental complexity
- Price every new component by lifecycle
- Prefer evidence over fashion
- Reason in second-order effects
- Scale rigor with reversibility and blast radius
- Preserve hidden compatibility
- Use prior failure patterns as hypotheses
- Make uncertainty explicit
- Compile a decision contract before consequential change
- Reopen decisions when evidence invalidates them

## Compile a decision contract before consequential change

Treat the requested mechanism as a proposal, not automatically as the problem definition. First separate the desired outcome from the means named in the request and recover enough system truth to know what is actually constrained.

Use the full judgment pass when a choice can create durable complexity or difficult rollback: architecture/ownership boundaries, public API or schema, persisted semantics or migration, a new service/store/queue/cache/framework/dependency/flag/job, security/tenant boundaries, performance/reliability mechanisms, wide refactors, release/recovery strategy, or irreversible/external effects. Also trigger it when fresh evidence materially contradicts the requested mechanism.

For a triggered decision, keep one compact **Engineering Decision Record** in the active mission state or durable decision ledger when the choice must outlive the task:

`problem/outcome | current reality | invariants + non-goals | viable options | lifecycle + second-order tradeoffs | chosen path | rejected alternatives | disconfirming evidence | validation | reconsideration trigger`

- Compare at least two genuinely viable paths while the choice is open. Include a no-change or simpler existing-owner path only when it is actually viable; never invent strawmen to make the preferred design look stronger.
- If evidence leaves one valid path, say why the alternatives are invalid instead of manufacturing competition.
- Price the whole lifecycle, reversibility, blast radius, compatibility, recovery, and operational ownership—not only implementation elegance.
- Prefer the smallest complete change whose benefit is demonstrated. Evidence-backed no-change is a legitimate engineering result.
- Tiny/local/reversible changes with one obvious evidence-backed owner do not need ceremony; keep the decision implicit or one line and move on.

A decision record is not permission. Authorization and product intent remain separate authorities.

## Optimize for system lifetime

Judge a design across deployment, incidents, upgrades, migration, debugging, ownership transfer, and deletion—not only edit-time elegance.

A clean abstraction can still be a bad system decision if it creates another source of truth, synchronized releases, hidden I/O/retries, new operational state, harder recovery, or a runtime/store/queue with no durable justification.

Prefer boring existing mechanisms when they satisfy the contract with less operational surface.

## Separate essential from accidental complexity

Preserve essential complexity such as real authorization/accounting policy, compatibility with deployed clients, network partial failure, long-running workflows, human approval/reconciliation, and durable historical data semantics.

Actively remove accidental complexity such as duplicated state, leaky adapters, expired compatibility paths, repeated conversions, unnecessary distributed hops, and abstractions with no independent policy or consumer.

Do not hide essential complexity merely to make code look simple; make it explicit and testable.

## Price every new component by lifecycle

Before adding a service, queue, cache, index, database, flag, scheduled job, copied dataset, framework, or external dependency, price:

`build + deploy + secure + observe + capacity-plan + upgrade + incident-response + migrate + delete`

Require a concrete pressure such as ownership, isolation, independent scaling, security boundary, latency, availability, or materially different lifecycle. "Cleaner architecture" alone is weak justification.

## Prefer evidence over fashion

Choose from repository/production constraints, product requirements, demonstrated scale/failure pressure, team supportability, ecosystem maturity, then stylistic preference—in that order.

Current official/upstream behavior overrides memory. Production evidence overrides an architecture diagram. Do not choose a technology because it is fashionable or familiar.

## Reason in second-order effects

Ask what a change newly makes possible to fail:

- retries -> duplicate effects and retry storms;
- caches -> invalidation, stale authority, hot-key/warm-up failures;
- service splits -> network failure and distributed consistency;
- concurrency -> DB/quota/thread/connection exhaustion;
- flags -> state combinations and dead branches;
- denormalization -> reconciliation/backfill obligations;
- extra replicas/regions -> failover authority and recovery complexity.

A design is incomplete if it accounts only for the intended benefit.

## Scale rigor with reversibility and blast radius

Use direct changes for local reversible behavior. Increase design/evidence rigor for money or irreversible effects, auth/tenant/privacy, persisted semantics, public contracts, distributed coordination, deployment/runtime identity, recovery paths, and many independently deployed consumers.

Prefer additive/reversible steps under uncertainty. A one-line default can be high risk; a large isolated refactor can be comparatively low risk.

Do not change a stable system when the benefit is unmeasured, the active owner is unknown, migration pressure is weak, scale assumptions are unproven, compatibility cannot yet be removed, or recovery is not credible. Evidence-backed no-change is a valid result.

## Preserve hidden compatibility

Ugly old code may encode real clients, old data, failed migrations, vendor quirks, incident workarounds, or manual operations.

Before removing it:

1. prove active callers and deployed consumers;
2. inspect tests/history/incidents and old data versions;
3. characterize observable behavior and failure semantics;
4. add telemetry or characterization where evidence is weak;
5. remove only after the compatibility contract is no longer needed.

Do not confuse poor style with dead behavior.

## Use prior failure patterns as hypotheses

Recognize recurring mechanisms—duplicate delivery, stale generations, unbounded queues, retry storms, stampedes, network calls in long transactions, version skew, time assumptions, hot partitions, leaked resources, shared mutable state, partial rollout, and missing auth scope—but never diagnose by analogy alone.

Use `failure-memory-antipatterns.md` to generate discriminating probes, then prove the local mechanism.

## Make uncertainty explicit

Separate what is:

- directly known from repository/runtime evidence;
- strongly inferred from mechanism;
- plausible but unverified;
- a product or authorization decision requiring human intent.

Seek the cheapest evidence that can change the decision. Do not use confidence theater to cover an unproven owner or contract.

Leave the system easier to operate and understand: improve correctness, security, debuggability, operability, performance/cost, changeability, compatibility, recovery, or ownership clarity without silently degrading the others. Give temporary mechanisms an owner and removal condition before they become permanent architecture.
