# Project Takeover Engineering

Use this when entering an unfamiliar, large, polyglot, generated-code-heavy, or troubled repository, or when asked to own a system without a guided tour.

When a plugin/runtime backend is available and the operator provides an authorized Git URL instead of a local checkout, use its bounded remote project acquisition path rather than asking for a manual clone. Treat the acquired checkout as current source authority, not durable architectural memory, and refresh repository truth before consequential work.

## Contents

- Start from the operating contract
- Prove repository identity before mutation
- Build the minimum project model
- Navigate by questions and high-value anchors
- Recover the active path before the architecture story
- Prove liveness and distinguish source from generated code
- Locate authoritative state and mutation rights
- Search sideways for hidden consumers
- Find hidden coupling and historical hotspots
- Separate code topology from runtime topology
- Map workspace and build-graph boundaries
- Recover validation and release topology
- Rank unknowns by decision impact
- Choose the first evidence-producing change
- Gate the first consequential mutation
- Avoid takeover anti-patterns
- Know when the project model is good enough

## Start from the operating contract

Do not begin by reading the repository from top to bottom. Establish the smallest contract that explains why the relevant system exists and what current work must preserve.

Capture:

- primary actor or operator;
- user-visible or operator-visible intent;
- authoritative state transition;
- durable and externally visible postconditions;
- important failure/recovery behavior;
- compatibility obligations already deployed.

If the request is a bug, narrow this to the failing transition. If it is a feature, narrow it to the shortest complete vertical slice. If it is a rescue, identify contracts whose failure creates the most user, data, money, or operational harm.

## Prove repository identity before mutation

Before the first write in a task, prove that the repository being inspected is the repository the user currently authorized. Use the strongest available identity signals: explicit owner/name or repository URL from the current request, checkout root, Git remote origin or repository ID, and live default branch/remote HEAD when available.

Treat conversational carry-over as a navigation hint, not repository identity. If a prior task, another open checkout, or a similarly named project points at a different repository, discard its branch names, PR numbers, SHAs, CI runs, file ownership assumptions, and release state until they are independently re-established for the current target.

If the explicit current target and the active checkout/connector disagree, switch or reopen the correct repository before mutation. Do not patch the wrong repository merely because its file names, architecture, or recent task history look familiar.

## Build the minimum project model

Recover only the model needed for the next safe engineering decision. Prefer six compact maps over a giant architecture document:

1. **Entry map** - routes, commands, handlers, jobs, consumers, or processes that can start the relevant behavior.
2. **Authority map** - which component may authoritatively change each important fact.
3. **Data map** - stores, schemas, caches, indexes, projections, queues, and external systems involved.
4. **Runtime map** - deployables, processes, workers, regions, containers, browser/mobile shells, and version coexistence.
5. **Validation map** - unit, contract, integration, E2E, smoke, canary, and production evidence that can falsify a change.
6. **Delivery map** - build artifacts, migrations, flags, promotion order, rollback/forward repair, and production verification.

Do not create documentation merely to feel oriented. Each map must answer a decision that affects implementation, validation, rollout, or risk.

## Navigate by questions and high-value anchors

Every repository search should answer a live engineering question. Maintain a small search frontier instead of collecting context broadly.

Prefer this ladder:

`user-visible entry -> registration/binding -> active caller -> authoritative owner -> durable/external effect -> projection -> validation -> delivery`

High-information anchors include:

- route, command, event, RPC, CLI, or UI action name;
- public request/response field or machine-readable error code;
- table/entity/event/job name;
- feature flag or configuration key;
- failing stack frame, log correlation, trace span, or test name;
- symbol named in a recent relevant commit.

From an anchor, search outward one ownership hop at a time.

Keep candidate paths in three buckets:

- **active** - can change the next decision now;
- **conditional** - inspect only if the current owner/hypothesis survives;
- **background/dead** - generated copies, vendored code, obsolete paths, stale docs, or unrelated modules not linked to the active contract.

Promote a candidate only when evidence crosses a boundary.

## Recover the active path before the architecture story

Architecture documents describe intent. Active callers and runtime behavior describe truth.

Prove the path by following:

`entry -> caller -> owner -> state transition -> persistence/side effect -> projection -> visible result`

For each hop, look for liveness evidence in this rough order:

1. registration/import/wiring;
2. active callers;
3. runtime config/manifest;
4. tests that exercise the path;
5. traces/logs/profiles tied to the exact build;
6. recent history when path ownership changed.

Treat orphaned files, old service names, disabled flags, unused workers, abandoned migrations, and similarly named implementations as hypotheses until liveness is proven.

