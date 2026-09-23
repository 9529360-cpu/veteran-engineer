# Testing and quality engineering patterns

## Contents

- Start from contracts and risks
- Choose the strongest practical boundary
- Keep tests deterministic and isolated
- Separate product regressions from harness state pollution
- Use real infrastructure where semantics matter
- Test time, retries, concurrency, and duplicates
- Test compatibility and migrations
- Test frontend behavior like a user
- Test third-party boundaries deliberately
- Treat flaky tests as defects
- Distinguish oracle execution from CI projection
- Build risk-based quality gates
- Mature references

## Start from contracts and risks

Derive tests from the user/operator contract and the mechanisms most likely to fail.

Build a small matrix:

| Contract dimension | Happy path | Failure/edge path |
|---|---|---|
| authorization | allowed principal | wrong tenant/role/resource |
| persistence | committed state | conflict/rollback/retry |
| async | processed once logically | redelivery/out-of-order/poison |
| network | normal response | timeout/429/5xx/partial response |
| UI | visible completion | stale/empty/retryable/terminal state |
| rollout | current peers | old/new mixed versions |

Do not chase line coverage while the real failure modes remain untested.

## Choose the strongest practical boundary

Use the lowest-cost boundary that can falsify the behavior, then add a stronger boundary for risks that mocks cannot represent.

Evidence ladder:

1. static/type/lint checks;
2. unit tests for pure decisions;
3. component/module tests;
4. contract/protocol/schema tests;
5. integration tests with real DB/queue/runtime owners;
6. browser/E2E tests for critical user flows;
7. fault/race/load/package tests where mechanism matters;
8. canary/production verification when production participates in the contract.

A test should fail for the regression it is meant to prevent.

## Test-code semantic self-check

Tests can be wrong even when the product is right. Before trusting a newly written or modified assertion, inspect the test code itself as an executable specification.

For string-heavy assertions, explicitly distinguish **source-code escape syntax** from the **runtime value**:
- `"\\n"` means a backslash followed by `n`;
- `"\n"` represents an actual newline at runtime;
- apply the same check to `\t`, `\r`, `\\`, quotes, regex escapes, shell quoting, JSON escaping, and nested language/tool layers.

Before finishing test code, self-check:
- escape characters: confirm each `\n`, `\t`, `\r`, `\\`, quote, regex, or shell escape is intended as a literal sequence or an actual control character;
- value types: confirm actual and expected values have compatible types such as `str` vs `bytes`, numeric vs string, path object vs string, decoded vs encoded data;
- multiline text: confirm normalization rules and platform line endings such as `\n` vs `\r\n` are intentional;
- encoding: confirm UTF-8/text decoding boundaries before comparing textual output;
- collection/order semantics: confirm order-sensitive assertions are only used when order is part of the contract;
- generated expectations: inspect the expectation rather than copying output blindly;
- prompt/docs assertions: assert the semantic contract or structured field, not incidental Markdown punctuation/quoting, unless that formatting is itself the contract.

For Python test files after programmatic text generation or replacement, run `python -m compileall` or an equivalent syntax check before waiting on a broader CI suite. For other languages, use the cheapest parser/type/lint check that can catch malformed test source first.

When a new test fails at parse/import/collection time, classify it as a **test-source/harness defect** before treating it as product evidence.

## Keep tests deterministic and isolated

Control sources of nondeterminism:

- clock/timezone;
- random IDs/data;
- locale;
- network;
- process environment;
- test ordering;
- shared database rows;
- queue state;
- browser storage/session;
- parallel workers.

Prefer explicit fake clocks and seeded randomness to sleeps. Give each test independent state or a reliable reset boundary.

Playwright's current best practices emphasize isolated tests, user-visible behavior, resilient locators, and web-first assertions:
https://playwright.dev/docs/best-practices

## Separate product regressions from harness state pollution

A red test is evidence that the observed execution failed, not proof that product code owns the failure. Before changing production behavior, check whether the harness changed process-global state that survives between cases: module/loader caches, dependency or service registries, static/singleton objects, environment variables, fake timers, locale/timezone, temporary-path identity, connection pools, browser profiles, or monkeypatches.

When a negative fixture mutates something globally and a later positive control reuses the same identity, do not assume rewriting the underlying file/config/object resets the runtime. Prefer a fresh process when process identity is the real isolation boundary, or give each control a distinct module/path/profile/database/resource identity. Clear global caches only when cache invalidation itself is the behavior under test; otherwise clearing them can hide the leak instead of proving isolation.

Use cheap discriminators before patching the product:

1. run the failing case alone in a fresh process/environment;
2. reverse or randomize case order when order dependence is plausible;
3. give positive and negative controls independent fixture identities;
4. rerun the real product path after harness isolation is restored.

If the failure disappears only after isolation changes, classify it as a test/harness defect unless separate evidence still implicates production behavior. If it survives a clean harness and the same active product path, continue product debugging. Do not make product code compensate for a test process that leaked state across cases.

## Use real infrastructure where semantics matter

Mocks are useful for deterministic domain logic and hard-to-trigger external failures. They are weak evidence for semantics owned by a real system.

Use real infrastructure or a faithful local equivalent when validating:

