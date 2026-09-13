# Browser extension product engineering

Use this for Chrome/Chromium, Firefox, and WebExtension-style products, including plain manifest-based extensions and framework-managed projects such as WXT or Plasmo. Treat an extension as a distributed product spanning privileged extension contexts, ordinary web pages, browser policy, user-granted permissions, and store-controlled release—not as a normal frontend bundle with extra APIs.

## Contents

- Compile the extension contract
- Recover the real authority and generated sources
- Background/service-worker lifecycle
- Content scripts, page worlds, and injection
- Permissions and host authority
- Messaging and identity
- Storage, cache, and synchronization
- Authentication and account scope
- Security, CSP, and untrusted page data
- Cross-browser and manifest compatibility
- Updates, migrations, and store release
- Validation shape
- Whole-slice completion

## Compile the extension contract

Start from the user-visible transition:

`browser/user event -> active extension context -> permission/host gate -> page/browser/backend effect -> durable state -> visible completion or recovery`

Capture only constraints that change implementation:

- supported browsers and minimum versions;
- Manifest V2/V3 or framework-generated manifest authority;
- contexts involved: service worker/background page, popup, side panel, options page, content script, injected page-world script, devtools page, offscreen document, native messaging host where material;
- exact origins/hosts the feature may access;
- permissions that are required, optional, or requested at runtime;
- account/profile/incognito/private-window scope;
- backend/API compatibility and auth/session ownership;
- state that must survive service-worker suspension, browser restart, extension update, or permission revocation;
- update/store compatibility and migration requirements.

Do not infer authority from a UI surface. A popup being visible does not mean it owns the durable state, current tab identity, host permission, or backend authorization.

## Recover the real authority and generated sources

Before editing, find the manifest/build source of truth.

Inspect package/build manifests, extension framework config, manifest generators, browser-specific overrides, entrypoint declarations, permissions/host permissions, content-script match rules, background/service-worker registration, web-accessible resources, CSP, externally connectable rules, commands, and store/build scripts.

Framework-generated `manifest.json` files may be projections. Patch WXT/Plasmo/CRXJS/framework config or manifest generator inputs when those own the output. Do not hand-edit generated browser artifacts unless the repository explicitly treats them as authoritative.

Map each entrypoint to its execution authority. Typical boundaries are:

- extension service worker/background context: privileged orchestration and browser APIs;
- popup/side-panel/options UI: short-lived extension pages;
- content script: extension-isolated code attached to a page;
- page-world injection: code executing with page JavaScript authority and page risk;
- backend: server-side authorization and durable business authority.

## Background/service-worker lifecycle

Manifest V3 service workers are intentionally suspendable. Never rely on process lifetime as durable state.

- Persist state needed after suspension before acknowledging completion.
- Reconstruct listeners and routing deterministically on startup.
- Treat timers and in-memory queues as hints, not durable schedulers.
- Use browser-supported alarms/events for resumable work when appropriate.
- Keep retryable mutations idempotent because the worker may terminate after a server commit but before local acknowledgement.
- Re-read current tab/window/account state before committing delayed work; stale IDs can be reused or point at a changed document.
- Model browser restart, extension reload/update, service-worker restart, and permission revocation as ordinary lifecycle transitions.

A successful API call inside one worker generation does not prove the popup/content script that initiated it still exists or represents the same page generation.

## Content scripts, page worlds, and injection

Treat content scripts and page JavaScript as separate trust/runtime domains even when they share a DOM.

- Content scripts should receive the minimum data/action surface they need.
- DOM text, attributes, page messages, and page-provided objects are untrusted input.
- Do not expose privileged extension operations directly to page-world messages without validating origin, frame, tab/document identity, schema, and allowed action.
- When main-world injection is required, keep the bridge narrow and explicit; page code can monkey-patch globals, prototypes, events, and DOM APIs.
- Bind async results to document/frame generation so navigation cannot redirect an old result into a new page.
- Define iframe behavior explicitly; `all_frames` or broad match patterns are not harmless convenience flags.

Prefer semantic extraction and explicit page adapters over brittle selectors copied across unrelated sites. For third-party-site integrations, treat DOM/API changes as external dependency compatibility.

## Permissions and host authority

Extension permissions are product and security contracts, not packaging metadata.

Separate:

- API permissions such as storage, tabs, scripting, notifications, downloads, identity, or native messaging;
- host permissions that permit origin access;
- optional permissions granted later by user intent;
- active-tab style temporary authority;
- enterprise/browser policy authority.

Request the narrowest permission at the user-intent boundary when practical. Define behavior for not granted, denied, later revoked, unsupported, enterprise-blocked, and incognito/private-window restrictions.

Never treat a manifest host pattern as backend authorization. Server-side objects/actions still require normal principal/tenant/object/action checks.

When permission scope expands, treat it as a release/product change: browser stores or users may surface new consent, and existing installations may not immediately gain the new authority.

## Messaging and identity

Extension messaging crosses short-lived contexts and must carry enough identity to reject stale or spoofed work.

For material messages preserve:

`message kind + schema/version + sender context + tab/window/frame/document identity + account/tenant identity + request/effect identity`

