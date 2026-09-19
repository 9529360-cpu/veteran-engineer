# Code review and change-risk patterns

## Contents

- Review the product contract before the diff
- Establish change surface and intent
- Prioritize correctness over style
- Review by risk domain
- Trace new ownership and dataflow
- Review tests as evidence
- Bind review to exact candidate content
- Reset the review loop when findings do not converge
- Review deletion and simplification opportunities
- Review migrations and rollout separately
- Run a mechanism-specific counterfactual
- Write actionable findings
- Distinguish blockers from nits
- Finish with a whole-change audit
- Calibrate the completion claim
- Mature references

## Review the product contract before the diff

Before commenting on code, state what the change is supposed to accomplish for a user/operator and which invariants must remain true.

A locally clean diff can still be wrong if it changes the wrong owner, breaks old clients, weakens authorization, or never reaches the active caller.

Use the issue/PR description as a hypothesis, then verify against repository and runtime truth.

## Establish change surface and intent

Inspect:

- base/head identity;
- changed files and generated artifacts;
- dependency/lockfile changes;
- migrations/schema;
- public API/event/config contracts;
- auth/security paths;
- CI/release/infrastructure;
- tests;
- feature flags;
- docs/operational runbooks when required.

Run `scripts/change_impact_map.py <repo>` as a fast path-based risk inventory when useful. It is a hint, not a substitute for reading the diff.

### Keep a review scope budget

Start from the exact candidate range and changed files. Read adjacent code only to evaluate a concrete risk you can name, such as a changed public contract, lock ordering, shared mutable state, generated-source authority, schema consumer, authorization boundary, or another caller whose behavior can actually be affected. Do not turn `review this change` into a whole-repository modernization pass because nearby debt is visible.

After a fix round, re-review the fix delta plus the original open findings first. New candidate-introduced breakage belongs in the loop; unrelated pre-existing observations should be recorded separately and must not extend the fix cycle unless they become required for the requested contract. A reviewer may widen scope when evidence shows a real cross-cutting mechanism, but must state the mechanism that justified widening.

### Scale reviewer independence to risk

A reviewer who shares the implementer's full exploratory history can inherit the same assumptions. When the change is substantial, high-risk, security/authorization-sensitive, migration-heavy, cross-boundary, or the implementer context is heavily saturated, prefer an independent/fresh reviewer when the environment can provide one.

Give that reviewer the smallest evidence-complete packet: exact base/head or candidate diff, explicit acceptance/spec clauses, repository standards that apply, relevant tests/runtime evidence, and any open risks. Do not prime it with the implementer's chain of reasoning or preferred conclusion. Fresh context is useful because it must reconstruct the case from inspectable evidence.

Keep the cost proportional. A tiny deterministic local fix with a strong focused oracle does not need an implementer plus multiple cold reviewers merely to satisfy ceremony. Self-review plus the correct evidence boundary is enough when a separate reviewer is unlikely to change the decision.

Independent review is still evidence, not authority by itself. The controller/integration owner must adjudicate findings against the live repository, active contract, and exact candidate identity; a confident reviewer can be wrong or stale.

### Bind review to exact candidate content

A clean review applies only to the content the reviewer actually inspected. For consequential or independently reviewed work, record an exact candidate identity that covers the complete task-owned change surface, including committed, staged, unstaged, generated, and task-owned untracked deliverables when those can affect the result. A branch name or `HEAD` alone is insufficient when the working tree can still change.

After fixes, formatting, regeneration, rebases, or integration, compare the final task-owned content with the reviewed identity:

- a byte-identical candidate keeps the review evidence;
- a demonstrably comment/formatting-only delta may retain prior semantic review after a focused self-check;
- any changed behavior, expectation, public contract, dependency, generated semantic output, migration, authorization, or lifecycle mechanism invalidates the affected review and requires re-review of that delta plus still-open findings;
- a changed merge base requires inspection of the upstream delta and integration effect even when task-owned source is unchanged.

Do not declare an independently reviewed change complete while final verification is running against content that the review never saw. Review freshness and test freshness are separate claims; both must apply to the delivered candidate.

