# Remote-service integration onboarding workflow

Use this when adding a new remote web application to an Electron/browser-container product. Keep this file as the onboarding control plane; load the specialized compatibility, auth, adapter, host-shell, lifecycle, and observability references only when the service requires them.

## Contents

- Treat onboarding as product integration
- Build a capability matrix before code
- Establish identity and session ownership
- Classify navigation and authentication topology
- Define adapter and host-shell responsibilities
- Validate privileged capabilities explicitly
- Prove pre-auth, authenticated, restart, and isolation behavior
- Plan compatibility, degradation, and rollback
- Definition of done
- Specialist references

## Treat onboarding as product integration

Treat a remote web application as an independently released product, not a bookmark or selector bundle.

Start from:

`service definition -> account identity -> Session/partition -> embedding owner -> navigation/auth topology -> adapter capabilities -> host-shell projection -> lifecycle/observability`

Do not start by copying another service's settings or injecting selectors. Recover the browser/runtime contract this service actually requires.

## Build a capability matrix before code

Record only capabilities that can affect architecture, security, lifecycle, or acceptance. `unknown` is a valid initial state; "same as another service" is not evidence.

At minimum consider, where relevant:

- canonical entry URL and first-party origins;
- custom/self-hosted URL support and validation;
- password, QR/device-link, OAuth/OIDC, SAML, magic-link, passkey/WebAuthn authentication;
- popup/redirect/deep-link topology;
- cookies, localStorage, IndexedDB, CacheStorage, service workers, and persistence requirements;
- notifications and unread/badge signal source;
- uploads, downloads, clipboard, drag/drop, and filesystem interaction;
- microphone, camera, display capture, geolocation, and other device permissions;
- user-agent/browser-version/client-hint sensitivity;
- proxy, DNS, WebRTC, enterprise auth, and client-certificate requirements;
- background/realtime behavior and hibernation constraints;
- cross-origin frames, CSP/Trusted Types, extension assumptions, or DRM/protected-content limits;
- minimum supported runtime/browser version.

Re-check fast-moving services when behavior changes. The matrix is an engineering input, not permanent truth.

## Establish identity and session ownership

Before first navigation, bind each account instance to a stable browser-state owner:

`workspace/config identity -> service instance -> stable account key -> persistent Session/partition -> current WebContents generation`

Keep organization/layout state separate from browser authentication state. Do not let a missing partition silently fall back to the default Session. Avoid slot-number authority when slots can be reordered or reused.

For detailed Session isolation, generation, reset, and embedding ownership, read `embedded-remote-service-patterns.md` and `runtime-lifecycle-patterns.md`.

## Classify navigation and authentication topology

Define separately:

1. canonical startup URL;
2. in-app main-frame origins;
3. authentication-only origins;
4. external-navigation destinations;
5. child-window/popup policy;
6. callback/deep-link schemes and their account/session routing owner.

Trace authentication as a graph:

`service -> login -> identity provider -> popup/redirect/external user-agent -> callback -> authenticated service`

First classify whether the host owns a native OAuth client or the remote website owns its own authentication flow. Do not force one model onto the other. For OAuth/PKCE, popup routing, WebAuthn, permissions, deep links, client certificates, and platform entitlement details, read `auth-navigation-platform-patterns.md`.

## Define adapter and host-shell responsibilities

Prefer a declarative service definition plus a narrow versioned adapter over service-specific branches spread through the core.

Typical service-definition fields include:

- id/name/icon and entry URL/template;
- allowed/auth origins and custom-URL validator;
- user-agent or permission capabilities only when required;
- popup/external-link policy;
- notification/unread capabilities;
- hibernation/realtime policy;
- optional proxy policy;
- adapter version.

Keep adapter hooks narrow: unread observation, notification bridge, custom-server validation, stable DOM compatibility patches, or service-specific API bridges only when the product needs them.

Treat selector hooks as upstream API dependencies. Treat remotely updated adapters as executable code distribution. Read `adapter-distribution-patterns.md` for manifest/version/rollback rules and `host-shell-platform-patterns.md` for notifications, badges, deep links, downloads, dialogs, signing identity, and native activation.

## Validate privileged capabilities explicitly

Do not grant broad host privileges because one integration needs a capability.

