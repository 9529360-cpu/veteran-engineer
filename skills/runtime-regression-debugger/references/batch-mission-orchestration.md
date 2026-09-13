# Batch Mission Orchestration

Use this when the request is broader than one local fix: large backlog cleanup, a feature spanning many owners, a rescue program, a wide refactor, migration, repository-wide quality pass, or any request whose main value comes from shipping a coherent body of work instead of solving one tiny issue at a time.

## Contents

- Define one mission instead of many disconnected fixes
- Build a dependency-aware work graph
- Prefer throughput by safe parallelism, not by lowering evidence quality
- Split work by ownership and write-set boundaries
- Create worker packets another AI can execute independently
- Integrate in waves
- Keep shared truth fresh across parallel workers
- Resume safely after interruption
- Avoid batch-execution anti-patterns
- Know when to stop batching

## Define one mission instead of many disconnected fixes

Convert a broad request into one mission contract:

`goal -> done definition -> constraints -> work graph -> execution waves -> integration gates -> final evidence`

A mission should be large enough to produce a meaningful product or engineering outcome, but narrow enough to have one coherent completion claim.

Capture:

- user/operator outcome;
- authoritative systems and contracts that must remain valid;
- non-goals and protected areas;
- required compatibility windows;
- validation and delivery boundary;
- permissions required for consequential actions;
- stop conditions and recovery controls.

Do not turn every TODO, lint warning, or nearby smell into mission scope. Batch work by shared outcome, not proximity.

## Build a dependency-aware work graph

Represent the mission as tasks with explicit dependencies and likely write sets.

For each task record:

- stable task ID;
- contract or invariant changed;
- owner/boundary;
- prerequisites;
- expected files/packages/services touched;
- public/schema/generated artifacts affected;
- validation oracle;
- risk class;
- whether it can run concurrently with sibling tasks;
- integration or migration ordering requirement;
- expected handoff artifact.

Use `scripts/work_graph.py` when the task count, dependency graph, or parallel write conflicts are non-trivial.

Treat write sets as forecasts, not truth. Recompute conflicts after each wave because implementation evidence can reveal hidden coupling.

## Prefer throughput by safe parallelism

The objective is not "maximum number of simultaneous agents." The objective is maximum useful throughput while preserving coherent authority and integration safety.

Good parallel candidates:

- independent packages with stable interfaces;
- tests and implementation on disjoint owners after the contract is fixed;
- documentation or migration tooling that does not race the same source files;
- separate consumers of an additive schema after the producer contract is frozen;
- repository archaeology and runtime evidence collection that do not mutate shared state;
- mechanical caller migrations partitioned by disjoint directories after the semantic transform is proven.

Poor parallel candidates:

- multiple agents redesigning the same public API;
- tasks that mutate the same schema, lockfile, central config, generated source, or migration chain;
- producer and consumer work before compatibility semantics are agreed;
- incident mitigation and speculative refactor on the same live owner;
- independent fixes based on a root cause that is still unproven;
- tasks whose success depends on ordering but have no explicit dependency edge.

Serialise the authority-defining step first. Parallelise the mechanical or owner-isolated work after the contract stabilises.

## Split work by ownership and write-set boundaries

Prefer task boundaries that minimize merge and semantic conflict:

`one owner + one contract + one validation oracle + one bounded write set`

Avoid arbitrary partitions such as "Agent A gets files 1-20" when those files participate in one behavior.

Useful partition dimensions:

- service/package ownership;
- producer versus independent consumers;
- frontend surface versus backend implementation only after API contract freeze;
- migration preparation versus application compatibility;
- codemod cohorts with non-overlapping paths;
- test harness additions versus product code when the test contract is already defined.

Central files are conflict magnets: root manifests, lockfiles, shared schemas, route registries, migration indexes, generated aggregators, deployment manifests, and global config. Assign one integration owner for them.

## Create worker packets another AI can execute independently

When delegating to another model or worker, produce a packet that minimizes rediscovery without hiding important uncertainty.

Use this default structure:

```text
Task ID / title
Mission goal
Local contract
Why this task exists
Authoritative owner / active path evidence
Allowed write scope
Protected / do-not-touch scope
Dependencies and assumed upstream state
Implementation constraints
Failure and compatibility requirements
Validation commands / oracle
Expected return:
  - files changed
  - behavior changed
  - tests/evidence
  - unresolved risks
  - discoveries that invalidate the plan
Stop/escalate conditions
```

Do not give a worker a giant project dump when a compact evidence-backed packet is sufficient. Do not omit the reason behind constraints that a worker may otherwise "clean up."

A worker may improve local implementation details, but it must not silently redefine mission-level product semantics, public contracts, security policy, migration ordering, or deployment authority.

## Integrate in waves

Prefer dependency waves over one giant fan-out.

A typical sequence:

1. **Authority wave** - characterize behavior, freeze contract, add compatible seam/schema, define migration rules.
2. **Parallel implementation wave** - independent owners or caller cohorts move against the stable contract.
3. **Convergence wave** - central manifests/generated outputs/lockfiles/config are reconciled by one integration owner.
4. **Validation wave** - focused validation first, then cross-boundary/integration/E2E evidence.
5. **Contraction wave** - remove compatibility shims/old paths only after consumers and production state satisfy removal criteria.

Do not merge an entire wave merely because every worker says "tests pass." Integration evidence must test the combined state.

## Keep shared truth fresh across parallel workers

Parallel work creates stale-context risk. Treat every accepted worker change, branch merge, schema regeneration, dependency update, migration addition, or central-config mutation as a freshness barrier.

Before the next dependent task:

- refresh base/source identity;
- re-evaluate expected write conflicts;
- re-check generated source and public contracts;
- update the work graph when hidden dependencies appear;
- invalidate worker packets whose assumptions changed;
- rerun the cheapest boundary test that proves the new shared state.

A worker packet is a snapshot. It is not an eternal contract.

## Resume safely after interruption

For long missions, checkpoint enough state to resume without rereading the whole repository or repeating failed work.

Persist or emit:

- mission contract and current completion definition;
- task graph and task states;
- exact source/base identity;
- completed wave evidence;
- active blockers and authorization boundaries;
- current compatibility/migration phase;
- failed attempts and forbidden equivalence classes;
- next safe actions;
- integration owner and central files currently reserved.

In skill-only mode this may live in a task-local journal or repository-local working file when authorized. In plugin-backed mode use the plugin control plane described in `plugin-control-plane.md`.

Never claim cross-session continuity unless the state was actually persisted and reloaded.

## Avoid batch-execution anti-patterns

Do not:

- create dozens of tiny tasks whose coordination cost exceeds their implementation cost;
- maximize worker count as a goal;
- assign overlapping write sets without one explicit owner;
- let two workers independently choose incompatible API/schema semantics;
- delegate an unproven root-cause guess as if it were fact;
- merge all branches and discover integration problems at the end;
- run the full repository test suite after every tiny worker change when affected validation can falsify earlier;
- skip the final whole-change and negative-space review;
- let generated outputs, lockfiles, or central configs become merge-by-accident artifacts;
- treat task count completed as mission completion.

## Know when to stop batching

Stop decomposing and execute directly when:

- the work is one tightly coupled transition;
- almost every task touches the same authority or central files;
- the root cause or target contract is still unstable;
- the expected implementation is smaller than the coordination overhead;
- the repository lacks validation boundaries that can independently prove worker outputs;
- authorization or product semantics, not coding throughput, are the real blocker.

A veteran batch plan is deliberately uneven: a few tasks may be large and serial because they own the contract; many later tasks may be safely parallel and mechanical.
