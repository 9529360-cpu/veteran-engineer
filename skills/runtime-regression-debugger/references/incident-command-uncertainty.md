# Incident Command and Decision-Making Under Uncertainty

Use this reference for active production incidents, severe regressions, data-integrity events, security-sensitive failures, or ambiguous outages where the cost of a wrong action is high.

## Optimize first for loss containment

During a severe incident, the priority order is usually:

1. protect people, data, money/value, credentials, and irrecoverable evidence;
2. stop expansion of the blast radius;
3. restore the most important user/operator contract in a reversible way;
4. preserve enough evidence to learn what happened;
5. only then optimize elegance, completeness, or root-cause certainty.

Do not delay safe mitigation merely to produce a satisfying explanation first.

## Establish incident truth

Record a compact live state:

- incident start/first-known-bad and detection time;
- affected users/tenants/regions/features;
- exact deployed versions/config/flags/schema/runtime;
- critical data/financial/security invariants at risk;
- current traffic/load/resource saturation;
- last known good state;
- changes near the onset, without assuming correlation is causation;
- mitigations already attempted and their observed effects.

Use one timeline and one current-state summary. Avoid parallel contradictory narratives.

## Work with bounded hypotheses

Maintain at most a few active hypotheses. For each, record mechanism, evidence for/against, cheapest discriminator, and what action becomes justified if true.

Separate:

- **observation**: directly measured;
- **inference**: best current explanation;
- **assumption**: unverified but necessary for action;
- **decision**: chosen action with owner/time/rollback criterion.

This prevents incident pressure from turning guesses into facts.

## Mitigation ladder

Prefer the smallest reversible action that protects the invariant:

`disable optional feature -> reduce concurrency/admission -> shed noncritical traffic -> pause problematic consumer/job -> route around failing dependency/cell -> revert config/flag -> rollback compatible release -> fail over with fencing -> emergency repair`

The exact order depends on the product. Data-loss/security/money risk may justify stopping writes even when availability falls.

Do not rollback automatically when the previous binary cannot understand the new schema/data or when an irreversible migration has crossed its boundary. Roll forward may be safer.

## Stop conditions

Before a risky mitigation, define what would make you stop/reverse it: rising error rate, invariant drift, replica lag, queue age, saturation, cross-tenant leakage, financial mismatch, or inability to reconcile.

Change one major variable at a time when possible. During severe instability, freeze unrelated deploys and broad refactors.

## Overload incidents

Treat retries, autoscaling, failover, cache misses, reconnects, and recovery traffic as potential load multipliers. Restoring a dependency to 100% traffic immediately can trigger a second outage.

Ramp recovery in cohorts while watching saturation and tail latency. Use `scripts/load_shed_budget.py` for rough admission math, then rely on live telemetry.

## Data and money incidents

If duplicate/lost/corrupt writes are possible, prioritize stopping further ambiguous mutation, preserving transaction logs/provider references, and establishing reconciliation scope. Do not run bulk repair until operation identity and duplicate protection are understood.

## Communication and decision log

Keep terse, timestamped decisions: what changed, why, expected effect, observed effect, next checkpoint. Communicate confirmed impact and mitigation status without presenting hypotheses as facts.

## Recovery criteria

Do not end the incident because dashboards turned green for a few minutes. Verify:

- black-box/user-visible contract;
- critical data/security/money invariants;
- queue/backlog and retry pressure trending to safe levels;
- replication/backup/observability protection restored;
- temporary bypasses, elevated privileges, disabled safeguards, or emergency flags are owned and scheduled for removal.

Then separate follow-up into root cause, contributing conditions, detection gaps, mitigation gaps, and systemic prevention. Avoid blame-oriented history rewriting.
