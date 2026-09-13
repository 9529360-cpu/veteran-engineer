# Remote-service compatibility patterns

## Contents

- Compatibility is multi-dimensional
- Browser and user-agent support
- OAuth, SSO, popups, and external routing
- Passkeys and WebAuthn
- Permissions and device APIs
- Service workers and persistent storage
- Browser privacy and top-level-site partitioning
- Cross-origin frames, CSP, and Trusted Types
- Adapter injection timing
- Chrome-extension assumptions
- Proxy, DNS, WebRTC, and enterprise authentication
- Network failure semantics
- Vendor bootstrap/version drift
- Cached adapter/config drift
- Compatibility escalation ladder
- Mature incidents and lessons
- Live sources to consult

## Compatibility is multi-dimensional

A remote service can fail even when network access and the initial URL are correct.

Track compatibility across these independent dimensions:

`Electron/Chromium version + UA/client hints + Session state + origin/navigation policy + auth topology + permissions + service worker/storage + adapter/injection + vendor web/backend version`

Do not collapse them into one generic "webview compatibility" flag.

## Browser and user-agent support

Remote services increasingly enforce minimum browser versions or block embedded/nonstandard clients.

Rules:

- distinguish the real Chromium version from the effective User-Agent string;
- do not permanently spoof a newer Chrome version unless the actual engine satisfies the required APIs/security behavior;
- when a service reports "browser not supported", first reproduce with the real UA, then compare a stock Chromium/Chrome of the same engine generation when feasible;
- classify whether rejection is UA-string detection, missing browser capability, embedded-browser policy, cookies/privacy policy, or IdP policy;
- keep UA overrides per integration, not global;
- re-check overrides after Electron upgrades; a workaround can become harmful when the service changes.

A historical pattern in multi-service clients is that a fixed old UA can remain cached even after the recipe/core is updated. Prove the effective UA inside the failing WebContents rather than trusting config files.

## OAuth, SSO, popups, and external routing

Sign-in failures often come from routing, not credentials.

Common failure shapes:

- service expects `window.open`, but host blocks all popups;
- login opens in the system browser, so the authenticated cookies land in the wrong profile/session;
- trusted IdP popup is allowed, but child window uses the wrong Session;
- callback navigates to an origin blocked by host navigation policy;
- enterprise SSO uses another IdP/domain not present in a consumer-account test;
- popup succeeds but opener was destroyed/hibernated before callback.

Treat login as a directed graph. Capture each navigation/window transition and Session identity.

Prefer main-process `setWindowOpenHandler`/navigation ownership to page monkey patches when possible. Allow only the minimal trusted auth graph; arbitrary links should not gain in-app privileged execution because an IdP needed a popup.

## Passkeys and WebAuthn

Passkeys are increasingly common and must be treated as an integration capability.

Check:

- whether the Electron/Chromium version implements the required WebAuthn flow on the target OS;
- relying-party ID/origin consistency across custom domains and redirects;
- account-selection events when multiple discoverable credentials exist;
- OS keychain/security-key prompts;
- whether a child auth window retains the correct Session and origin.

Do not emulate or intercept WebAuthn in JavaScript unless a platform gap is proven and the security model is fully understood. Prefer native/runtime support.

## Permissions and device APIs

Remote content should fail closed by default.

Build permission policy from:

`Session + requesting origin/frame + service capability + current user action`

Examples include notifications, microphone, camera, display capture, clipboard read, geolocation, MIDI, HID, USB, serial, and filesystem capabilities.

Do not grant a capability merely because the top-level service is trusted; requests can originate from child/cross-origin frames.

Where Electron exposes separate permission-check and permission-request handlers, keep their decisions coherent. A request handler alone may not cover every Chromium permission check path.

## Service workers and persistent storage

Persistent browser applications may depend on service workers, IndexedDB, CacheStorage, and persistent storage for authentication, offline state, message sync, or notifications.

Rules:

