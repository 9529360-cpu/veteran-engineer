# Staff-level engineering execution

Use this for consequential work spanning several owners, deployables, teams, repositories, or long-lived migration phases. Keep the program coherent without turning routine changes into architecture exercises.

## Contents

- Frame the system problem
- Resolve uncertainty before multiplying plans
- Plan by dependency and contract
- Separate reversible from hard-to-reverse decisions
- Prove the risky boundary with a thin slice
- Budget scale, latency, availability, and cost
- Design rollout and operational ownership with implementation
- Stop and report precisely

## Frame the system problem

Before choosing files, compress the work into:

`product/operator contract -> current authority -> invariant -> dependency boundaries -> compatibility window -> failure model -> rollout/recovery constraint`

Add only decision-changing context:

- security/tenant boundaries;
- scale/latency/cost constraints;
- independently deployed producers/consumers;
- irreversible data or external effects;
- temporary compatibility mechanisms;
- unresolved assumptions.

Do not write a design document for a local reversible edit. The frame exists to prevent several locally correct changes from producing one incoherent system.

## Resolve uncertainty before multiplying plans

Classify unknowns:

- **repository-answerable** - callers, schemas, flags, tests, codegen, build/release topology;
- **runtime-answerable** - deployed versions, logs/traces/metrics, traffic/data scale, live configuration;
- **external-answerable** - vendor/framework semantics, quotas, support windows;
- **product-answerable** - desired behavior where repository/runtime evidence contains no safe precedent.

Resolve cheap repository/runtime/external unknowns yourself. Ask only when the remaining ambiguity changes product semantics, authorization, irreversible risk acceptance, or another owner-controlled decision.

Prefer one discriminator that can delete several speculative branches over several parallel implementation plans.

## Plan by dependency and contract

Build the execution graph around real prerequisites, not team labels:

`compatible contract expansion -> capable consumers -> producers/writers -> migration/backfill -> exposure/cutover -> old-path removal`

For each material step record:

- prerequisite and authoritative owner;
- producer/consumer or data contract;
- whether the step can deploy independently;
- evidence that proves the intermediate state;
- rollback or forward-repair behavior;
- removal condition for temporary compatibility.

The critical path is the longest chain of real dependencies, not the longest task list. When multiple repositories or independently deployed actors participate, use `cross-repo-contract-mesh.md` for mixed-version cells and exact artifact/version sequencing instead of duplicating that matrix here.

## Separate reversible from hard-to-reverse decisions

Spend decision effort in proportion to reversibility and blast radius.

Usually easy to revise:

- private module boundaries;
- internal adapters;
- non-persisted UI structure;
- bounded feature exposure.

Often expensive to reverse:

- public API/event promises;
- destructive or semantic data migration;
- tenant/security boundaries;
- externally visible identifiers;
- billing/entitlement semantics;
- partition/shard ownership;
- irreversible provider side effects.

Do not over-design a reversible local choice. Do not under-design a one-line change that crosses an irreversible boundary.

## Prove the risky boundary with a thin slice

Choose the smallest slice that exercises the hardest real mechanism, not merely the easiest visible shell.

Examples:

- one tenant through auth -> DB -> job -> visible status;
- one provider through timeout/idempotency/reconciliation;
- one partition through routing, ownership transfer, and recovery;
- one new event consumed by both migration-period versions.

Use spikes only to answer a named uncertainty. If spike code becomes production code, harden and review it deliberately.

Prefer evolutionary seams: additive contracts, adapters, shadow compare, cohort routing, bounded dual reads/writes, outbox/CDC, or strangler paths where they reduce synchronization risk. Give every temporary seam a convergence signal and deletion criterion before rollout.

## Budget scale, latency, availability, and cost

Translate material expectations into rough budgets before choosing mechanisms:

- end-to-end and dependency latency;
- peak requests/jobs and queue recovery time;
- DB connections/query volume/data touched;
- CPU/memory per worker/session;
- storage growth/retention/egress;
- tenant skew and fairness;
- external quota/rate limits;
- unit cost where economically relevant.

Back-of-envelope arithmetic can reject an architecture early, but label estimates as estimates and validate important assumptions with representative measurements.

## Design rollout and operational ownership with implementation

Before merge of a consequential program, answer:

- exact artifact/config/schema changes and order;
- old/new coexistence expectations;
- candidate health and invariant signals;
- pause/stop condition;
- previous stable state and recovery direction;
- temporary path owner and removal condition.

Every new service, queue, cache, index, scheduled job, dependency, flag, or copied dataset adds lifecycle cost. Add it only when it creates a useful ownership, scale, security, or failure-domain boundary. Name authority, creation/cleanup, capacity bound, failure/recovery, observability, upgrade path, on-call impact, and deletion path when material.

## Stop and report precisely

Stop adding code and gather stronger evidence when the active caller/authority is unproven, runtime contradicts local tests, a migration depends on unknown data scale, performance lacks a baseline/profile, authorization is inferred from UI, compatibility depends on unknown deployed versions, or repeated fixes preserve the same disproven ownership model.

For substantial work, report only:

1. product/operator contract and authority;
2. chosen design plus serious rejected alternative when decision-relevant;
3. dependency/compatibility/migration sequence;
4. risk and evidence level;
5. rollout/recovery state;
6. temporary mechanisms and removal criteria;
7. unresolved product/authorization/runtime risk.

Use a short ADR only when the decision should outlive the task. Precise delivery state is more valuable than architecture prose.

## Mature references

Re-check current version-sensitive material before applying it:

- Martin Fowler Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- Martin Fowler Architecture Decision Record: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Google SRE canarying releases: https://sre.google/workbook/canarying-releases/
- Google API Improvement Proposals: https://google.aip.dev/
