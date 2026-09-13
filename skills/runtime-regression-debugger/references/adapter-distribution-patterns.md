# Adapter distribution and control-plane patterns

## Contents

- Treat remote adapters as code distribution
- Stable core versus service definition
- Compatibility metadata
- Immutable adapter artifacts and authenticated manifests
- Rollback, freeze, and mix-and-match resistance
- Kill switches and staged exposure
- Shared configuration versus private browser state
- Control plane versus data plane
- Offline/degraded boot
- Polling and adapter runtime budgets
- Adapter observability
- Validation and promotion
- Mature references to consult live

## Treat remote adapters as code distribution

A remotely updateable service adapter, recipe, content script, CSS/JS injection, preload fragment, or rule bundle can change product behavior without a desktop release.

If an adapter can execute script or widen navigation/permission behavior, treat its distribution path as software update infrastructure, not as harmless catalog data.

Do not fetch a mutable `latest.js` and execute it in a privileged or broadly bridged context.

## Stable core versus service definition

Keep the stable host core responsible for:

- account/session identity;
- WebContents lifecycle;
- security/sandbox/context isolation;
- permission enforcement;
- navigation/new-window/external-link policy framework;
- downloads and filesystem handoff;
- resource accounting/recovery;
- adapter verification/loading.

Let service definitions/adapters declare only the narrow differences they actually own.

A service adapter must not be able to silently disable global security invariants because one website is difficult to embed.

## Compatibility metadata

Version every adapter definition that can materially affect behavior.

Useful metadata includes:

- adapter version;
- content digest;
- minimum/maximum tested host/runtime versions or compatibility range;
- service identifier/schema version;
- declared capabilities;
- entry/auth-origin policy;
- optional migration marker for adapter-owned state;
- release/publish timestamp when operationally useful.

Do not infer compatibility from publication date alone.

## Immutable adapter artifacts and authenticated manifests

Prefer:

`immutable adapter artifact -> cryptographic digest -> authenticated/versioned manifest -> client verifies -> activate`

Keep the mutable discovery pointer small. The effective adapter bytes should be immutable/content-addressed or at least version-addressed.

If remote adapter delivery is security-sensitive, use signed/authenticated metadata or another mechanism that prevents an attacker or misconfigured CDN from substituting arbitrary adapter bytes.

Hash verification detects byte substitution but does not by itself establish who authorized the hash. Model both integrity and authority.

## Rollback, freeze, and mix-and-match resistance

Borrow update-system security principles even when a full TUF implementation is unnecessary.

Protect against:

- **rollback**: an old vulnerable adapter is served as current;
- **freeze**: a client is kept forever on stale metadata;
- **mix-and-match**: manifest from one release references artifacts from another state;
- **partial publish**: discovery metadata points to missing/incomplete adapter files.

Useful controls include monotonic metadata versions, expiry/freshness, immutable targets, hashes, authenticated metadata, and publish ordering.

Do not make "clear adapter cache" the only recovery from stale metadata.

## Kill switches and staged exposure

For high-risk adapters, design a service-local recovery mechanism that does not require reverting the whole desktop app.

Possible controls:

- disable one adapter version;
- fall back to a known-good built-in adapter;
- turn off one optional capability/injection;
- stage exposure to a bounded cohort;
- pin a known-good adapter temporarily while incident analysis continues.

A kill switch must fail safely. It must not remotely grant new privileged capabilities or bypass the same verification policy as normal updates.

## Shared configuration versus private browser state

Team/workspace synchronization should separate portable configuration from local/private identity.

Safe-to-sync examples may include:

- service definitions and ordering;
- workspace/group layout;
- adapter versions;
- capability policy chosen by administrators;
- non-secret UI preferences.

Private-by-default examples:

- cookies/session storage;
- passwords/tokens;
- client certificates;
- proxy credentials;
- local downloads;
- browsing history/private URLs;
- OS-keychain material.

A mature multi-account product can sync "which apps/accounts exist" without syncing the browser credential state of those accounts.

## Control plane versus data plane

Separate the system that tells the client **what integrations/configuration exist** from the remote websites the user is actually using.

Control-plane examples:

- service catalog/recipe manifest;
- licensing/subscription state;
- cloud workspace sync;
- adapter update feed;
- feature policy.

Data-plane examples:

- each embedded service's own web traffic;
- user interactions inside that service;
- service-owned realtime connections.

A control-plane outage should not automatically erase local account mappings or corrupt browser Sessions. Decide deliberately which capabilities can continue from a last-known-good local manifest and which must stop for policy/security reasons.

Apply remote configuration transactionally: `fetch -> parse -> authenticate/verify -> schema/compatibility validate -> stage -> atomically activate`. Network success alone must never replace a known-good local state. A partial JSON body, empty list, server error page, stale cache intermediary, or incompatible schema must fail before activation.

## Offline/degraded boot

For products expected to remain useful when their own backend is unavailable:

1. persist a validated last-known-good configuration/adapter manifest;
2. verify its integrity and expiry/rollback rules before reuse;
3. boot local account/session mappings from that state;
4. mark control-plane-dependent features degraded;
5. retry control-plane sync with bounded backoff;
6. never replace good local state with an empty/partial network response;
7. make degraded mode visible and define whether configuration changes are read-only, queued, or rejected;
8. reconcile remote changes with a version/precondition when connectivity returns so a stale offline client cannot silently overwrite newer server state.

Do not apply this pattern if the product contract requires online authorization for safety/licensing; encode the policy explicitly.

## Polling and adapter runtime budgets

A cheap polling loop becomes expensive when multiplied by many services/accounts.

Each adapter should have an explicit runtime budget for:

- DOM polling frequency;
- MutationObserver breadth;
- network/API polling;
- retry/backoff;
- CPU-heavy parsing;
- injected script count;
- background behavior while hidden/hibernated.

Prefer event-driven signals where stable. When polling is required, make cadence service-specific, bounded, jittered/backed off where network is involved, and suspended or reduced when semantics allow.

Do not impose one global high-frequency interval on every integration.

## Adapter observability

Record enough non-sensitive facts to prove what actually loaded:

`service id -> account/session id (non-sensitive internal key) -> adapter version/digest -> host/runtime version -> effective entry URL origin -> capability state -> document generation`

Do not log user content, cookies, tokens, auth headers, private URL query/hash, or raw page console text by default.

When a config update "did nothing", prove the chain from source manifest through cache/install to loaded runtime rather than deleting profiles blindly.

## Validation and promotion

For an adapter-only change, still validate the failed boundary:

- schema/static validation;
- credential-free bootstrap when relevant;
- navigation/auth policy;
- authenticated capability if affected;
- multi-account/session isolation;
- resource/polling behavior;
- compatibility with supported host/runtime range;
- rollback to the previous adapter.

Promote the adapter only after the target artifact exists and its manifest/digest are internally consistent.

## Mature references to consult live

Useful current source families:

- maintained recipe/adapter ecosystems for multi-service desktop clients;
- Electron Security/Session/WebContents/Extensions documentation;
- The Update Framework security model for rollback/freeze/mix-and-match principles;
- current artifact signing/attestation mechanisms used by the project's build platform;
- established multi-account products that separate shared workspace definitions from users' local login sessions.

Use these as mechanisms. Do not copy a remote-code model that weakens the host's security boundary.
