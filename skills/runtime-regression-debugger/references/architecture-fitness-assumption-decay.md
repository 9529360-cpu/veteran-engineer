# Architecture Fitness and Assumption Decay

Use this when a system that was once reasonable is now slow, fragile, expensive, hard to change, or repeatedly failing at the same boundary.

## Architecture is a bet on assumptions

Every architecture is correct only under some assumptions:

- traffic and data scale;
- tenant count/skew;
- latency requirements;
- availability target;
- deployment topology;
- team/ownership boundaries;
- consistency requirements;
- dependency reliability/cost;
- regulatory/security constraints;
- expected product lifetime and change rate.

Problems often appear because reality changed while the architecture did not.

## Reconstruct the original bet

Before redesigning, infer the smallest likely assumptions from repository history, ADRs, deployment config, old incidents, schema shape, and former product constraints.

Do not mock an old design for failing requirements it was never built to satisfy.

## Compare assumptions to current evidence

Mark an assumption as:

- still valid;
- violated;
- approaching limit;
- unknown but decision-sensitive;
- intentionally accepted debt.

Quantify when possible: peak QPS, data size, hot-tenant ratio, replication lag, deploy frequency, on-call load, cloud spend, or recovery time.

## Distinguish local defect from architectural pressure

A violated assumption does not automatically justify a rewrite.

Ask whether the pressure can be removed by:

- strengthening one owner;
- adding a bounded index/cache/queue;
- partitioning one hot path;
- changing a contract;
- deleting obsolete compatibility;
- changing an operational limit;
- isolating one failure domain.

Prefer the smallest evolutionary move that restores margin.

## Use fitness functions where useful

A fitness function is a measurable property that should remain within bounds as the system evolves, such as:

- p99 latency;
- cross-tenant isolation violations = 0;
- restore time <= RTO;
- one authoritative writer per fact;
- dependency fan-out <= defined budget;
- migration lock time <= threshold;
- cost per job <= budget.

Automate only the few functions that guard material architectural properties.

## Avoid pendulum modernization and preserve decision memory

Architecture evolves by trading one failure surface for another: monoliths for networked services, synchronous chains for queues/workflows, shared data for distributed ownership, manual hosts for control planes, local caches for invalidation-heavy distributed caches. Do not swing to the historical opposite without identifying which assumption actually changed and what new failure modes the replacement buys.

For hard-to-reverse choices, preserve the decision context: original pressure, constraints, alternatives, trade-offs, migration path, operational owner, and a reevaluation trigger. When old code looks irrational, inspect history before deleting it; it may encode a retired outage, migration, client-version window, vendor bug, or product/regulatory constraint.

## Re-evaluate before major modernization

A rewrite can replace visible code while preserving the obsolete assumptions that caused the problem. State which assumptions change, what new failure modes appear, and how the migration proves the new architecture under real load.

Use `scripts/architecture_fitness.py` for explicit numeric/boolean assumption checks. It is a decision aid, not an architecture classifier.