## Prove liveness and distinguish source from generated code

Before editing a matching file, determine whether it is:

- authoritative handwritten source;
- generated output;
- vendored dependency;
- build artifact;
- copied schema/client binding;
- migration snapshot;
- fixture or test-only representation.

Patch the generator or source-of-truth contract when generated output is derivative. Regenerate and review derived changes rather than hand-editing them unless the repository explicitly treats generated output as authored source.

File-name similarity is weak evidence. Do not assume `ExportService`, `UserClient`, or an old migration path is active because it looks semantically right.

## Locate authoritative state and mutation rights

Most expensive regressions are ownership mistakes disguised as local bugs.

For every important fact, ask:

- who may create it;
- who may mutate it;
- who may delete or expire it;
- who only derives or caches it;
- how concurrent writers are resolved;
- how stale generations are fenced;
- how failed partial updates are reconciled.

Mark any fact with more than one uncoordinated authoritative writer as a risk hotspot. Mark any cache/projection that can silently become an alternate source of truth as a likely incident boundary.

## Search sideways for hidden consumers

After finding the writer or public contract, search for consumers filename-local reasoning can miss:

- workers and delayed jobs;
- mobile/desktop/CLI clients;
- event subscribers and webhooks;
- caches, search indexes, projections, analytics, or CDC;
- generated SDKs and schema bindings;
- migrations/backfills and compatibility readers;
- tests/fixtures encoding old behavior;
- deployment/config/flag definitions.

Search by contract names, event types, durable fields, stable IDs, and machine-readable error codes, not only implementation class names.

## Find hidden coupling and historical hotspots

Use Git history as triage evidence when the system is old, surprising, or repeatedly patched.

Look for:

- files that change together unusually often;
- bug-fix commits repeatedly touching the same transition;
- compatibility code with no obvious current owner;
- migrations or flags that never reached contraction/removal;
- manual runbooks compensating for missing automation;
- tests whose setup reveals hidden ordering or global state;
- temporary adapters that became permanent boundaries.

Escalate to archaeology when weird code protects an unexplained edge case, multiple implementations look active, regression timing matters, or deletion/refactor would remove old behavior. Use history to recover the pressure and contract, never to copy a prior patch mechanically or infer blame.

## Separate code topology from runtime topology

A monorepo can contain many independent deployables. A microservice-looking repository can still ship as one process. Never derive failure domains from folder names.

Recover:

- what is built together;
- what is deployed independently;
- what may run at different versions simultaneously;
- what shares a DB, cache, queue, filesystem, identity, quota, or network boundary;
- what can fail or roll back independently;
- what production routing actually sends traffic to.

Version coexistence is part of the contract whenever deployments are rolling, clients are long-lived, jobs are delayed, or data outlives code.

## Map workspace and build-graph boundaries

For monorepos and multi-package workspaces, recover the graph that actually controls change impact before running broad builds or editing shared packages.

Map only what the task needs:

- workspace/package roots and package-manager ownership;
- build/task graph and cache boundaries;
- source packages versus generated packages/artifacts;
- public/internal package contracts and versioning rules;
- deployables produced from each package or target;
- affected-test/build selection and any remote cache assumptions;
- code generation edges such as schema -> SDK -> consumers;
- cycles or shared utility packages that create wide fan-out.

Treat pnpm/yarn/npm workspaces, Nx/Turborepo, Bazel, Gradle composite/multi-project builds, Cargo workspaces, Go workspaces, and similar systems as graph managers, not architectural truth. Confirm the active graph from current manifests/config and repository-native tooling.

When a shared package changes, distinguish compile-time fan-out from runtime/deployment fan-out. Prefer affected targets and representative boundary tests before an expensive whole-repository build when they can falsify the change. Run the full required repository gates before completion when policy requires them.

Do not hand-edit generated packages or cached outputs. Find the authoritative generator/schema, regenerate with the repository-native command, and review both source and derived diffs.

## Recover validation and release topology

Before the first edit, know how a hypothesis can be falsified and how a candidate could safely move toward production.

Identify:

- fastest focused test for the owner;
- real integration boundary;
- representative E2E or black-box check;
- exact build/artifact identity;
- release trigger and version authority: merge, tag, manual dispatch, bot, or external publisher;
- automation that can create follow-up commits/tags/releases or publish/deploy after the trigger;
- migration and flag ordering;
- required versus optional checks;
- rollback limitations after durable state changes;
- production signals that prove the user contract rather than only infrastructure health.

