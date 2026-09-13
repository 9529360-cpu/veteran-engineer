# Code review and change-risk patterns

## Contents

- Review the product contract before the diff
- Establish change surface and intent
- Prioritize correctness over style
- Review by risk domain
- Trace new ownership and dataflow
- Review tests as evidence
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
