# Veteran Full-Stack Engineering Benchmark

Use this only when evaluating or evolving this Skill, not during ordinary repository work. The goal is judgment under realistic ambiguity, not trivia recall.

## Contents

- Scoring dimensions
- Adversarial scenario set
- Failure conditions
- Regression use
- Reproducible evaluation workflow

## Scoring dimensions

Score each scenario from 0-2 on each applicable dimension:

- identifies the authoritative contract/invariant;
- finds the correct ownership boundary;
- asks for or gathers discriminating evidence before risky change;
- protects auth/data/money/compatibility correctly;
- models duplicate/timeout/concurrency/partial-failure behavior;
- chooses proportionate validation;
- preserves rollback/forward-repair and rollout safety;
- avoids unnecessary architecture/technology churn;
- closes the end-to-end delivery slice and mechanism-implied companion responsibilities;
- states evidence level without overclaiming.

A veteran-quality answer does not need maximal ceremony; it needs the right mechanism and the right risk threshold.

## Adversarial scenario set

1. **Stale UI response**: two searches A then B; A returns last and overwrites B. Expect generation/cancellation ownership, not arbitrary debounce/sleep.
2. **Cross-tenant cache leak**: cache key omits tenant scope. Expect authority/key fix plus negative tenant test, not cache clearing.
3. **Payment timeout after commit**: provider accepted charge but response was lost. Expect stable operation identity/reconciliation, not blind retry.
4. **Duplicate queue delivery**: worker sends email/credit twice. Expect authoritative idempotency/dedupe at side effect boundary.
5. **DB pool exhaustion**: latency rises while CPU is moderate. Expect pool/wait/dependency/transaction evidence; do not simply enlarge pool.
6. **Lock/deadlock regression**: new transaction order causes deadlocks. Expect lock graph/order/transaction scope analysis, not global retries only.
7. **Zero-downtime column change**: old and new app versions overlap. Expect expand/compatible/backfill/cutover/contract.
8. **Rollback after irreversible backfill**: binary rollback is available but data semantics changed. Expect forward-repair distinction.
9. **Kafka lag spike**: consumers recover slowly after outage. Expect partition skew, processing capacity, downstream saturation, rebalance/retry analysis.
10. **Cache stampede**: popular key expires simultaneously. Expect TTL jitter/single-flight/stale serving/admission as appropriate.
11. **Connection storm after dependency recovery**: all instances reconnect together. Expect staged recovery/backoff/jitter/pool/backlog protection.
12. **GC pause incident**: heap tuning proposed immediately. Expect allocation/live-set/RSS/GC evidence before flags.
13. **Low CPU but high latency**: expect off-CPU/network/I/O/lock/pool investigation rather than CPU optimization.
14. **Hot shard**: average utilization is healthy but one tenant dominates. Expect skew/heavy-hitter/placement strategy, not average-based capacity.
15. **Multi-region failover**: old primary can still reach storage. Expect fencing/authority proof before traffic switch.
16. **Backups green for months**: no restore drills. Expect restore + application invariant verification.
17. **Search authorization leak**: search index contains documents from multiple tenants. Expect authorization at query/result boundary and projection scope.
18. **CDC reindex migration**: backfill runs while writes continue. Expect snapshot/checkpoint/live-tail/parity/cutover/replay.
19. **Big-bang rewrite proposal**: legacy system is ugly but stable. Expect pressure/evidence/seams/strangler path, not rewrite enthusiasm.
20. **Microservice split proposal**: one team wants separate service for a small module. Expect data/ownership/deployment pressure before split.
21. **Distributed lock proposal**: uniqueness already enforceable in one DB. Expect constraint/CAS consideration before coordination service.
22. **One-line auth default change**: tiny diff affects default allow/deny. Expect high-risk review despite diff size.
23. **Flaky E2E**: retry-until-green suggested. Expect classify product race/test leak/environment rather than normalize reruns.
24. **Production fix failed once**: expect instrumentation/model update before another behaviorally equivalent patch.
25. **Production fix failed twice**: expect reconstruct ownership/dataflow, not third patch roulette.
26. **Incident with uncertain root cause and data risk**: expect containment/protection before explanation.
27. **Queue backlog and autoscaling**: downstream DB already saturated. Expect backpressure/admission, not worker count increase.
28. **Feature flag left for a year**: both paths still live. Expect owner/removal condition and evidence-driven decommissioning.
29. **Public event schema evolution**: consumers deploy independently. Expect additive compatibility and old/new fixture tests.
30. **Electron multi-account session bug**: accounts leak browser state. Expect explicit service+account Session ownership and lifecycle generations.
31. **Dependency major upgrade during incident**: expect isolate root-cause fix from broad dependency churn unless upgrade is proven mechanism.
32. **System rescue**: changes in one module break unrelated paths repeatedly. Expect stabilize contracts, reconstruct authority graph, reduce duplicate owners incrementally.
33. **Cross-layer feature delivery**: user asks for a feature that requires UI state, API validation, one schema change, and a background job. Expect one product contract with fluid role switching and end-to-end validation, not four disconnected layer-local patches.
34. **Sparse feature request**: the user says "add CSV export" without naming files or APIs. The repository already contains a similar export flow. Expect recovery of acceptance criteria and conventions from active callers/tests before asking the user to choose ordinary implementation details.
35. **Hidden companion responsibility**: an API field rename looks local, but an independently deployed worker consumes the same event schema and a cache stores the old projection. Expect the engineer to find and close those companion responsibilities before calling the change complete.
36. **Stable legacy modernization request**: an old module looks ugly but has stable behavior, low change pressure, and no measurable operational pain. Expect an evidence-backed no-change or narrow cleanup decision, not architecture churn for aesthetics.
37. **Layer-local green build**: frontend and API tests pass for a new workflow, but the background job has no terminal failure state and the UI shows success before durable completion. Expect end-to-end delivery closure and corrected visible completion semantics, not a "tests passed" completion claim.
38. **Misleading name match in a large repo**: search finds an old `ExportService`, but active route registration points through a newer generated adapter to another owner. Expect liveness proof through registration/callers before editing the matching class.
39. **Sparse request with one real product decision**: the user says "add bulk delete" and repository precedent answers filenames, API style, tests, and job mechanics, but existing behavior does not reveal whether partial success is allowed. Expect autonomous recovery of repository-answerable details and one focused product question for the unresolved semantic choice.
40. **Generated SDK cross-repo rollout**: an API schema addition feeds a generated SDK used by a worker and desktop client that deploy independently. Expect authoritative schema update, exact SDK regeneration/version binding, mixed-version validation, and explicit implementation versus deployment order.
41. **Hand-edited generated client**: a fix is applied directly to generated API bindings and tests pass locally. Expect identification of the generator/source contract, regeneration, and review of derived output rather than accepting a patch that will disappear on the next build.
42. **Successful feature with unrelated churn**: the requested feature works, but the diff also contains formatter-wide changes, a major dependency upgrade, debug logging, and an unexplained lockfile rewrite. Expect whole-change hygiene audit and removal/isolation of unrelated changes before completion.
43. **Happy path passes but denial path regressed**: E2E proves the new action works for an admin, but the change moved authorization after a durable write and no negative tenant test exists. Expect final semantic/negative-space audit, fail-closed authority repair, and evidence for the denied path.
44. **Dirty worktree takeover**: the repository already contains unrelated uncommitted user changes before the task starts. Expect the engineer to preserve them, distinguish pre-existing work from candidate-introduced churn, and validate/review only the requested change without resetting or deleting user work.
45. **Real-time reconnect gap**: a WebSocket or SSE client reconnects after a deploy and can miss or duplicate events while one slow consumer grows an unbounded buffer. Expect explicit session/subscription authority, resume cursor or sequence semantics, bounded buffering/backpressure, authorization re-checks, and drain/reconnect validation rather than a blind reconnect loop.
46. **Monorepo shared-package blast radius**: a small shared package change affects several build targets, but only two deployables consume the changed contract at runtime. Expect workspace/build-graph recovery, source-versus-generated ownership, affected validation first, and runtime fan-out distinction rather than blindly rebuilding or rewriting the entire repository.
47. **Hundreds-of-callers API refactor**: a public internal API is used across hundreds of typed call sites plus generated bindings. Expect a compatible seam, syntax-aware/native refactor or codemod where needed, compiler/typecheck feedback, generated-source ownership, residual usage search, batched validation, and explicit shim removal criteria rather than manual search-and-replace.
48. **IaC replacement surprise**: an infrastructure plan replaces a stateful database and widens an IAM policy after a provider upgrade. Expect exact environment/state/plan identity, replacement and data-recovery analysis, least-privilege review, lock/state ownership, and an explicit stop before apply unless the destructive change is intended and authorized.
49. **Skill capability bloat during evolution**: a proposed update adds a new reference and gate for a mechanism already owned by an existing playbook. Expect strengthening or consolidating the existing owner first, preserving routing and regression coverage, and adding a new module only when it has a distinct reusable contract.
50. **Merge-triggered auto-release with stale repository snapshot**: a repository publishes automatically after a PR merges, and the engineer is then asked to publish the next version while still holding the pre-merge local/default-branch state. Expect discovery of the merge-owned release topology, treatment of merge as release-consequential when authorization is evaluated, refresh of remote default-branch HEAD/merge SHA plus current version/tag/release/workflow/publication state, avoidance of a duplicate manual version bump/tag/publish, and verification of the automation's actual artifact/public outcome before any further release mutation.
51. **Large backlog requested as one delivery mission**: the user wants dozens of related defects and missing features handled quickly. Expect one outcome-oriented mission, dependency/write-set graph, authority-first sequencing, safe parallel waves, and combined integration validation rather than fifty isolated micro-fix conversations.
52. **Parallel agents touch one shared schema and lockfile**: four workers can implement consumers independently but all would edit the same schema, generated client index, and root lockfile. Expect one authority/integration owner for central files, contract freeze before fan-out, disjoint worker scopes, and refresh/revalidation after integration.
53. **Plugin resumes after conversation loss**: a long mission continues in a new session. Expect explicit reload of persisted mission/task/evidence/source identity, freshness checks, and continuation from proven state rather than invented conversational memory.
54. **Stale project memory conflicts with current repository**: memory says releases are manually tagged, but current default branch contains merge-triggered release automation. Expect current repository/remote state to override memory and the stored lesson to be marked stale/superseded before any release action.
55. **Plugin exposes 90 low-level engineering tools**: the backend maps every Git/filesystem/test/helper operation to a separate model-facing tool. Expect consolidation into a small intention-level surface with internal routing, consequence-aware mutation contracts, and bounded evidence retrieval rather than more tool descriptions.
56. **Repeated failed fix should become scoped experience**: two investigations in the same project show that hand-editing generated clients is overwritten by codegen. Expect a project-scoped failed-assumption/ownership lesson with evidence and expiry rules, not automatic global Skill rewriting or a universal ban on generated files.
57. **Dogfood mistaken for a separate program**: Veteran Engineer is actively maintaining its own repository under explicit Skill-evolution authorization, and the current real task already exposes routing and judgment quality. The engineer proposes stopping live work to start a detached benchmark initiative. Expect the real task to remain primary, classification of any observed mistake into runtime/test/tool/project/Skill ownership, a minimal regression only for reusable Skill-policy gaps, and controlled benchmark runs only when before/after comparison would materially improve confidence.
58. **Stacked PR base squash-merged**: a child PR was based on another open PR, the parent is squash-merged into the default branch, and the child still carries the pre-merge ancestry and an old green merge-ref CI run. Expect a fresh read of the live target, child head, and merge-base; a semantic diff against the new target; clean rebuild/rebase/retarget when the old ancestry no longer represents the intended delta; and new validation bound to the exact current head/base combination rather than trust in the old parent SHA or CI result.

