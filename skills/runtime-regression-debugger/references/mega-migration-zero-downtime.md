# Zero-Downtime Large-Scale Migration

Use this reference when moving large datasets, partition schemes, APIs, queues, stores, or services while production remains live.

## Treat migration as a state machine

Use explicit phases such as:

`prepare -> dual-compatible -> backfill/copy -> shadow/compare -> catch up -> cutover cohort -> observe -> expand -> contract`

- Give every phase entry criteria, exit criteria, metrics, rollback/forward-fix path, and owner.
- Never rely on one long script with no checkpoint as the migration authority.

## Compatibility first

- Deploy readers/writers that tolerate old/new representation before changing persisted data or routing.
- Ensure independently deployed old clients/workers remain safe for the actual rollout window.
- For dual writes, define which write is authoritative and how divergence is detected/repaired; temporary dual-write is not a consistency model.
- Prefer shadow reads/compare paths that cannot mutate production state.

## Backfill engineering

- Partition work into resumable chunks with stable checkpoints and idempotent application.
- Throttle against production SLOs, replication lag, DB/IO/queue headroom, and destination compaction/indexing.
- Handle deletes/tombstones and records changing during copy; "copy once" is rarely enough for live data.
- Estimate completion from sustained observed throughput, not best-case benchmark throughput.

## Cutover

- Migrate cohorts/waves where possible instead of all tenants/traffic simultaneously.
- Define one authoritative routing bit/version and make changes auditable.
- Watch domain parity, error rate, latency, lag, saturation, and support signals per cohort.
- If rollback requires copying new writes back, prove that path before cutover; otherwise label the step forward-only.

## Verification and cleanup

- Verify business invariants, not only row/document counts.
- Keep reconciliation running through the observation window.
- Remove old readers/writers, flags, queues, indexes, replicas, schemas, and dashboards only after no live dependency remains.
- Preserve enough migration metadata for later forensic questions without retaining sensitive payloads unnecessarily.
