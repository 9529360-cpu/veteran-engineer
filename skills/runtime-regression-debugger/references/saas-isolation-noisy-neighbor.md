# Large SaaS Isolation and Noisy-Neighbor Engineering

Use this reference when a shared SaaS platform must isolate tenants across correctness, security, performance, capacity, failure domains, and operations.

## Isolation is multi-dimensional

For every shared subsystem, classify isolation for:

`identity/auth -> data -> cache -> compute -> DB pool -> queue/workflow -> external quota -> rate limit -> observability -> backup/restore -> support tooling -> deployment/cell`

A tenant ID column in the database is not a complete isolation strategy.

## Security isolation

Enforce tenant/resource authorization at trusted boundaries and scope queries, caches, object keys, jobs, signed URLs, audit events, and administrative tooling. Negative cross-tenant tests are required for sensitive paths.

Avoid support/admin shortcuts that bypass normal scope without strong audited authorization and explicit environment controls.

## Performance isolation and fairness

One tenant can dominate shared resources through high request rate, large objects, expensive queries, fanout, queue volume, cache churn, or third-party calls.

Use combinations of:

- per-tenant admission/concurrency/rate budgets;
- weighted fairness or reserved capacity;
- query/work size limits;
- queue partitioning or fair scheduling;
- pool partitioning only where justified by utilization/cost;
- cell/shard placement for very large tenants;
- bulk-work throttling and off-peak execution.

Do not create one dedicated stack per tenant by default; isolation strength must justify the operational and cost multiplier.

## Blast radius and cells

At scale, consider cells/stamps where a bounded set of tenants share a failure domain. Keep global control-plane dependencies out of hot request paths where possible. Design tenant placement/movement with explicit source/destination ownership and resumable data movement.

A cell strategy fails if a single global DB, cache, queue, identity dependency, or deploy coordinator still makes every cell fail together.

## Tenant lifecycle

Treat provisioning, suspension, plan changes, region moves, export, key rotation, restore, and deletion as explicit state machines. Large-tenant moves are migrations: preserve compatibility, dual-read/write only when necessary, reconcile, cut over, and remove old ownership.

Deletion must cover primary data, derived indexes/caches, object storage, queued work, backups according to retention policy, credentials, and external integrations.

## Observability

Track tenant-aware usage and saturation using privacy-safe identifiers and bounded cardinality. Preserve both fleet-wide and heavy-hitter views so one abusive or pathological tenant cannot hide inside averages.