### Reset the review loop when findings do not converge

A review/fix loop needs a stop condition. If repeated valid findings keep exposing the same underlying ownership, contract, lifecycle, state, or complexity defect, stop adding local conditions or one-off patches and reopen the implementation shape that keeps recreating the problem. Batch the root-cause repair when evidence supports it, then review the resulting coherent candidate again.

Distinguish review non-convergence from infrastructure noise. A reviewer crash, unavailable model, timeout, or identical-content retry does not prove the implementation is hard to converge. Count only completed, evidence-backed review cycles that materially changed or challenged the candidate.

Use the existing gate semantics:

- **Revise** when the root defect is clear and can be repaired inside the accepted contract;
- **Escalate** when convergence now depends on a new product/scope/architecture decision that current authority cannot resolve;
- **Block** when the required reviewer/evidence environment is unavailable for a change whose risk requires it.

Do not invent a universal numeric round cap across repositories. Use repository policy when one exists; otherwise treat repeated same-root findings or strategy churn as the signal to stop the local patch loop.

## Prioritize correctness over style

Review in this order unless risk suggests otherwise:

1. product behavior and active caller;
2. security/authorization/privacy;
3. data integrity and concurrency;
4. compatibility and migration;
5. failure/retry/async behavior;
6. operability and rollback;
7. test quality;
8. maintainability/complexity;
9. naming/style/docs.

Do not bury a tenant-isolation bug under dozens of formatting comments.

Google's published review guidance emphasizes design, functionality, complexity, tests, naming, comments, style, and documentation, while favoring changes that improve overall code health rather than demanding perfection:
https://google.github.io/eng-practices/review/

## Review by risk domain

For UI/client changes, check state ownership, stale async commits, accessibility, error states, and reload/navigation.

For APIs, check validation, authorization, idempotency, error contracts, timeouts, retries, and compatibility.

For data changes, check invariants, constraints, transaction isolation, indexes, backfills, coexistence, and rollback.

For async changes, check identity, dedupe, redelivery, retry classification, terminal state, and tenant scope.

For auth/security, check boundary placement, object-level authorization, secret exposure, revocation, audit, and fail-closed behavior.

For runtime/desktop, check Session/WebContents generations, IPC boundaries, package/runtime divergence, OS integration, and cleanup.

For infra/release, check exact artifact identity, config defaults, health/draining, promotion, previous stable, and recovery.

## Trace new ownership and dataflow

When the diff introduces a store, cache, service, queue, table, event, flag, or adapter, ask:

- what fact does it own;
- who can mutate it;
- how it is initialized;
- how it becomes stale;
- how it is invalidated/cleaned up;
- how failures are observed;
- whether another owner already exists.

Two authoritative writers require an explicit reconciliation or migration contract.

## Review tests as evidence

Do not only count tests. Ask whether they would fail for the important regression.

Look for:

- assertions on observable postconditions;
- negative auth cases;
- duplicate/retry/concurrency cases;
- migration old/new coexistence;
- real DB/queue/runtime semantics where mocks are insufficient;
- deterministic setup and cleanup;
- absence of arbitrary sleeps;
- package/E2E evidence for environment-sensitive changes.

A test that only snapshots implementation details is weak evidence for a cross-layer contract.

## Review deletion and simplification opportunities

New behavior should not leave dead parallel concepts behind indefinitely.

Check for:

- obsolete owner/store/cache;
- old event/API field no longer consumed;
- legacy flag after full rollout;
- duplicate adapter;
- abandoned migration compatibility branch;
- temporary workaround/listener/timer;
- generated output committed unintentionally.

Deletion can reduce risk, but only after proving old callers/data are gone.

## Review migrations and rollout separately

A source diff and a deploy plan are different review surfaces.

For high-risk changes, review sequence explicitly:

`expand schema/contract -> deploy compatible code -> backfill/migrate -> switch traffic/flag -> observe -> contract old path`

Verify which steps are reversible and what happens if rollout stops halfway.

Do not approve a migration because the final schema looks correct if currently deployed code cannot coexist with the intermediate state.

## Run a mechanism-specific counterfactual

