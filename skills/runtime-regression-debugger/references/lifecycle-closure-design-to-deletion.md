# Lifecycle Closure and Design-to-Deletion

Use this when adding a persistent resource, compatibility path, feature flag, queue, cache, index, scheduled job, shadow pipeline, migration bridge, temporary dual read/write, or other mechanism that can outlive the change that introduced it.

## Every beginning needs an ending

For every new mechanism model:

`create -> operate -> observe -> degrade/fail -> recover -> upgrade -> retire/delete`

If one of these phases is impossible or has no owner, the design is incomplete.

## Temporary mechanisms are guilty until deleted

Temporary architecture tends to become permanent architecture.

For a temporary mechanism define at creation time:

- why it exists;
- owner;
- start condition;
- exit condition;
- evidence that makes deletion safe;
- expected review/expiry date when meaningful;
- exact removal order;
- fallback if deletion exposes hidden consumers.

"Remove later" is not a lifecycle plan.

## Close resource lifecycle

For created resources identify:

- allocation/create path;
- ownership and scope;
- cleanup/release path;
- crash/restart cleanup semantics;
- orphan detection;
- capacity/retention bound;
- observability;
- shutdown behavior.

Examples include sessions, temp files, object-store blobs, locks/leases, sockets, workers, browser profiles, DB rows, indexes, queues, and credentials.

## Close data migration lifecycle

For dual-path migrations define:

- source authority during each phase;
- backfill/catch-up ownership;
- shadow comparison;
- cutover criterion;
- rollback/forward-repair semantics;
- old writer/read path disablement;
- old schema/data deletion proof.

The migration is not complete while nobody knows when the compatibility path can be removed.

## Delete proof before delete action

Before destructive cleanup prove absence of required consumers or recovery dependencies through the strongest available evidence: code search, runtime usage, metrics, inventory, support window, old-client adoption, retention policy, or dry-run enumeration.

Silence in one log stream is not proof of no dependency.

## Simplify whole components intentionally

Treat every deployable, datastore, queue, cache, index, flag, protocol, region, framework, and compatibility layer as recurring ownership/upgrade/security/on-call cost. Look for pass-through services, low-value caches, unnecessary queues, unread projections, expired flags, completed dual paths, zombie jobs, retired-version branches, and abstractions with no credible second consumer.

Before removing a component, prove no active caller/consumer/job/tenant/version or recovery dependency still needs it using code plus runtime/config/history evidence. Remove the whole operational surface—credentials, DNS, queues/topics, dashboards, alerts, infrastructure, retained data, and ownership docs—rather than leaving zombie resources. Merge or centralize only when doing so does not destroy a useful ownership, scale, security, or failure-domain boundary. Record what future pressure would justify reintroducing the complexity.

## Prefer deletion over permanent branching

After stabilization, remove obsolete flags, adapters, duplicate stores, dead queues, shadow pipelines, compatibility readers, and investigation scaffolding when evidence supports it.

Deletion reduces future state space and operational combinations. Keep a mechanism only when it still serves an explicit contract.

Use `scripts/lifecycle_closure_gate.py` to expose missing owner/observe/recovery/shutdown/removal fields in a structured lifecycle manifest.