Do not wait until implementation is finished to discover that meaningful validation requires an unavailable environment. For release work, treat every merge/push/tag/dispatch/promotion as invalidating the earlier release snapshot and re-read the authoritative remote state before deciding the next mutation.

## Rank unknowns by decision impact

Classify unknowns as:

- **blocking** - different answers materially change behavior, security, data, money, or irreversible decisions;
- **high-value** - affects owner selection, failure model, compatibility, or validation strategy;
- **deferrable** - affects polish or implementation detail but not the safe decision;
- **irrelevant** - does not affect the current contract.

Resolve blocking and high-value unknowns with the cheapest evidence source. Do not ask the user to answer repository-discoverable questions merely to reduce model uncertainty.

## Choose the first evidence-producing change

The first change in an inherited system should reduce uncertainty as well as move the product forward.

Prefer:

- a characterization/regression test around the failing contract;
- instrumentation at the true transition boundary;
- a narrow owner correction;
- an additive compatibility seam;
- a small migration cohort;
- a reversible feature flag only when it reduces real rollout risk.

Avoid starting with broad rewrites, framework upgrades, service splits, database replacements, or stylistic cleanup unless evidence already proves they are necessary.

## Gate the first consequential mutation

When takeover uncertainty is material, encode the pre-mutation model in a small JSON manifest and run the deterministic readiness check before the first consequential write:

`python3 scripts/takeover_readiness_gate.py <takeover.json> --json`

Treat this as a fail-closed planning aid, not as proof that the supplied evidence is true. Bind manifest claims to live repository evidence and exact identities.

Capture at least:

- the authorized and observed repository identities, default branch/revision, and strong identity evidence;
- the actor/intent/transition/postconditions/failure-recovery/compatibility contract;
- entry, authority, and validation maps, plus data/runtime/delivery maps when applicable (otherwise record why they are not applicable);
- one live active path from entry through authoritative effect to visible result, with liveness evidence;
- the intended mutation path, its authoritative-source classification, and its source-of-truth relationship;
- material companion consumers that may need compatible changes;
- blocking, high-value, and deferrable unknowns;
- a narrow first-change kind, bounded expected write set, falsifier, and rollback/recovery path;
- the focused oracle, real integration boundary, exact validation identity, and repository-native required gates;
- a fresh parallel-work collision check and an explicit strategy for any overlaps.

The readiness gate should block mutation when repository identity disagrees, the live path is unproven, the target is generated/derived rather than authoritative, a decision-changing unknown remains unresolved, the first step is an unbounded rewrite, a falsifying validation path is missing, or parallel work has not been checked.

A passing manifest means the takeover model is structurally ready for the next bounded action. It does not certify architecture truth, test adequacy, or implementation correctness; those remain evidence obligations during execution.

## Avoid takeover anti-patterns

Do not:

- read thousands of files without a question;
- trust README architecture over active registration/callers;
- rename or reorganize before understanding compatibility;
- treat every TODO as current debt;
- delete weird code before checking history and deployed consumers;
- create a second architecture map that immediately drifts from repository truth;
- force the project into preferred framework vocabulary;
- ask the user to drive ordinary repository navigation;
- confuse broad context collection with progress.

## Rescue a troubled system before redesigning it

When ownership is unclear, incidents recur, dependencies sprawl, or changes break unrelated paths, stabilize before redesigning: identify the few contracts that must survive, freeze unrelated churn, map authoritative state/write paths/queues/manual jobs/external effects/deployables, and add characterization evidence around dangerous seams. Remove or isolate the highest-amplification failure mechanism first.

Rebuild boundaries from mutation ownership, not diagram aesthetics. Prefer reducing cross-owner edges before adding abstractions. A useful rescue sequence is `characterize -> contain -> establish authority -> create seam -> migrate one cohort -> compare -> move ownership -> delete old path -> simplify operations`. Measure success by reduced incident recurrence, change failure, manual toil, recovery time, and unnecessary state/edge count—not by rewrite percentage.

## Know when the project model is good enough

Stop mapping and start acting when you can answer, with evidence strong enough for the risk:

- What exact contract is changing or failing?
- Which live path carries it?
- Where is authoritative state changed?
- Which material consumers or companion responsibilities exist?
- Which boundaries can fail independently?
- What compatibility window exists?
- What is the cheapest falsifier for the leading hypothesis/design?
- What test/runtime evidence can prove the candidate?
- What is reversible, and what becomes hard to reverse after state changes?

Repository search is complete enough when remaining unknowns cannot change the next safe action. A takeover model is not complete when every subsystem is understood; it is complete enough when unbounded exploration is no longer required for the next decision.
