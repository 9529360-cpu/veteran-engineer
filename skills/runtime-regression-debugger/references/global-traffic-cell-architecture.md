# Global Traffic, Cells, and Failure Containment

Use this reference for global routing, multi-region active/active designs, cell architectures, or blast-radius reduction.

## Separate control plane and data plane

- Identify which operations require a globally available control plane and which already-authorized data-plane work can continue during control-plane degradation.
- Avoid making every request synchronously depend on a global coordinator unless the invariant truly requires it.
- Cache or distribute configuration only with explicit version/freshness/fail-safe semantics.

## Route by ownership and failure domain

- Make routing keys explicit: user, tenant, account, shard, region, or resource owner.
- Preserve session/data affinity when crossing regions would violate consistency, latency, residency, or cost expectations.
- Treat GeoDNS/anycast/global LB changes as control-plane propagation with stale clients/resolvers, not instantaneous switches.
- Budget cross-region egress and dependency latency; distant synchronous dependencies turn a regional design into a global failure path.

## Cell architecture

- Use cells when reducing blast radius/tenant coupling is worth duplicated operational surfaces.
- Define cell size, placement, routing, capacity reserve, failure isolation, upgrade cadence, and tenant movement semantics.
- Keep global dependencies few and intentionally hardened; a shared global database or auth bottleneck can erase cell isolation.
- Test one-cell overload/failure and prove healthy cells continue serving normally.

## Active/active caution

- Multi-writer designs require explicit conflict/ownership semantics for every mutable fact.
- Prefer home-region/single-writer ownership when business semantics do not justify conflict resolution complexity.
- If conflicts are allowed, define domain reconciliation; "last write wins" can destroy business invariants even when technically convergent.
- Treat failover as authority transfer with fencing, not merely traffic movement.

## Global incident discipline

- Preserve per-region/cell telemetry so fleet averages do not hide localized failure.
- Keep emergency routing controls simple, tested, access-controlled, and auditable.
- Define evacuation and re-entry criteria before incidents; failback is often riskier than failover.
- Rehearse dependency isolation, region loss, control-plane loss, and partial network partitions at bounded scope.