Before closing a consequential change, assume the current model is wrong and challenge only mechanisms the change can actually trigger:

`changed transition -> new assumption -> plausible violation -> observable consequence -> falsifier/guard`

Ask whether a passing test used the real active path; another writer/cache/worker/client generation can recreate state; a timeout hid remote success; old/new versions can coexist; rollback is still safe after durable effects; recovery traffic amplifies load; or a temporary mechanism lacks an operational owner/removal path. If a cheap discriminator can overturn the model, run it before adding more code.

Scale confidence to reversibility: narrow instrumentation or a tiny canary can proceed with less certainty than destructive data repair, access-policy changes, money movement, irreversible schema contraction, or authority transfer. Stop changing the system when the contract is already satisfied or the next edit has no evidence-backed mechanism.

## Write actionable findings

A strong review finding contains:

- severity/impact;
- exact mechanism;
- evidence/location;
- failing scenario;
- smallest credible correction or question;
- validation needed.

Prefer:

"High: retrying this POST after a timeout can duplicate the charge because the server commits before the response and no scoped idempotency key is persisted. Add dedupe at the charge-creation owner and test timeout-after-commit."

Avoid vague comments such as "race condition?" or "this feels unsafe" when the mechanism can be stated.

## Distinguish blockers from nits

Block on correctness, security, integrity, compatibility, serious operability risk, or material maintainability regression.

Use non-blocking notes for optional polish and clearly label them as such.

Do not require speculative abstractions or unrelated cleanup as a condition for a focused safe change unless the existing design makes the requested behavior impossible to implement correctly.

## Finish with a whole-change audit

After implementation and focused validation, review the candidate as a complete change rather than a collection of locally correct edits.

Re-state the behavior in one before/after sentence and confirm the requested visible/operator postcondition is reached by the active caller through the intended authority. Then inspect **negative space**: responsibilities implied by the mechanism that may be absent from the diff.

Examples:

- public field/event -> compatibility and consumers;
- durable field/table/index -> migration, backfill, and read compatibility;
- retry -> idempotency and unknown-outcome handling;
- cache -> key scope, freshness, invalidation;
- resource/subscription -> teardown and lifecycle generation;
- job/event -> dedupe, ordering, terminal/recovery state;
- feature flag -> default, owner, rollout, removal;
- external call -> timeout, auth, degraded/reconciliation behavior;
- deployable/config -> health, observability, stop/rollback path.

Require a companion only when the changed mechanism creates it.

Also inspect the entire candidate for change hygiene:

- unrelated formatting, renames, or cleanup introduced by the candidate;
- accidental dependency or lockfile churn;
- generated output that is stale or unexpectedly refreshed;
- debug logging, probes, sleeps, bypass flags, test hooks, or commented-out investigation code;
- local-only caches, snapshots, fixtures, or artifacts that should not ship;
- secrets, tokens, user content, or sensitive traces;
- temporary compatibility paths lacking an owner/removal condition.

Distinguish candidate-introduced churn from pre-existing user work. Never reset or delete unrelated existing changes merely to make the diff look clean.

Audit semantic expansion beyond line count: accepted inputs/defaults, authorization scope, authoritative writers, durable writes, external side effects, retry/background execution, public/persisted schema, deployment topology, and runtime/dependency behavior. A one-line default change can have a larger risk surface than a broad internal refactor.

Finally, verify evidence identity. Material tests or observations must belong to the exact source/build/config/runtime/data cohort being claimed. Stale CI, a previous head, a mismatched generated client, or another runtime is not proof for the current candidate.

## Calibrate the completion claim

Choose the strongest claim actually supported:

`implemented -> focused-validated -> integration-validated -> end-to-end-validated -> release-candidate-validated -> deployed -> production-verified`

If an inaccessible boundary remains, name it precisely. Do not silently relabel weaker evidence as stronger completion. A review that discovers open companion responsibilities should report them as open rather than calling the change complete.

## Mature references

- Google Engineering Practices code review guide: https://google.github.io/eng-practices/review/
- Martin Fowler Architecture Decision Record: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Martin Fowler Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
