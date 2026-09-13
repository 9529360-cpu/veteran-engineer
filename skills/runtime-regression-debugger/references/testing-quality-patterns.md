# Testing and quality engineering patterns

## Contents

- Start from contracts and risks
- Choose the strongest practical boundary
- Keep tests deterministic and isolated
- Use real infrastructure where semantics matter
- Test time, retries, concurrency, and duplicates
- Test compatibility and migrations
- Test frontend behavior like a user
- Test third-party boundaries deliberately
- Treat flaky tests as defects
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
