# Resilience, Disaster Recovery, and Multi-Region Systems

Use this reference when designing failover, backups, high availability, region redundancy, or recovery procedures.

## Start with failure domains and business objectives

Name the failures that matter: process, node, zone, region, database, identity provider, network partition, DNS/control plane, cloud account, operator error, bad deploy, data corruption, credential compromise, or third-party outage.

Define RTO and RPO per critical capability. "Highly available" without a recovery objective is not a design contract.

## Backups are not recovery

- Verify backup completeness, retention, encryption, access controls, and independence from the primary failure domain.
- Regularly restore into an isolated environment and validate application-level invariants, not just that files can be read.
- Know restore throughput; multi-terabyte recovery may violate an assumed RTO even when backups are valid.
- Preserve runbooks and credentials needed during the failure of normal identity/control-plane systems.

## Failover is a state transition

For every failover path define:

1. detection criteria and false-positive tolerance;
2. who/what is allowed to initiate failover;
3. old-primary fencing;
4. traffic shift/discovery behavior;
5. data-loss/replication-lag implications;
6. queue/job ownership during transition;
7. external callbacks/webhooks and duplicate effects;
8. verification of the new authority;
9. failback/reconciliation procedure.

Automated failover can reduce RTO while increasing the risk of split brain if authority is ambiguous.

## Multi-region trade-offs

- Prefer one write authority when the domain cannot tolerate ambiguous conflicts.
- Active-active writes require explicit conflict semantics, globally stable identities, and reconciliation behavior; geographic replication alone does not provide them.
- Account for latency between regions in synchronous protocols.
- Keep tenant/data residency and encryption-key boundaries explicit.
- Price duplicated infrastructure, operational testing, deployment coordination, and incident complexity before choosing multi-region active-active.

## Degraded modes

Design what the product does when a dependency or region is partially unavailable: read-only, queued writes, stale reads with disclosure, reduced features, bounded retry, or explicit outage. A graceful degraded mode must preserve critical invariants.

## Game days

Exercise realistic failures with rollback and safety controls: kill an instance, deny a dependency, inject latency, pause a queue, fail a replica, expire credentials, restore a backup, and rehearse regional traffic shift where authorized. Record gaps as engineering work, not merely runbook notes.