- prove the current Session/partition before examining storage;
- treat service-worker registrations as generation/session scoped;
- do not clear all storage as a default repair;
- if clearing one storage type changes behavior, use that as a diagnostic signal and locate the stale owner;
- test restart/reload with the same persistent partition;
- test account deletion with the exact target partition only.

A page can have `document.readyState=complete` while its application-level bootstrap is broken. Document load is not a vendor readiness signal.

## Browser privacy and top-level-site partitioning

Do not confuse the desktop runtime's Session partition with Chromium's web-platform storage partitioning. They solve different problems.

A third-party iframe may receive storage/cookies keyed by the top-level site, so the same origin can observe different state when loaded directly versus embedded under another site. Modern identity can also use mechanisms such as partitioned cookies, Storage Access, or browser-mediated federation rather than the historical unpartitioned third-party-cookie model.

When an embedded login/widget loses state:

- keep the Electron Session constant and compare direct top-level navigation against the actual embedding topology;
- record top-level origin, requesting/embedding origin, cookie/storage mode, and frame generation;
- inspect current browser privacy behavior before resetting account data;
- do not merge account Sessions or disable web security to restore historical third-party-cookie behavior.

Storage-cleanup APIs can have a wider blast radius than their argument names suggest. Before clearing cookies by an origin filter, check the runtime's current registrable-domain and third-party matching semantics; a narrowly named origin may still remove cookies shared across a wider site.

## Cross-origin frames, CSP, and Trusted Types

Many modern services split UI across origins.

An adapter in the top frame may not legally inspect a cross-origin iframe. This is expected browser security, not a reason to disable web security.

If an important signal moved behind an inaccessible frame:

- find a supported page/API event;
- use a first-party shell where the signal is accessible;
- observe host-level notifications/title/network behavior when appropriate;
- or mark the feature unsupported until a safe interface exists.

Never turn off same-origin protections to recover an unread counter or cosmetic feature.

Remote pages may also tighten Content Security Policy or enable Trusted Types. An adapter that previously assigned string HTML to `innerHTML`, dynamically constructed script URLs, or used other injection sinks can start throwing even though the vendor app is healthy. Treat that as an upstream security-policy compatibility change.

- record the actual CSP/Trusted Types violation;
- prefer safe DOM APIs and narrow product-owned bridges that respect the page's policy;
- do not strip CSP, add `unsafe-*`, invent permissive Trusted Types policies, or disable web security globally to preserve a cosmetic adapter;
- test injected CSS/JS/DOM hooks against CSP/Trusted Types as part of adapter compatibility.

## Adapter injection timing

Remote pages have their own module-loader and hydration lifecycle.

Separate:

1. document created;
2. vendor bootstrap script loaded;
3. vendor module graph ready;
4. application shell initialized;
5. adapter injected;
6. adapter API ready;
7. authenticated business modules ready.

A fixed delay is a weak readiness contract. Prefer vendor/DOM/runtime signals with a bounded timeout and document-generation guard.

When a remote site changes its loader, an adapter may become too early or too late even if the page still renders.

## Chrome-extension assumptions

Do not assume Chrome Web Store compatibility.

Electron supports only a subset of Chrome extension APIs, extensions are Session-scoped, and arbitrary store extensions are not a supported parity goal.

Before using an extension as a product dependency:

- verify every required extension API against current Electron support;
- load it explicitly on every app start;
- use a persistent Session where required;
- treat extension version and host permissions as part of the integration contract;
- have a fallback when the extension API surface is unsupported.

Prefer a narrow product-owned adapter over depending on a general Chrome extension when only a small capability is needed.

## Proxy, DNS, WebRTC, and enterprise authentication

Network identity is more than HTTP proxy settings.

When setting/changing a Session proxy:

- verify the proxy config resolved as intended;
- close/recreate pooled connections when required so old sockets do not survive;
- test DNS behavior where split DNS/PAC/SOCKS is relevant;
- test WebSocket traffic;
- explicitly test WebRTC, which may use UDP/non-proxied paths depending on policy;
- test media after applying privacy-oriented WebRTC IP restrictions because they can reduce connectivity/performance.

Do not log proxy credentials or full private URLs.

