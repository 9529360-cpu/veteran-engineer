# Database Recovery, WAL/Binlog, and Durability Engineering

Use this reference when correctness depends on crash recovery, write durability, backup/restore, point-in-time recovery, replica promotion, corruption handling, or transaction-log retention.

## Start from the durability contract

State what an acknowledged write means for this system. Distinguish:

- accepted by the application;
- committed by the database transaction manager;
- written to an OS buffer/page cache;
- appended to WAL/binlog/redo;
- flushed to durable media according to the database/storage contract;
- replicated to one or more peers;
- visible to readers in the required topology.

Do not infer durability from HTTP success alone. Confirm the exact database, storage, replication, and synchronous-commit settings that define the acknowledgement boundary.

## Transaction logs are recovery machinery, not ordinary logs

For WAL/binlog/redo/transaction-log systems:

- identify the log sequence/position used for recovery and replication;
- understand checkpoint behavior and how much log must be replayed after crash;
- monitor log retention against replica/CDC/backup consumer lag;
- avoid deleting or recycling required logs before dependent consumers have durable checkpoints;
- distinguish logical replication/change capture from physical crash-recovery logs;
- treat log shipping, archive gaps, timeline/epoch changes, and promotion history as part of the recovery chain.

A replica that is healthy enough to serve reads is not automatically a valid promotion target for the required RPO.

## Backups and PITR

A backup strategy is incomplete until restore has been exercised.

Define:

`base backup/snapshot -> transaction-log archive -> restore -> replay to target -> integrity validation -> application reopen`

For every recovery path, know:

- backup scope and consistency boundary;
- encryption/key dependencies;
- retention and legal/data-residency requirements;
- transaction-log retention window;
- restore throughput and bottlenecks;
- point-in-time target semantics;
- dependency ordering across multiple databases/stores;
- post-restore secret/config/schema compatibility;
- application-level validation, not only database startup success.

Use `scripts/recovery_budget.py` for rough restore/replay/RTO arithmetic, then validate with measured restore exercises.

## Promotion and failover

Before promoting a replica or secondary:

1. establish the authoritative failure domain and current primary/epoch;
2. fence or prove the old writer cannot continue mutating authoritative state;
3. quantify known or possible replication loss;
4. promote exactly one intended authority;
5. redirect writers/readers deliberately;
6. re-establish backup/log shipping/replication from the new authority;
7. reconcile ambiguous operations around the failover window;
8. plan failback as a separate migration rather than a blind reverse switch.

Never solve split-brain risk by merely changing DNS.

## Corruption and partial recovery

When corruption is suspected:

- stop compounding writes if continuing could destroy recoverable evidence;
- preserve copies/snapshots/logs before destructive repair;
- identify whether corruption is logical, page/block-level, index-only, storage-level, or application-generated;
- prefer rebuilding derived structures such as indexes when authority remains intact;
- validate cross-row/domain invariants after repair;
- document unrecoverable intervals or records explicitly.

Do not run repair tools, truncate logs, or discard transaction history simply because they make the database start.

## Recovery evidence

Keep exact timestamps, log positions, backup identifiers, promotion epochs, recovery commands, checksums, validation queries, and observed RPO/RTO. Redact secrets and personal data.

A recovery is complete only when the user-visible contract and critical data invariants are verified, replication/backup protection is restored, and the system is no longer operating on a temporary unsafe topology.
