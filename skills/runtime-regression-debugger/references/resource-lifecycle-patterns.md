# Multi-service resource and lifecycle patterns

## Contents

- Resource policy is product behavior
- Measure before optimizing
- Per-service metrics
- Background throttling
- Hibernation and wake policy
- Media and long-running work
- Sleep/resume and connectivity
- Crash and unresponsive recovery
- Listener, timer, and polling ownership
- Disk/cache growth
- Account removal and locked partitions
- Scaling tests
- Mature references to consult live

## Resource policy is product behavior

A multi-service desktop app may run many independent renderer processes. Memory and CPU management therefore changes user-visible behavior.

Do not optimize by destroying background services indiscriminately. Notifications, calls, service workers, timers, uploads, scheduled jobs, and unread state may depend on them remaining alive.

Define resource policy per capability class, not merely per brand.

## Measure before optimizing

Follow the runtime's measurement-first guidance.

Capture at least:

- total app memory/CPU;
- per-process type, PID and creation identity;
- mapping from renderer/WebContents to service/account;
- idle vs active CPU;
- memory before and after navigation/reload/hibernate;
- disk/cache growth over time;
- number of live WebContents and service workers.

PID alone is not stable identity because operating systems can reuse it. Pair process identity with creation time and service/account generation where possible.

Do not set memory thresholds from anecdote alone. Profile representative workloads with several services/accounts.

## Per-service metrics

A useful process manager can answer:

- which service/account owns the heavy renderer;
- whether it is visible/hidden/hibernated;
- current memory and CPU;
- media-playing state;
- last activity time;
- reload/crash count;
- current WebContents generation.

Expose enough diagnostics for users/operators without exposing page content, cookies, private URLs, or tokens.

Metrics are evidence, not automatic permission to kill a process.

## Background throttling

Electron/Chromium can throttle timers and animations for backgrounded WebContents, affecting Page Visibility semantics.

Treat background throttling as a middle ground between fully active and destroyed.

Before changing it globally, test services that rely on:

- realtime polling/timers;
- web workers/service workers;
- audio/video;
- calls;
- background sync;
- scheduled in-page work.

Disabling throttling everywhere can significantly increase resource usage. Enabling it everywhere can delay app-specific behavior. Make the policy explicit.

## Hibernation and wake policy

Hibernation typically frees a renderer by unloading/destroying its WebContents and recreating it later.

A mature policy has guards:

`eligible + inactive + no protected work -> request hibernate -> destroy current generation -> mark hibernated`

Wake:

`user activation / policy wake -> create new WebContents generation -> bind Session -> navigate -> reattach adapter -> verify readiness`

Do not reuse old DOM/WebContents handles after wake.

Messaging/email/call-type services often need realtime background behavior and may default to no hibernation. Other web tools can safely hibernate after inactivity. Encode capability semantics rather than hardcoded category folklore.

## Media and long-running work

Block hibernation while protected activity is active, such as:

- audio/video playback;
- voice/video call;
- screen sharing;
- active upload/download;
- transaction/operation whose owner is the page and cannot be resumed safely.

If the product needs scheduled/background tasks to survive hibernation, move those tasks to a durable trusted owner with an explicit contract instead of hoping page timers survive.

Before hibernating, also veto or explicitly reconcile user work that would be lost by navigation/destruction, such as unsaved forms/drafts, active authentication or permission prompts, in-progress drag/drop, and transactions whose state exists only in the page. “No media playing” is not a sufficient safety predicate.

Use OS power-save blockers only for bounded operations that genuinely require app/system suspension prevention; always release them symmetrically.

## Sleep/resume and connectivity

Laptop suspend/resume creates a distinct lifecycle transition.

Potential failures include:

- WebSockets appear open but are dead;
- DNS/network route changes;
- service workers reconnect slowly;
- timers fire in a burst;
- expired auth state surfaces only after resume;
- pages reload before network is available.

Listen for OS suspend/resume events and define a bounded recovery policy. Avoid reloading every service immediately without evidence; stagger or validate connectivity/readiness to prevent a thundering herd.

