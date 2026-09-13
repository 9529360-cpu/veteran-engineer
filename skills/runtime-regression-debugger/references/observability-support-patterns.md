# Observability and support patterns for multi-service desktop runtimes

## Contents

- Model service health as explicit states
- Separate runtime layers in readiness evidence
- Correlate by generation, not by account name or PID alone
- Build privacy-safe support bundles
- Use network logs safely
- Use crash and process metrics as evidence
- Keep diagnostics observational
- Test failure and recovery transitions
- Current references to consult live

## Model service health as explicit states

Do not reduce a remote service to one `loading` or `ready` boolean. A scalable container needs enough states to tell different owners apart.

A useful conceptual state machine can distinguish states such as:

`created -> attaching -> navigating -> document-loaded -> auth-required -> integration-ready -> business-ready`

and exceptional/lifecycle states such as:

`offline`, `degraded`, `blocked-or-unsupported`, `unresponsive`, `renderer-gone`, `hibernated`, and `destroyed`.

The exact names are product-specific. The important rule is that each state has:

- one owner;
- one evidence source;
- an allowed set of transitions;
- a bounded recovery policy;
- a user-visible meaning when relevant.

Do not infer `business-ready` from a spinner stopping. Do not infer `logged-in` from `dom-ready`. Do not infer remote-page health from an injected bridge being present.

## Separate runtime layers in readiness evidence

Record readiness at independent layers instead of compressing them into one success bit:

1. **container**: intended WebContents exists and belongs to the intended Session/account generation;
2. **navigation**: the intended main-frame origin committed or failed;
3. **document**: DOM/document lifecycle reached the required point;
4. **authentication**: the page is clearly logged out, authenticating, or authenticated when this can be determined without reading private content;
5. **adapter/bridge**: the integration code is installed and its narrow public contract is available;
6. **business capability**: the actual required operation is available or completes;
7. **host shell**: notifications, downloads, deep links, tray/taskbar, and other native projections work where required.

This prevents a common false conclusion: `did-finish-load` passed, therefore the service works.

Use Electron lifecycle events such as navigation/load failure, `dom-ready`, `render-process-gone`, `unresponsive`, `responsive`, and `destroyed` as runtime evidence, but interpret each event only at its own layer.

## Correlate by generation, not by account name or PID alone

For every diagnostic transition, capture the smallest non-sensitive correlation identity that can prove ownership:

`runtime build -> service adapter version/digest -> synthetic/account-local opaque key -> Session identity -> WebContents identity -> document/navigation generation -> request/operation generation`

Do not log real email addresses, phone numbers, user-entered service names, message IDs, tenant secrets, or URLs containing paths/query/hash just because they are convenient identifiers.

A process PID is not an account identity. Chromium may reuse or share renderer processes, and operating systems may reuse PIDs after exit. When process-level metrics are used, include process creation time and separately map the metric back to the current WebContents/lifecycle owner.

## Build privacy-safe support bundles

A useful support bundle should answer "what runtime and transition failed?" without capturing private service data.

Prefer fields such as:

- application version and build/commit identity when available;
- Electron/Chromium version, OS, architecture, packaged state;
- adapter/recipe version or digest;
- service category or adapter ID, not the user's account label;
- persistent/in-memory Session class and a synthetic or one-way local diagnostic identity;
- current top-level **origin only** when it is safe and necessary; strip path, query, fragment, credentials, and tokens;
- WebContents/document/navigation generation and lifecycle timestamps;
- sanitized network error category/code and HTTP status class when needed;
- permission capability/result booleans without device names or user data;
- service-worker/storage support and bounded counts, not stored values;
- renderer/crash/unresponsive reason category;
- resource metrics such as CPU, memory, idle wakeups, and process type;
- host-shell state such as notification permission/result or deep-link dispatch outcome;
- recovery attempts and final postcondition.

Do not include cookies, Authorization headers, bearer tokens, passwords, chat/message bodies, form values, localStorage/IndexedDB contents, private URL parameters, clipboard contents, filesystem document contents, or raw console/network bodies.

Make bundles bounded in size and duration. State clearly when the user must opt in to collection or upload.

## Use network logs safely

Electron's `netLog` can capture detailed Chromium network events. Treat capture mode as a privacy boundary.

- Prefer the default metadata-oriented capture for routine diagnostics.
- Bound file size and collection duration.
- Treat `includeSensitive` or full socket-byte capture as exceptional because it can contain cookies, authentication data, or content.
- Require an explicit debugging need and appropriate user consent before collecting sensitive modes.
- Prefer sanitized request origin, failure category, timing, proxy route category, and connection transitions over raw headers/body.
- Delete or expire temporary diagnostic artifacts according to the product's support/privacy policy.

Do not turn always-on sensitive network logging into telemetry.

## Use crash and process metrics as evidence

Crash telemetry can establish that a renderer, GPU, utility, or main process failed, but it cannot prove which user-visible contract broke unless it is correlated with the current runtime generation.

If crash reporting is used:

- initialize it early enough to cover the intended processes;
- keep annotations non-sensitive and bounded;
- include build/runtime and synthetic generation data rather than private account data;
- respect product consent/telemetry policy;
- distinguish a crash report from a handled `did-fail-load`, auth error, vendor error page, or network outage.

For resource regressions, use process metrics as measurement, not intuition. Track CPU, memory, process type, creation time, and idle wakeups over comparable intervals. Verify that resources return toward baseline after service destruction/hibernation where the contract expects reclamation.

## Keep diagnostics observational

A probe must not become a hidden second behavior owner.

Do not make diagnostic collection automatically:

- clear cache or storage;
- delete a Session;
- reload repeatedly;
- modify User-Agent or proxy;
- grant permissions;
- suppress certificate errors;
- change service adapter version;
- inject a second business implementation.

If recovery is a real product feature, model it as an explicit state transition with its own owner, limits, and tests. Keep the diagnostic path read-only wherever practical.

## Test failure and recovery transitions

Do not test only the happy `ready` state. Exercise representative transitions:

- initial navigation failure -> bounded retry -> ready;
- offline startup -> degraded/local state -> network returns -> reconcile -> ready;
- auth-required -> popup/deep-link/passkey/enterprise auth -> authenticated;
- adapter install failure -> last-known-good or explicit degraded state;
- renderer crash/unresponsive -> new generation -> rebind -> ready;
- suspend -> network not yet ready -> bounded backoff/stagger -> ready;
- hibernate -> wake -> same Session identity + new document generation;
- service removed -> WebContents destroyed -> Session cleanup policy -> resources return;
- native notification/deep-link activation -> exact intended account/context.

Assert forbidden transitions as well. A destroyed or stale generation must not later report itself ready or mutate current UI.

## Current references to consult live

Re-read current versions before implementing because runtime behavior and APIs evolve:

- Electron `webContents` lifecycle events and navigation failure APIs;
- Electron `app.getAppMetrics()` and `ProcessMetric` structures;
- Electron `process` memory/CPU metrics;
- Electron `netLog`, especially capture-mode privacy implications;
- Electron `crashReporter` and its process/annotation semantics;
- Electron performance guidance and Chrome tracing;
- the target service's status/support pages and active incident reports;
- mature multi-service desktop clients' current issue/diagnostic flows for field evidence.

Use those sources to learn mechanisms. The installed real client and its exact Session/WebContents generations remain the authority for a specific failure.
