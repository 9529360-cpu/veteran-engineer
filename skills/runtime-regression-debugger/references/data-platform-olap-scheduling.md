# Data Platform, OLAP, and Large-Scale Scheduling

Use for warehouses/lakes/lakehouses, ETL/ELT, batch DAGs, analytical serving, compaction, partition maintenance, or large fleet schedulers.

## Separate analytical from transactional contracts

Define freshness, completeness, reproducibility, late-data policy, schema evolution, retention, privacy/deletion, and acceptable recomputation cost. Do not import OLTP consistency assumptions into an eventually refreshed analytical system.

## Data layout matters

Reason about partition pruning, clustering/sort keys, small-file/segment explosion, compaction, skew, join cardinality, shuffle, spill, and scan amplification before adding compute.

## Scheduling is resource allocation

For large DAGs/fleets, model dependencies, retries, backfills, priorities, quotas, starvation, preemption, locality, and downstream bottlenecks. A scheduler that admits more work than storage/database/API capacity permits only moves the queue.

## Backfills are production traffic

Throttle and isolate them. Make checkpoints/resume deterministic, preserve lineage/version, and prevent a historical recomputation from overwhelming the live path.

## Reproducibility and lineage

Record source version/range, code/config version, schema, and output identity for material data products. Make repair/reprocessing explainable rather than relying on ad-hoc reruns.