If a product uses "reload after resume", make the delay/policy measurable and test it under offline-then-online recovery. A fixed post-resume delay is not proof of network readiness: VPN, captive portal, Wi-Fi roaming, DNS, and proxy/PAC recovery can complete on different schedules. Prefer a bounded readiness/backoff state machine and stagger recovery across many services to avoid a thundering herd.

## Crash and unresponsive recovery

Handle `render-process-gone`, `unresponsive`, `responsive`, and `destroyed` as generation events.

Recovery must:

1. mark the old generation invalid;
2. stop committing async results into it;
3. cleanup owner listeners/state;
4. decide whether recovery/reload is safe;
5. create or rebind the new WebContents;
6. restore the same intended Session/account identity;
7. rerun credential-free or authenticated readiness as appropriate.

Be aware that multiple WebContents can sometimes share a renderer process. A process PID is therefore a fault-domain clue, not an account identity. A forceful renderer crash may affect more than one view; use it only as a controlled recovery mechanism and observe which other WebContents share the process before killing it.

Bound automatic reload loops. Persistent vendor/auth errors should surface instead of consuming CPU forever.

## Listener, timer, and polling ownership

Every service generation can create:

- Electron WebContents listeners;
- DOM observers/listeners;
- polling timers;
- IPC subscriptions;
- notification handlers;
- download/media hooks.

Maintain setup/cleanup symmetry. Hibernation, navigation, recipe reload, account removal, and renderer crash are all teardown boundaries.

A common leak pattern is "new generation attaches another listener while old main-process listener remains". Track registration cardinality and owner generation.

Polling is also a resource contract. A two-second loop multiplied by dozens of services becomes an application-wide load generator. Give adapters a bounded minimum interval, support service-specific slower intervals where semantics allow, stop polling for destroyed/hibernated generations, and measure total wakeups/network work rather than optimizing one loop in isolation. Prefer event-driven signals when a stable supported event exists.

## Disk/cache growth

Persistent multi-account sessions multiply browser caches and storage.

Monitor aggregate user-data growth and identify per-partition contributions before deleting anything.

Do not schedule broad recurring cache deletion to hide growth; it can break offline/service-worker/login semantics and cause repeated network downloads.

Use bounded retention only for product-owned logs/cache. Browser-owned state should be managed through Session APIs and service/account lifecycle semantics.

When using targeted browser-data deletion, inspect the runtime's current matching semantics before execution. Cookie cleanup may operate at registrable-domain scope, and third-party storage may be matched by top-level site; a seemingly narrow origin filter can therefore affect more state than expected. Compute the blast radius first and cover sibling accounts/related origins in regression tests.

## Account removal and locked partitions

Chromium can keep persistent Session files open while the app is running.

Safe account removal may require:

1. stop account-owned tasks;
2. clear intended browser state through the exact Session when semantics require it;
3. detach/destroy current WebContents;
4. attempt filesystem partition removal;
5. if files remain locked, persist a validated pending-removal entry;
6. retry early on next startup before recreating that partition.

Never turn a locked-directory error into recursive deletion of the entire user-data tree.

## Scaling tests

Test beyond one account and one service.

Useful matrices include:

- 1, 5, 10, 20 service instances depending on target scale;
- multiple accounts of the same service;
- mixed realtime and hibernatable services;
- repeated switch/hibernate/wake cycles;
- suspend/resume;
- renderer crash/recovery;
- app restart with all sessions persisted;
- account deletion while another account of same provider stays active;
- proxy-enabled and direct sessions.

Watch memory/process count return toward baseline after destruction. "No crash" alone is not a lifecycle/leak proof.

## Mature references to consult live

- Electron Performance guidance: profile and measure rather than applying generic tweaks.
- `app.getAppMetrics`, process metrics, WebContents memory/CPU/runtime APIs.
- Electron `backgroundThrottling`, `powerMonitor`, `powerSaveBlocker`, and renderer-crash lifecycle events.
- Rambox/Ferdium hibernation behavior for real-world tradeoffs between freeing renderer memory and preserving notifications.
- Mature multi-service client process-manager/troubleshooting UX for user-visible attribution of memory/CPU and service health.

Treat issue-reported memory numbers as examples, not universal budgets. Establish thresholds from the target product's measured workloads.