- DB isolation/locking/constraints/query plans;
- queue delivery/redelivery/visibility semantics;
- object storage metadata/conditional writes;
- browser/runtime lifecycle;
- serialization/protocol compatibility;
- reverse proxy/TLS behavior;
- migration behavior.

Do not mock the exact mechanism whose behavior caused the bug.

When the main uncertainty is owned by a real platform/runtime boundary (for example Windows service recovery, Electron lifecycle, browser process behavior, or a real client integration), run the cheapest available **real-boundary discriminator early** once that boundary is known. Do this before broad implementation or a large green suite when a small platform smoke can falsify the design. Early does not mean maximal E2E: prove the risky mechanism first, then expand validation after it survives.

## Test time, retries, concurrency, and duplicates

Concurrency bugs often pass normal happy-path suites.

Exercise:

- duplicate submit/request;
- timeout after server commit;
- delayed stale response;
- A -> B -> A identity reuse;
- concurrent write conflict;
- queue redelivery;
- lease expiry;
- retry after 429/5xx;
- process crash between durable steps;
- cancellation during completion;
- clock boundary/timezone/DST where material.

Assert the authoritative final state, not only callback count.

## Test compatibility and migrations

For versioned or persisted contracts, test the coexistence window explicitly.

Examples:

- old app + expanded DB schema;
- new app + old nullable field population;
- old worker reads new additive event;
- new worker handles old event;
- backfill resumes after interruption;
- dual-read/write cutover reconciles correctly;
- rollback does not require reversing irreversible data loss.

Do not declare expand-and-contract safe without testing at least the versions that can actually overlap in production.

## Test frontend behavior like a user

Prefer semantic roles, labels, and visible postconditions over CSS classes or component internals.

Exercise critical UI states:

- loading and empty;
- success;
- retryable error;
- terminal error;
- unauthorized;
- stale data;
- optimistic rollback;
- navigation/reload/back-forward;
- keyboard/focus behavior;
- slow responses and duplicate clicks.

Keep the E2E suite focused on valuable flows. Push deterministic branching logic lower in the pyramid when it does not require a browser.

## Test third-party boundaries deliberately

Do not make CI depend on uncontrolled third-party availability unless it is an explicit smoke/integration job.

At the adapter boundary:

- contract-test request shape and error normalization;
- replay provider fixtures where allowed;
- simulate timeout/rate-limit/5xx/malformed responses;
- keep a small scheduled or staging smoke test against the real dependency when that evidence is valuable;
- re-check vendor versions/auth behavior for volatile integrations.

Playwright explicitly recommends testing what you control and stubbing uncontrolled third parties in normal browser tests:
https://playwright.dev/docs/best-practices

## Treat flaky tests as defects

Do not normalize rerunning until green.

Classify flakiness:

- product race exposed by the test;
- test isolation leak;
- timing/sleep problem;
- environment/resource contention;
- uncontrolled external dependency;
- selector/assertion instability;
- nondeterministic data/order.

Use traces/logs/artifacts to identify the mechanism. Quarantine only with an owner, reason, and removal condition when blocking the whole pipeline would be worse.

When CI goes red during a focused frontier, classify the failure before letting it redirect the mission: **candidate-causal**, **pre-existing baseline**, **harness/flaky**, or **infrastructure/tooling**. Candidate-causal failures and failures that block the current completion claim belong to the active frontier; independent baseline debt stays queued unless it exposes materially higher consequence. Do not patch unrelated product code merely to make a broad pipeline green.

## Distinguish oracle execution from CI projection

Treat aggregate checks, required status contexts, and status-publisher jobs as **projections of validation truth**, not the validation oracle itself. Diagnose two layers separately:

`required oracle applicability/execution/conclusion -> CI aggregate/status/ruleset projection`

Before accepting a green or red gate, verify the required oracle actually ran for the current head/base/change surface and inspect its terminal conclusion. A skipped job counts as evidence only when the current contract makes that lane genuinely not applicable; a required oracle silently skipped by a stale branch allowlist, path filter, or job condition is **missing evidence**, not a pass. Cancelled, pending, missing, or never-published required contexts are not success.

The reverse can also occur: authoritative product jobs may pass while a terminal status publisher, aggregate job, or ruleset-context mapping fails. Preserve the product evidence that is still correctly bound, repair the CI/control-plane projection, and reacquire the final merge-gate proof; do not mutate product code merely to turn a broken status projection green. Keep exact required-context names and applicability conditions under repository governance rather than assuming a same-looking workflow job proves the ruleset contract.

## Build risk-based quality gates

Map gates to change surfaces.

Examples:

- auth/tenant change -> negative authorization tests + audit/log review;
- migration -> compatibility + restore/backfill validation;
- dependency/runtime upgrade -> exact-version package/E2E smoke;
- queue change -> duplicate/redelivery/retry tests;
- UI interaction change -> browser + accessibility path;
- performance-sensitive change -> baseline/candidate benchmark;
- release tooling -> artifact/provenance/promotion validation.

Do not run every expensive suite for every documentation-only change unless repository policy requires it.

## Mature references

- Playwright best practices: https://playwright.dev/docs/best-practices
- Testing Library query guidance: https://testing-library.com/docs/queries/about/
- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- Google SRE testing/reliability material: https://sre.google/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
