# Runtime lifecycle patterns

## Contents

- Process-boundary and IPC generation skew
- Renderer reload/crash and document generations
- Listener setup/cleanup cardinality
- Async commit races and ABA-style identity reuse
- Hydration overwrites
- Session partitions, cache, and service workers
- Dev/package and ASAR divergence
- Execution identity across interactive, source, and service modes
- Known-good / known-bad bisection
- Diagnostic workarounds that mask root causes

## Process-boundary and IPC generation skew

Electron has multiple runtime contexts: main, preload isolated world, renderer main world, frames/WebViews, and sometimes workers. Treat their bridge as a versioned contract rather than one shared JavaScript heap.

Useful checks:

- Which exact `BrowserWindow` / `WebContents` sent the request?
- Which preload exposed the API used by this renderer?
- Is the renderer calling a channel implemented by the actually loaded main candidate?
- Is a response being committed into the same document/window generation that initiated it?
- Does setup register one `ipcMain.handle/on` owner, or does reopen/reload accumulate registrations?

Electron's `contextBridge` exists specifically to expose narrow APIs across isolated contexts; do not disable context isolation or expose raw IPC as a shortcut around a regression.

Electron's `ipcMain` API exposes explicit remove/off/removeHandler operations. Registration and teardown should have a deliberate owner; broad `removeAllListeners()` can break unrelated consumers.

## Renderer reload/crash and document generations

A `WebContents` has an explicit lifecycle. Navigation, reload, `render-process-gone`, `destroyed`, and window replacement can invalidate renderer/document assumptions.

A renderer reload creates a new document execution context. Preload runs for that new document. Renderer-local listeners and component state are new, while main-process objects/handlers may still exist. Bugs appear when one side assumes the other side survived with identical identity.

Useful invariant:

`request created in generation G -> response may mutate UI only if generation G is still current`

Do not use a same-looking replacement window or DOM node as proof of same authority.

## Listener setup/cleanup cardinality

A common regression is duplicate subscriptions after component remount, hot reload, tab reopen, or feature reinstall.

For each listener/subscription, identify:

- who registers it;
- how many registrations are expected;
- what exact function identity is removed;
- when cleanup runs;
- whether main-process/global listeners outlive the renderer that requested them.

React Strict Mode deliberately re-runs Effects and cleanup in development to expose missing cleanup. Duplicate behavior under Strict Mode is a signal to inspect setup/teardown symmetry, not a reason to disable Strict Mode.

## Async commit races and ABA-style identity reuse

Do not gate stale async results only on a reusable identity value.

Example:

`account A request starts -> switch to B -> switch back to A -> old A request resolves`

A final `currentAccountId === 'A'` check passes even though the world changed. This is analogous to the ABA problem: equality does not prove uninterrupted identity.

Use a monotonic generation/request token, version, creation identity, or equivalent guard. Capture it at request start and compare at commit.

React's official `useEffect` guidance uses cleanup to ignore stale responses because network results may arrive out of order. Cancellation reduces wasted work, while a current-generation check protects the commit boundary.

## Hydration overwrites

Late startup/account hydration can overwrite newer user state:

`owner initializes -> async durable read starts -> user edits -> old durable snapshot resolves -> snapshot replaces owner`

The durable store may be correct for the earlier generation and still be wrong to commit now.

Treat hydration as an async write into the current owner. Require a generation/version precondition or merge/reconcile through the owner's existing contract. Do not create another mirror store to mask the overwrite.

## Session partitions, cache, and service workers

Electron `Session` objects are partition-scoped. `persist:` partitions survive across pages/app restarts; non-persistent partitions are in-memory. Cache, cookies, localStorage, IndexedDB, CacheStorage, and service workers therefore belong to a runtime session identity.

Before blaming business logic for stale content, prove:

- the current `WebContents.session` / partition;
- the origin;
- which storage/cache/service worker owns the stale result;
- whether another window/account uses a different partition.