Validate messages at the privileged receiver. Do not authorize an action because a content script or popup supplied a plausible tab/account ID.

For request/response flows:

- define timeout and receiver-missing behavior;
- tolerate popup/page closure while work continues;
- avoid assuming one listener exists exactly once after hot reload/update;
- make duplicate/redelivered effectful messages safe;
- distinguish transport failure from business rejection and permission loss.

Externally connectable/native-messaging boundaries require stronger allowlists and schema validation because the sender may be outside the extension package.

## Storage, cache, and synchronization

Classify extension state deliberately:

- ephemeral UI/view state;
- per-tab/per-document projections;
- extension-local durable state;
- synchronized browser-account state;
- authoritative server state.

Browser storage APIs can have quotas, synchronization delay, cross-device merge behavior, and browser-specific limits. Do not use synchronized storage as a transactional database.

Namespace multi-account state explicitly. On logout/account removal, clear credentials, account-scoped caches, queued mutations, alarms/jobs, badge state, page injections/listeners where applicable, and backend notification/subscription registrations.

If local writes may replay after offline periods or worker restart, give them stable identities and define conflict/reconciliation behavior against server state.

## Authentication and account scope

Browser profile identity, website session identity, and product/backend account identity are different owners.

- Do not assume a content script can safely reuse website cookies for privileged backend calls.
- Keep extension credentials in the extension authority appropriate to the browser/platform; never expose tokens to page-world JavaScript or DOM.
- Bind OAuth/login callbacks to the initiating extension/account transaction and validate redirect state.
- Define behavior when the website account switches while the extension remains logged into another account.
- Treat incognito/private contexts and split/incognito access rules explicitly.

## Security, CSP, and untrusted page data

Preserve the browser extension security model instead of weakening it to make integration easy.

- Do not enable remote executable code as a shortcut around bundling/update restrictions.
- Keep extension CSP and web-accessible resources narrow.
- Validate URLs before navigation, downloads, external opens, or requests.
- Treat page DOM, postMessage payloads, externally supplied URLs, and remote config as untrusted data.
- Avoid unsafe HTML/script sinks; privileged extension pages deserve the same XSS discipline as server-admin surfaces.
- Do not log credentials, cookies, authorization headers, full sensitive page contents, or unnecessary browsing data to telemetry.
- Minimize collection/retention of browsing history, page content, identifiers, and other privacy-sensitive data.

## Cross-browser and manifest compatibility

Do not assume Chrome behavior proves Firefox/other Chromium behavior.

Recover which compatibility layer the repository uses: direct browser APIs, `browser.*`/polyfill, framework abstraction, or browser-specific builds.

For material differences, keep explicit compatibility behavior instead of hiding them behind an abstraction that discards semantics. Check current official browser documentation for version-sensitive APIs, permission behavior, store policy, and Manifest support before implementation.

If multiple manifests/builds exist, keep their permissions, CSP, match patterns, entrypoints, and generated assets semantically aligned unless a deliberate browser difference is documented and tested.

## Updates, migrations, and store release

Extension clients update asynchronously and may remain on old versions while backend/server contracts evolve.

- Keep backend APIs compatible with supported installed versions.
- Version durable extension storage when schema shape changes; make migrations restart-safe.
- Treat extension update/reload as a lifecycle event that can interrupt queued work.
- Verify update behavior from an actually installed previous version when migration risk is material.
- Distinguish development load/unpacked validation from packaged/store artifact validation.
- Validate the final package contents: manifest, permissions, host patterns, CSP, source maps/debug assets, icons/resources, generated entries, secrets/config, and excluded development files.
- Account for store review and phased propagation; server rollback is usually faster than browser-store rollback.

A successful local build is not proof that the submitted ZIP/package has the same manifest or runtime behavior.

## Validation shape

Choose evidence from the changed boundary:

- pure domain/state logic -> unit/property tests;
- manifest generation/routing -> generated-manifest assertions plus package inspection;
- permission/host gating -> explicit granted/denied/revoked tests;
- background lifecycle -> restart/suspension-resume tests with durable state;
- messaging -> schema, sender identity, duplicate, timeout, missing-receiver, and stale-document tests;
- content/page integration -> browser integration tests against representative page states and navigation;
- auth -> redirect transaction, account switching, expired session, and denial paths;
- cross-browser behavior -> supported-browser smoke/E2E where the environment permits;
- release changes -> packaged artifact load/install smoke, not dev-server/unpacked-only proof.

When only Chromium can be executed, state that validation boundary explicitly and preserve negative-space review for Firefox/browser-specific behavior.

## Whole-slice completion

An extension feature is not complete because a popup renders or a content script fires. Close the implied responsibilities: manifest/generated authority, permission/host scope, background lifecycle, tab/document identity, messaging, backend authorization, storage/migration, auth/account cleanup, privacy/telemetry, cross-browser behavior, tests, package contents, store/update compatibility, and removal/rollback behavior.

Prefer the repository's existing extension framework and build authority. Do not migrate Manifest generation, framework, browser polyfill, bundler, or store tooling unless the requested contract requires it.
