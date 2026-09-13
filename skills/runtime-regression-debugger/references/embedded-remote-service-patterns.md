# Embedded remote service patterns

## Contents

- Runtime identity model
- Workspace/config identity versus browser identity
- Persistent session isolation
- Guest/WebContents lifecycle
- Registration-before-probe
- Remote-content security boundary
- Adapter and injection ownership
- Vendor bootstrap/version strategy
- Credential-free health gates
- Account reset and partition cleanup
- Embedding architecture migration
- Upstream activity research loop
- Mature patterns to consult live

## Runtime identity model

Treat each embedded remote service instance as a runtime identity:

`service/provider + account -> Session/partition -> WebContents -> document generation -> adapter/injection -> business capability`

A visible tab, label, or URL is only a projection of that identity. When the WebContents or document is replaced, references, listeners, DOM handles, and async results from the previous generation become suspect.

Do not equate account identity with an OS renderer PID. Chromium's process model is a security/performance implementation detail and WebContents can sometimes share renderer processes while keeping independent lifecycle objects. Use Session/profile identity for browser state and WebContents/document generations for actions; use process identity only for diagnostics and fault-domain reasoning.

## Workspace/config identity versus browser identity

Organizational containers and browser authentication profiles are different identities. Keep a hierarchy such as:

`workspace/space -> service instance -> account profile -> Session -> WebContents generation`

Workspaces may synchronize layout/configuration without synchronizing cookies or credentials. Do not share a Session merely because two service instances belong to one workspace, and do not duplicate browser state merely to make workspace sync easier.

## Persistent session isolation

For multi-account products, assign stable persistent partitions deliberately. Electron's Session model makes the partition the owner of cookies, cache, storage, service workers, and related browser state.

Rules:

- one intended account/service identity maps to one intended persistent partition unless deliberate sharing is a product feature;
- configure Session options before the Session is first created/used;
- set the partition before navigation; do not expect an active renderer's Session identity to change in place;
- prove the actual `webContents.session` rather than inferring it from UI metadata;
- treat default-session fallback as a security and account-isolation event, not a harmless convenience.

Long-running multi-service clients such as Rambox and Ferdium illustrate the value of persistent per-service partitions. Use such projects as architecture references, not copy-paste sources.

## Guest/WebContents lifecycle

Guest content is replaceable. Bind behavior to the current generation.

A mature pattern is:

`new guest reference -> remove listeners from previous guest -> attach listeners to current guest -> on detach/unmount destroy/cleanup symmetrically`

Useful lifecycle evidence:

- `did-start-navigation`, `did-navigate`, `did-finish-load`, `did-fail-load`;
- `dom-ready`, `did-stop-loading`;
- `render-process-gone`, `unresponsive`, `responsive`, `destroyed`;
- document/main-frame identity and navigation generation.

If attach timing itself races, confirm that race with evidence before adding deferral. A zero-delay/new-task deferral can be a valid lifecycle repair when an attach event fires before the host tree/reference is usable, but it should not become a generic sleep.

## Registration-before-probe

Initialization must not perform a fallible attach-dependent lookup before installing the minimum listeners that can observe completion, failure, navigation, or destruction. A thrown `getId()`/owner lookup can otherwise leave the host permanently “loading” because the very callbacks that clear the state were never registered.

Prefer:

`obtain owner reference -> register critical lifecycle observers -> perform optional derived probes -> enrich diagnostics`

Isolate convenience/diagnostic probe failures from observer registration. Test repeated cold starts with multiple simultaneous services because attach-order races can disappear in a single warm start.

## Remote-content security boundary

Remote services are untrusted content even when the product depends on them.

Keep:

- sandboxing enabled;
- Node integration disabled for remote pages;
- context isolation enabled where compatible;
- web security enabled;
- permission request/check handlers scoped to intended origins and sessions;
- navigation and new-window destinations constrained;
- IPC sender/frame validation;
- narrow preload/contextBridge surfaces instead of raw Electron APIs.

Do not weaken these controls to make a vendor page load. A compatibility fix that expands remote-code authority is usually worse than the regression.

## Adapter and injection ownership

Separate at least four layers:

1. vendor bootstrap/page;
2. vendor loader/module graph;
3. product adapter/injection/recipe;
4. authenticated business capability.

