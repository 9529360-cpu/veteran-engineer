# Legacy modernization and long-lived system engineering

## Contents

- Treat legacy as a running contract, not a code-quality label
- Perform archaeology before redesign
- Characterize behavior before replacement
- Recover data semantics and integration boundaries
- Modernize by seam and capability
- Handle runtime and dependency end-of-life deliberately
- Preserve old/new coexistence
- Migrate data as a product operation
- Manage hidden batch, cron, and manual workflows
- Design for years of operation and eventual deletion

## Treat legacy as a running contract, not a code-quality label

A system is legacy when change risk and knowledge loss matter, not merely because its language or framework is old.

Do not assume a rewrite is justified by age. Stable old code may be cheaper and safer than a modern replacement. Modernize to solve concrete pressures such as unsupported runtime, security exposure, inability to change product behavior, operational instability, capacity limits, or ownership collapse.

## Perform archaeology before redesign

Recover:

- build/runtime versions and how they are actually deployed;
- entrypoints and active traffic paths;
- database schemas, triggers, stored procedures, jobs, and shared tables;
- cron/batch/manual operator workflows;
- external consumers and undocumented integrations;
- historical incident/revert areas;
- compatibility shims and why they were added;
- data encodings, collations, timezone conventions, identifier formats, null/sentinel semantics;
- backup/restore and disaster-recovery reality.

Use Git history, production telemetry, issue history, deployment manifests, and operator knowledge as evidence. Documentation may describe a system that no longer runs.

## Characterize behavior before replacement

When tests are weak, add characterization at stable boundaries before refactoring.

Capture representative:

- inputs/outputs;
- status/error semantics;
- authorization outcomes;
- side effects and ordering;
- data writes and defaults;
- odd but relied-upon edge cases;
- performance limits that clients implicitly depend on.

Golden/snapshot tests are acceptable as temporary characterization when the output is deterministic and reviewed. Do not freeze known security defects as desired behavior.

## Recover data semantics and integration boundaries

Old systems often use the database as an integration bus. Before splitting ownership, inspect:

- other applications reading/writing the same tables;
- triggers and stored procedures;
- direct reporting/ETL access;
- implicit foreign-key and sequencing assumptions;
- shared lookup tables;
- offline jobs that mutate state after the request path completes.

A service boundary drawn in code does not create a data ownership boundary automatically.

## Modernize by seam and capability

Prefer:

`characterize -> introduce seam -> route one capability -> compare -> move authority -> cut over -> remove old path`

Useful seams include:

- reverse proxy or route boundary;
- facade/adapter around an old API;
- database change-data capture or outbox, when justified;
- anti-corruption translation layer;
- parallel read with comparison;
- tenant/cohort traffic split;
- new write path with old read compatibility during migration.

Choose seams around product capabilities and state ownership, not arbitrary folder boundaries.

## Handle runtime and dependency end-of-life deliberately

For EOL language/framework/database/browser/runtime upgrades:

1. identify unsupported component and actual exposure;
2. record current build/runtime/toolchain exactly;
3. reduce unrelated behavior changes;
4. upgrade one compatibility boundary at a time when possible;
5. preserve reproducible old build for rollback/forensics until cutover is proven;
6. test real integrations, TLS/auth, serialization, time/date, database driver, and file/encoding behavior;
7. remove unsupported path only after production verification.

Do not combine a major runtime jump, ORM rewrite, database migration, UI rewrite, and deployment-platform move into one inseparable project unless external constraints force it.

## Preserve old/new coexistence

During migration, explicitly define which version combinations must work.

Build a matrix for:

- old client -> old server;
- old client -> new server;
- new client -> old server when rollout permits it;
- new producer -> old consumer;
- old producer -> new consumer;
- old app -> expanded schema;
- new app -> expanded schema.

Avoid persisted representations that old code cannot safely ignore during the coexistence window.

## Migrate data as a product operation

Treat large migrations as resumable operational workflows, not one SQL statement hidden in deploy.

Define:

- source authority;
- target authority;
- transform semantics;
- checkpoint/cursor;
- idempotency;
- rate limit and DB load budget;
- observability and progress;
- verification/reconciliation;
- pause/resume;
- cutover condition;
- rollback or forward-repair plan;
- cleanup/removal.

Sample and reconcile real production data shapes. Expect old malformed or partially migrated records.

## Manage hidden batch, cron, and manual workflows

Legacy correctness may depend on jobs nobody sees in the request path.

Inventory:

- cron/scheduler definitions;
- database jobs;
- queue consumers;
- filesystem drop folders;
- email-triggered processes;
- operator scripts;
- periodic exports/imports;
- finance/support reconciliation steps.

A modernization is incomplete if it replaces interactive traffic but forgets the overnight job that finalizes state.

## Design for years of operation and eventual deletion

Long-lived engineering includes lifecycle work:

- deprecation policy and telemetry for old clients;
- data retention/archive/deletion;
- index/table growth and partition maintenance;
- key/certificate rotation;
- dependency/runtime upgrade cadence;
- backup restore drills;
- runbook ownership;
- feature flag and compatibility-shim expiry;
- capacity review;
- disaster-recovery assumptions;
- end-of-life and data export/delete path.

Every temporary migration mechanism should have an owner and removal trigger. Temporary code without a removal condition is usually permanent code with worse documentation.