Enterprise environments add another network-auth layer. Distinguish:

- origin HTTP authentication from proxy authentication;
- basic/digest from integrated schemes such as NTLM/Negotiate;
- ordinary TLS verification from client-certificate selection/mTLS;
- public DNS from PAC/split-DNS/private-root environments.

Route credentials and certificate choices through the exact requesting Session/WebContents/host/realm. Never blanket-accept certificate errors to make a corporate service load.

## Network failure semantics

Preserve the exact failure type:

- DNS resolution;
- TCP connect;
- proxy auth;
- TLS/certificate;
- HTTP status;
- redirect loop;
- MIME/content-type mismatch;
- CSP/CORS;
- browser `net::ERR_*`;
- aborted/cancelled;
- JavaScript exception;
- vendor application error.

`ERR_FAILED` is not a 404. A timeout is not proof of server rejection. A blocked navigation is not a failed DNS lookup.

Use CDP/network logs or Electron net logging when the browser layer matters, but keep capture mode non-sensitive by default.

## Vendor bootstrap/version drift

A remote web application's startup shell is part of the runtime dependency graph.

Dangerous pattern:

`old/pinned HTML bootstrap + today's CDN scripts/service workers/backend`

This can fail without any local commit.

If pinning/caching is intentional, define:

- explicit version key;
- provenance/source;
- strict-vs-fallback behavior;
- refresh policy;
- compatibility test;
- rollback/expiry policy.

For incident diagnosis, use same-runtime A/B:

`same WebContents + same Session + same UA + same machine + same timeout; change only bootstrap/source/version`

Use the earliest credential-free postcondition that distinguishes health.

## Cached adapter/config drift

The runtime may use a stale integration definition even when source control contains the new one.

Prove the chain:

`repository adapter version -> packaged adapter -> installed adapter/cache -> loaded adapter -> effective runtime values`

Include effective UA, URL, allowed origins, injection version, and feature flags in sanitized diagnostics where helpful.

Avoid repair designs where deleting the whole profile is the only way to pick up adapter changes. Version caches and make invalidation/reload rules explicit.

## Compatibility escalation ladder

When a service breaks:

1. prove exact build/runtime/Session/URL;
2. identify whether failure is pre-auth, auth, post-auth shell, or one capability;
3. reproduce credential-free if possible;
4. inspect navigation/window/network/console categories;
5. compare service in stock current browser and/or same Chromium generation;
6. check target service browser-support/status changes;
7. check current Electron breaking changes/releases;
8. check adapter/recipe/library activity;
9. check mature multi-service client issues for analogous failure;
10. create at most three local falsifiable hypotheses;
11. patch the earliest proven owner only.

## Mature incidents and lessons

Repeated public incidents in multi-service wrappers show stable classes of failure:

- OAuth providers reject an embedded client even though the service page itself works;
- popup blocking makes login appear broken;
- minimum Chrome-version policy suddenly marks an embedded client unsupported;
- a service redesign breaks unread-count DOM selectors;
- cross-origin iframe changes make previous scraping impossible;
- a vendor enables stricter CSP/Trusted Types and an adapter's old DOM/script injection sink starts throwing;
- an adapter/recipe update exists but stale local cached configuration keeps the old UA/behavior;
- pinned web versions continue to reference live remote assets and drift out of compatibility.

Do not memorize the affected brand. Preserve the failure class and re-check current evidence.

## Live sources to consult

Use current sources in this order:

1. target service status/browser-support/auth documentation;
2. Electron Security, Session, WebContents, Web Embeds, Extensions, display-media, Deep Links, and breaking-change docs;
3. Chromium/Chrome platform or enterprise policy docs when browser-level behavior matters;
4. current service-specific adapter/library releases and issue trackers;
5. active multi-service clients such as Ferdium and Rambox for field evidence;
6. historical wrappers such as Nativefier only as archaeology/caution, not current best practice.

Archived/unmaintained wrappers are especially useful evidence for why a self-updating browser engine and active maintenance cadence matter, but they should not be copied as current architecture.
