# Hyperscale Partitioning, Hotspots, and Rebalancing

Use this reference when one node/partition/tenant/key range can become the bottleneck or when scale requires partitioning.

## Start from the access pattern

- State the partitioned invariant, dominant read/write paths, locality needs, and acceptable scatter/gather fanout before choosing a key.
- Estimate logical throughput, physical write amplification, storage, item count, growth, and hottest-key behavior separately; averages hide hotspots.
- Prefer a partition key that distributes the dominant write path without destroying the dominant read path.
- Treat tenant ID, customer ID, time, geography, and entity ID as different locality/fairness choices, not interchangeable hash inputs.
- Avoid embedding a shard count permanently into public IDs unless future movement is intentionally part of the contract.

## Separate logical and physical partitioning

- Prefer stable logical buckets/virtual shards when future placement changes are likely; map them to physical nodes independently.
- Keep routing metadata authoritative, versioned, observable, and recoverable; stale routing is a correctness problem, not only a cache miss.
- When placement changes, define whether old/new owners may overlap, which owner accepts writes, and how stale writers are fenced.
- Do not depend on modulo-N routing when N must change without massive reshuffling unless the migration cost is intentionally accepted.

## Design for skew

- Model heavy hitters explicitly: hottest tenant, key, time window, queue, or partition may be 10x-1000x the average.
- Prefer per-tenant/per-key rate controls and work isolation before blindly increasing fleet-wide capacity.
- For monotonic/time-based keys, inspect right-edge hotspot behavior and index/page contention.
- For high-fanout reads, budget fanout count, tail amplification, partial failure, cancellation, and merge cost.
- Replication improves availability/read scale but does not automatically solve a single hot write owner.

## Rebalance deliberately

- Treat rebalancing as production traffic plus data copy plus cache warming plus replication work.
- Bound move concurrency and bandwidth so recovery does not consume the headroom needed to serve users.
- Make movement resumable and idempotent with explicit source/target/checkpoint state.
- Verify writes during movement, tombstones/deletes, late replicas, and ownership cutover; copying only live rows is insufficient.
- Measure rebalance ETA from real transfer/scan/apply rates and include index/replay/verification overhead.
- Define the failure case where the source dies halfway through movement.

## Shard-count decisions

- Prefer enough partitions to distribute load and allow future placement flexibility, but not so many that metadata, compaction, file descriptors, recovery, and fanout dominate.
- Keep per-partition recovery time within the service's recovery objective.
- Reserve spare placement capacity; a cluster at full placement utilization has nowhere safe to fail over or rebalance.
- Revisit partition strategy when workload shape changes, not only when aggregate size crosses a threshold.

Use `scripts/shard_budget.py` for rough arithmetic, then verify against the actual store's partitioning, replication, compaction, and failover semantics.