Electron exposes `clearCache`, `clearStorageData`, and service-worker storage controls. Use them only as targeted diagnostics unless product semantics explicitly require deletion. A successful "clear everything" workaround proves that state mattered; it does not explain which owner was wrong.

## Dev/package and ASAR divergence

Electron distributions often run application files from `app.asar`. Most Node APIs are patched to read ASAR paths, but ASAR is read-only and some filesystem/process APIs have caveats. Executable/native files may need unpacking and working directories cannot be directories inside ASAR.

For package-only failures, compare:

- `app.isPackaged`;
- `app.getAppPath()`;
- `process.resourcesPath`;
- executable path;
- renderer/preload resource paths;
- ASAR/unpacked placement;
- CSP/protocol differences;
- session/service-worker/cache state.

Do not infer packaged behavior from a dev server alone.

## Execution identity across interactive, source, and service modes

Moving the same code between an interactive desktop app, source-development launcher, login/autostart task, headless process, scheduled task, or OS service can silently change the runtime identity even when the executable is identical. Model the boundary explicitly:

`OS principal/service account + application/install identity + profile/data root + session/runtime home + credential/key-protection scope + OS registration/autostart owner + generation`

Bind that identity **before** single-instance, session/storage, credential, migration, or background-worker initialization. Create required profile/data directories before platform APIs that require them, and fail closed if the intended root or credential scope cannot be established; silently falling back to a default home/profile can split browser/session state from the product's authoritative account/config state.

Source/dev/test modes should not attach to an installed production profile or steal protocol-handler/login-item/autostart ownership unless that is explicit. Likewise, a service or scheduled task running under a different principal must not silently create a second empty state root when user-scoped key protection or credentials (for example Windows DPAPI CurrentUser or OS keychains) are bound to another identity; use the same intended principal or an explicit migration/rekey contract.

For isolated browser/runtime launches, override the complete profile environment the child actually consults rather than one convenient variable while inheriting the caller's real browser home or credentials. Treat profile/principal binding failures as lifecycle failures, not reasons to relax isolation.

## Known-good / known-bad bisection

When the same environment can reproduce a deterministic regression and there is a known-good and known-bad commit, `git bisect` is often cheaper and more reliable than inspecting a large diff by intuition.

Use the smallest deterministic reproducer. Mark unrelated build failures as `skip`, not `good` or `bad`. If user data/config/environment changed independently, first prove the regression is code-bound before bisection.

## Diagnostic workarounds that mask root causes

These are useful experiments but suspicious final fixes unless the product contract truly requires them:

- clear all caches/storage/profile data;
- restart/reload until it works;
- add arbitrary sleeps;
- increase timeout/retry counts;
- disable React Strict Mode;
- bind another listener in a second module;
- call `removeAllListeners()` globally;
- choose the first ambiguous target;
- bypass `contextBridge`/context isolation;
- delete durable state and let defaults regenerate.

Use the symptom change to refine the hypothesis, then repair the actual owner/lifecycle mechanism.

When a visible UI control's event/lifecycle ownership is unclear, `scripts/trace_control.py <repo> <dom-id>` can surface direct references and nearby event, replacement, IPC, async-generation, storage, and package/session risk markers. Use it as a navigation aid, then prove the active runtime path.

## Mature references to consult live

When these patterns are relevant, prefer current versions of:

- Electron `webContents` docs for navigation, `render-process-gone`, `destroyed`, and WebContents identity.
- Electron `contextBridge` / Context Isolation docs for preload-renderer boundaries.
- Electron `ipcMain` docs for handler/listener registration and removal.
- Electron `session` docs for partitions, cache, storage, and service workers.
- Electron ASAR docs for packaged filesystem/process caveats.
- React `StrictMode` and `useEffect` docs for setup/cleanup and stale async-result races.
- Playwright Locator docs for fresh target resolution after rerender.
- Git `git-bisect` documentation for deterministic regression isolation.
