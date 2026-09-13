# Cross-Repository Contract Mesh and Execution

Use this when one user-visible change crosses independently versioned repositories, services, clients, workers, schemas, generated SDKs, or infrastructure definitions. Model both compatibility and the execution sequence needed to deliver the contract safely.

## Contents

- Think in contracts, not repository boundaries
- Enumerate mixed-version cells
- Choose rollout direction from compatibility
- Convert the contract mesh into an execution graph
- Separate implementation, merge, and deployment order
- Bind shared contracts to exact versions
- Keep authority singular across repositories
- Avoid distributed half-fixes
- Treat CI boundaries as evidence boundaries
- Preserve independent cross-repo evidence
- Track temporary compatibility debt

## Think in contracts, not repository boundaries

A repository is a packaging boundary, not necessarily a product, consistency, or rollout boundary.

Map the actual chain:

`producer -> contract -> consumer -> durable state -> async consumer -> visible outcome`

Identify which component owns the fact and which components merely transform, cache, project, or transport it.

For each participating repository or deployable capture, when material:

- exact source/base/head identity;
- contract or authoritative responsibility owned there;
- required source/schema/config/generated changes;
- producers/consumers affected;
- compatibility requirement before and after deployment;
- strongest available validation;
- artifact/package/schema version identity;
- rollout position and rollback/forward-repair constraint.

## Enumerate mixed-version cells

If producer and consumer deploy independently, assume old and new versions can overlap.

At minimum reason about:

- old producer -> old consumer;
- old producer -> new consumer;
- new producer -> old consumer;
- new producer -> new consumer.

Add persisted old/new data, event, schema, or generated-client versions when durable formats survive deployments.

A design that works only when every repository deploys atomically is unsafe unless atomic deployment is actually guaranteed and proven.

## Choose rollout direction from compatibility

Consumer-first is often safer when the new producer would emit data an old consumer cannot read.

Producer-first can be safe when additions are backward compatible and old consumers demonstrably ignore or tolerate them.

When neither direction is safe, introduce a compatibility seam, explicit version, shadow path, or controlled lockstep rollout with a proven recovery plan.

For every rollout step ask:

- which old/new producer-consumer combinations exist now;
- which persisted old/new data or event versions may still exist;
- which delayed jobs, desktop/mobile clients, or offline consumers can outlive deployment;
- what happens if rollout stops at this exact step;
- whether rollback restores code only or also requires data/state repair.

## Convert the contract mesh into an execution graph

After compatibility is understood, write the dependency order for implementation and rollout.

A common sequence is:

`authoritative schema addition -> regenerate exact SDK -> deploy tolerant consumer -> deploy producer -> observe -> enable client -> retire compatibility path`

Plan by authority and compatibility, not by team or repository ownership.

The graph should make explicit:

- prerequisites between repositories;
- generated artifact/version dependencies;
- compatibility proof required before the next step;
- points where durable state becomes forward-only;
- stop/recovery behavior if execution pauses mid-program.

## Separate implementation, merge, and deployment order

The order in which code is written or merged is not necessarily the order in which artifacts must be deployed.

For substantial cross-repo work, state separately:

- **implementation order** - dependencies needed to create and validate source changes;
- **merge/publication order** - when shared schemas, packages, SDKs, or artifacts become available;
- **deployment/exposure order** - when independently deployed actors may begin relying on new behavior.

A repository can be merged early but deployed late. Do not let branch chronology imply rollout safety.

## Bind shared contracts to exact versions

For shared schemas, SDKs, generated clients, protobuf/OpenAPI/GraphQL bindings, package versions, or image tags:

- identify the authoritative source;
- regenerate from the exact contract/source identity;
- review generated semantic changes;
- ensure consumers pin or resolve the intended artifact;
- avoid assuming `latest`, a mutable branch, or an unpinned generator produces a reproducible rollout.

One repository being green does not prove another consumed the intended generated artifact.

## Keep authority singular across repositories

Do not solve coordination by creating synchronized copies that can both become authoritative.

For each important fact name:

- authoritative owner;
- contract/schema version;
- writer(s);
- readers/consumers;
- reconciliation owner if projections can lag;
- migration/cutover owner.

If authority intentionally moves, make the handoff phase explicit and fence stale writers.

## Avoid distributed half-fixes

When implementation across accessible repositories is authorized, complete every reversible repository-local change required for the contract rather than fixing one side and merely documenting an obvious companion in another accessible repo.

Stop only at a real boundary:

- missing repository/tool access;
- unresolved product semantics;
- unavailable credentials/environment;
- consequential remote mutation not authorized;
- deployment or production action beyond authorization.

Report the exact remaining boundary instead of calling the program complete.

## Treat CI boundaries as evidence boundaries

One repository's green CI cannot prove another repository's caller behavior.

Use, as risk requires:

- contract fixtures;
- generated schema/client diffs;
- replay against pinned producer/consumer versions;
- integration environments;
- migration fixtures with old/new readers;
- exact package/image versions;
- deployment/canary evidence when authorized.

Tie evidence to the exact source and artifact identities under test.

## Preserve independent cross-repo evidence

For each changed repository retain local evidence plus evidence for the contracts between repositories.

Do not let a monorepo-style aggregate test hide independently deployed version combinations, and do not let isolated unit suites substitute for contract compatibility.

Use `scripts/contract_mesh_check.py` when a structured compatibility/execution declaration is useful. The gate checks declared completeness; actual compatibility still requires representative evidence.

## Track temporary compatibility debt

Adapters, dual writers, version translators, shadow consumers, compatibility readers, flags, and bridges need from the start:

- owner;
- reason;
- observable removal condition;
- earliest safe removal point;
- proof required before deletion.

Cross-repo migrations are incomplete until old compatibility cells are intentionally retired or formally supported.
