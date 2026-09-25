# Batch Mission Orchestration

Use this when the request is broader than one local fix: large backlog cleanup, a feature spanning many owners, a rescue program, a wide refactor, migration, repository-wide quality pass, or any request whose main value comes from shipping a coherent body of work instead of solving one tiny issue at a time.

## Contents

- Define one mission instead of many disconnected fixes
- Build a dependency-aware work graph
- Prefer throughput by safe parallelism, not by lowering evidence quality
- Split work by ownership and write-set boundaries
- Coordinate with external parallel developers
- Create worker packets another AI can execute independently
- Integrate in waves
- Keep shared truth fresh across parallel workers
- Renew context deliberately
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

Use `scripts/work_graph.py` when the task count, dependency graph, or parallel write conflicts are non-trivial. For provenance-driven repair, `scripts/decision_revalidation_plan.py` identifies recompute/revalidation waves and `scripts/decision_revalidation_mission.py` can scaffold them into mission tasks. Dependency independence alone is **not** permission to execute in parallel: the adapter must remain planning-only until each task has a repository-derived write set, explicit risk class, and validation oracle, after which `work_graph.py` still arbitrates write conflicts and risk. After a worker returns, route the result through `scripts/decision_revalidation_result_gate.py` before marking its mission dependency complete. Green results may change-prune blocked descendants; pending results unlock nothing; stale-plan results are discarded; red results remain non-terminal until the replacement decision is committed to the Decision Ledger/dependency graph. Mission scheduling therefore consumes converged decision state, not worker self-reported `done`.

Treat write sets as forecasts, not truth. Recompute conflicts after each wave because implementation evidence can reveal hidden coupling.

## Create independence before parallelism

Parallelism is useful only after the problem has independent owners or independently falsifiable work. If every worker is blocked on the same public contract, schema decision, root-cause uncertainty, central file, or missing oracle, adding workers multiplies duplicate effort and merge conflict rather than throughput.

Before fan-out, create separability where possible:

`stabilize authority/contract -> create bounded task/oracle seams -> predict write sets -> then parallelize independent work`

If no honest seam exists, keep the authority-defining step serial. A mission being large is not evidence that it is parallelizable.

## Escalate decomposition only when the lighter form fails

Do not jump from “large task” to a deep hierarchy of plans, specs, or workers. Escalate structure only as context pressure or dependency evidence requires it:

`one bounded run -> scope to a phase/task slice -> delegate independent slices -> combine scoping + delegation -> decompose into separately specified sub-features`

At each step, stop escalating when the current form preserves the contract, keeps the active context high-signal, and exposes a usable validation oracle. Deeper decomposition adds coordination and reconciliation cost; use it only when a smaller unit still cannot be executed or verified coherently. Keep the roadmap shallow: name intent, scope boundary, dependency, and status, but defer detailed design until the slice becomes active.

## Prefer throughput by safe parallelism

The objective is not "maximum number of simultaneous agents." The objective is maximum useful throughput while preserving coherent authority and integration safety.

Mission size by itself is not a reason to throttle independent coding work. Once authority-defining decisions are stable, low- and medium-risk tasks with disjoint owners/write sets should consume the available structural parallelism up to the operator/runtime capacity. Reduce concurrency because evidence shows elevated risk, shared authority, write/resource conflict, downstream capacity, or unstable contracts — not merely because the mission contains many tasks. Keep high-risk work deliberately bounded and consequential/critical work serial unless a stronger domain-specific proof justifies otherwise.

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

## Coordinate with external parallel developers

Workers inside one mission are not the only source of collision. A human, ChatGPT session, automation, or independently managed branch can mutate the same repository without appearing in the current work graph, but an unexpected mutation does not establish which of those caused it.

Before the first write when parallel external work is known or plausible, refresh the live default branch and inspect the strongest available collaboration evidence: open pull requests and their changed files, active feature branches or recent branch heads, recently landed commits, and any explicit owner/reservation notes. Build only the temporary coordination map needed for the task:

`provenance/branch -> attributed actor if proven -> semantic owner -> current write set -> central files reserved -> dependency on our work`

Do not infer non-overlap from branch names, issue titles, or different task wording. Compare concrete changed paths and semantic ownership. Prefer a disjoint owner/file set when useful work can proceed there. If both efforts must change the same authority or central file, make the dependency explicit and use one integration owner; stack deliberately on the authoritative branch when appropriate rather than creating competing main-based edits that will later be reconciled by accident.

Refresh this collision map again immediately before pushing/opening a PR and before integration. If the planned write set changed, recompute the boundary instead of pushing through the conflict. Attribute that change to another actor only when positive executor provenance supports the claim; branch names, timestamps, account-level GitHub actors, or surprise alone are insufficient. When external branch/PR visibility is unavailable, narrow the mutation to the smallest isolated owner and avoid central conflict magnets until coordination evidence is available.

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

## Renew context deliberately

Do not treat context reset, compaction, or fresh workers as universal rituals. Choose the cheapest renewal mode that preserves decision quality:

- **continue current context** when the task is coherent and the active evidence remains high-signal;
- **compact** when prior decisions still matter but logs/exploration are crowding the working set;
- **fresh worker** for a bounded independently executable task or when parallelism has a real seam;
- **fresh reviewer/evaluator** when independent judgment materially reduces implementer bias;
- **hard reset + structured handoff** when stale assumptions, context pollution, or session limits are degrading decisions.

A worker/session handoff is a projection, not authority. Before dependent work continues, reconcile declared state against current git/files/runtime/project authority. Invalidate packets whose base revision, schema, design decision, central config, or accepted contract changed.

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