For uploads/downloads/clipboard/drag-drop, keep real filesystem authority in the privileged owner when possible, scope operations to the service/account, and prevent accidental navigation or privilege escalation.

For microphone/camera/display capture, validate requesting origin/frame, user intent, proxy/WebRTC behavior, and background-media effects. Never disable web security to recover a convenience feature.

For custom/self-hosted URLs, normalize and validate the endpoint before granting known-service permissions or preload authority. Distinguish server validation from authentication failure.

For proxy/network identity, remember that Session proxy changes can leave existing sockets alive and that WebRTC may use different network paths from ordinary HTTP(S).

Load `remote-service-compatibility-patterns.md`, `resource-lifecycle-patterns.md`, and `host-shell-platform-patterns.md` for the mechanisms that actually participate.

## Prove pre-auth, authenticated, restart, and isolation behavior

Use layered gates rather than treating homepage rendering as completion.

**Credential-free bootstrap** should prove, when observable:

- expected secure origin loads;
- login/auth-required shell appears rather than permanent error/loading state;
- critical bootstrap/module graph is intact;
- required pre-login navigation is not blocked;
- adapter bootstrap does not fail catastrophically.

**Authenticated validation** should cover only supported capabilities, for example:

- login completion;
- session persistence across restart;
- basic create/send action;
- attachment/download behavior;
- notifications/unread projection;
- call/media/screen-share behavior;
- logout/account reset and recovery.

With multiple accounts, prove Session isolation, child-window inheritance, reset scoping, and stale-generation rejection. A successful login-shell smoke is not proof of authenticated capability health.

## Plan compatibility, degradation, and rollback

Treat service/runtime compatibility as multi-dimensional: browser version, authentication topology, storage/privacy behavior, CSP/frames, adapter timing, proxy/network behavior, vendor bootstrap changes, and cached adapter/config versions can fail independently.

For upstream behavior changes, read `remote-service-compatibility-patterns.md` and `upstream-research-playbook.md` before inventing a local workaround.

For independently updated service definitions/adapters:

- preserve a validated last-known-good version;
- reject partial/empty/incompatible control-plane responses before activation;
- allow one broken integration to disable/rollback without deleting private browser Sessions;
- keep update polling bounded and observable.

For resource/hibernation decisions, preserve realtime semantics and active work. Read `resource-lifecycle-patterns.md`.

## Definition of done

Do not call a new integration complete because the homepage renders. Verify, as applicable:

1. capability matrix and service definition are explicit;
2. account/session ownership is stable and isolated;
3. navigation/auth/popup/deep-link policy is correct;
4. credential-free bootstrap works;
5. at least one real authentication path is validated when required;
6. restart restores the correct account state;
7. permissions are allowlisted by capability/origin;
8. service-specific adapter behavior is isolated from core runtime;
9. reload/failure/account removal cannot leak into another account;
10. supported uploads/downloads/notifications/media/proxy behavior works;
11. lifecycle/hibernation preserves intended realtime behavior;
12. observability can distinguish service, account-safe identity, runtime generation, and failure layer;
13. adapter/control-plane rollback or freeze exists when remote updates are possible.

## Specialist references

Load only the references required by the current service:

- `embedded-remote-service-patterns.md` - Session/WebContents identity, embedding, adapter ownership, account cleanup.
- `remote-service-compatibility-patterns.md` - Chromium/browser/auth/storage/privacy/CSP/network/vendor compatibility.
- `auth-navigation-platform-patterns.md` - OAuth, popups, deep links, WebAuthn, permissions, enterprise auth.
- `adapter-distribution-patterns.md` - remote adapter/config supply chain, manifests, staging, rollback, kill switches.
- `host-shell-platform-patterns.md` - notifications, unread projection, native navigation/download/dialog/signing behavior.
- `resource-lifecycle-patterns.md` - hibernation, background work, media, wake/recovery, resource budgets.
- `observability-support-patterns.md` - readiness layers, generation-aware diagnostics, privacy-safe support evidence.
- `upstream-research-playbook.md` - live research when a remote service or runtime changes.

Use current Electron/browser/service documentation for version-sensitive behavior. Mature projects are pattern sources, not correctness authorities.