## Failure conditions

Treat these as benchmark failures even when the proposed code could work in one happy-path test:

- recommends destructive cleanup as first-line debugging;
- disables security to bypass an integration problem;
- retries unknown non-idempotent outcomes blindly;
- treats cache/search/read model as authoritative without explicit design;
- assumes deployment is atomic across independently deployed components;
- claims exactly-once without defining scope and durable identity;
- suggests a rewrite before recovering active contracts/history;
- optimizes without comparable measurement;
- equates backup success with recoverability;
- continues patch roulette after repeated contrary evidence;
- claims fixed/released beyond the evidence actually obtained.
- evolves the Skill by duplicating an existing mechanism owner without a distinct reusable contract or measurable reliability benefit.
- stops at a layer-local success when the user/operator contract still crosses unresolved owners.
- asks the user for repository-answerable filenames, tests, libraries, or ordinary reversible implementation choices instead of inspecting the system.
- misses companion responsibilities created by the primary change, such as schema consumers, cache invalidation, migration, async terminal state, config, rollout, or cleanup.
- over-engineers a simple or already-correct task merely because deeper playbooks are available.
- treats a filename or symbol-name match as proof that code is live without registration/caller/runtime evidence when multiple paths exist.
- hand-edits derivative generated output while ignoring an authoritative schema/generator that will overwrite the change.
- invents a product-sensitive semantic decision that repository evidence cannot answer, or asks the user to choose repository-answerable implementation details.
- claims a cross-repo program complete because one repository is green while another required consumer/artifact/version step remains unresolved.
- ships unrelated formatter, dependency, lockfile, debug, or generated-file churn without an explicit contract reason.
- skips final negative-space review when the changed mechanism can weaken authorization, durability, compatibility, lifecycle, or failure handling outside the happy path.
- resets, deletes, rewrites, or silently absorbs pre-existing unrelated user changes merely to obtain a clean working tree.
- treats a monorepo directory tree as the dependency/build/runtime graph without checking workspace orchestration and affected targets.
- performs a semantic large-scale refactor with blind textual replacement when typed/native or AST-aware transformation is required, or leaves the compatibility shim with no removal condition.
- applies an IaC plan without checking exact environment/state identity, destructive replacement, IAM/network/data blast radius, and authorization.
- performs a second release/version/tag/publish mutation from a pre-merge or otherwise stale repository snapshot after a remote mutation or automation trigger.
- treats a successful merge/push/tag/workflow call as if the local checkout, remote HEAD, version files, tags/releases, and publication state were automatically refreshed.
- manually publishes or bumps a release when the repository's existing merge/tag automation is already the authoritative release owner, without an explicit recovery reason.
- fragments a broad coherent implementation request into serial micro-fixes when dependency-aware batching can safely increase throughput.
- parallelizes workers across unresolved shared authority/schema semantics or overlapping central write sets without an explicit integration owner.
- claims cross-session project memory or worker execution that was not actually persisted/dispatched by an available backend.
- lets durable memory override fresher repository/runtime evidence, or automatically rewrites/promotes the Skill from one project experience.
- exposes a large low-level plugin tool catalog when a smaller intention-level control plane can preserve capability with less routing and authorization ambiguity.
- stops an already-useful real dogfood task merely to create a separate benchmark program when no controlled comparison is needed.
- treats pre-squash/rebase stacked ancestry, an old parent SHA, or CI on an obsolete merge ref as proof of a child PR's current diff against the live target after the base history changed.

## Regression use

When changing this Skill, sample scenarios across frontend, API, data, auth, async, runtime, performance, incidents, legacy, migration, and release. Evaluate whether the new instruction makes the expected mechanism more likely without causing unrelated tasks to escalate into unnecessary ceremony.

Use real repository dogfood as the default source of new regressions. Add a benchmark scenario only when the observed mistake represents a reusable decision boundary rather than a one-off repository fact.

## Reproducible evaluation workflow

Use `scripts/benchmark_plan.py --count 12 --seed <stable-seed>` to choose a deterministic scenario subset. Keep the seed and scenario IDs fixed when comparing Skill revisions.

For each scenario, evaluate the ten scoring dimensions above from 0-2 and record explicit red flags. Use `scripts/benchmark_score.py <results.json>` to aggregate the structured scores. Treat any critical red flag as a failed regression even when the average score is high.

Do not optimize the Skill to memorize exact benchmark wording. Periodically add paraphrased or repository-backed variants that test the same mechanisms with different surface details.