Examples of adapter behavior include unread-count observers, notification bridges, message-send APIs, translation hooks, custom CSS, or service-specific DOM patches.

If layer 1 never becomes healthy, changing layer 3 readiness logic cannot be the first root-cause fix. If layer 3 is broken while layer 1 and 2 are healthy, do not replace the Session or vendor bootstrap as a workaround.

## Vendor bootstrap/version strategy

A cached or pinned bootstrap is a dependency-management system, not a static asset.

Risky state:

`historical HTML + current remote scripts/workers/backend`

This creates a mixed-version runtime even when the local file never changes.

Prefer one of two explicit strategies:

### Follow current vendor bootstrap

Use the vendor's current secure entry point and maintain compatibility tests around the adapter layer. This minimizes mixed-version bootstrap skew but accepts upstream change risk.

### Pin/cache by explicit version

If pinning is required, use version-addressed cache entries with a defined refresh/fallback policy. A mature cache abstraction should be able to say either "strictly require version X" or "fall back to current/available version" intentionally. Do not leave one unnamed snapshot in place indefinitely.

For regressions, compare current vs pinned under the same runtime/session/UA/environment. Source/version should be the only changed variable.

## Credential-free health gates

Do not require credentials when the failing boundary is pre-authentication.

Useful early postconditions:

- loading/progress shell disappears;
- login/QR/auth-required UI appears;
- the vendor loader global/module system exists;
- the main frame is responsive and at the expected secure origin;
- expected adapter bootstrap can begin without user data.

These checks can run in hosted CI with synthetic partitions and provide an upstream canary without exposing real accounts.

## Account reset and partition cleanup

Account deletion has two owners: live browser state and partition files on disk.

Preferred sequence:

1. identify the exact Session/partition;
2. clear only the required browser storage/state through Electron's Session APIs if product semantics require reset;
3. destroy/detach guest owners that keep the Session alive;
4. remove partition files when no longer locked;
5. if the runtime still holds files open, persist a bounded pending-deletion record and retry at a safe early startup point before recreating that partition.

Do not recursively delete arbitrary user-data directories while a live Chromium Session still owns them. Validate partition names against traversal/path injection before filesystem cleanup.

## Embedding architecture migration

Electron currently warns that `<webview>` has architectural stability concerns and recommends evaluating alternatives such as `WebContentsView`, `iframe` where appropriate, or avoiding embedded content.

Treat this as a roadmap signal, not an emergency rewrite rule.

For an existing product:

- keep bug fixes within the current owner unless the embedding primitive itself is proven causal;
- prototype migration on a separate branch;
- preserve per-account Session identity, preload/bridge security, focus/input, downloads, permissions, new-window policy, notifications, and lifecycle handling;
- run authenticated login/session-recovery and feature regressions before switching the production owner.

## Upstream activity research loop

When a remote service breaks unexpectedly:

1. capture local runtime facts first: app build, Electron/Chromium, adapter/library versions, UA, URL/origin, Session identity, and current failure boundary;
2. search official runtime/security docs for changed semantics;
3. inspect vendor status/changelog/recent web changes when available;
4. inspect releases and recent issues of the adapter/automation libraries the product depends on;
5. inspect active mature multi-service clients for the same lifecycle/session symptom;
6. focus on recent activity first (typically 30-90 days for fast-moving services);
7. convert findings into at most three falsifiable local hypotheses;
8. prove ownership locally before patching.

Do not permanently encode a transient vendor incident as truth. Encode the mechanism and require future agents to re-check current upstream state.

## Mature patterns to consult live

Prefer current sources in this order:

- Electron Security, Session, WebContents, `<webview>`, and WebContentsView documentation;
- established multi-service desktop clients such as Ferdium/Rambox for persistent-partition and guest-lifecycle patterns;
- vendor-specific adapter/automation libraries that expose explicit web-version cache/fallback strategies;
- recent upstream issues showing pinned web versions drifting from current backends;
- runtime release notes for Chromium/Electron changes affecting navigation, storage, permissions, OOPIF/WebView behavior, or sandboxing.

Extract mechanisms, not snippets. Re-check current versions before applying any historical pattern.
