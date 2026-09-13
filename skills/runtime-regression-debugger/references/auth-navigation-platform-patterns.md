# Authentication, navigation, and platform-boundary patterns

## Contents

- Separate host-owned OAuth from website-owned authentication
- External user-agent and PKCE rule
- Embedded-user-agent rejection
- Authentication as a routed transaction
- Popup and child-window ownership
- Deep-link and loopback return paths
- Passkeys and WebAuthn
- Enterprise HTTP auth and client certificates
- Permission and OS-entitlement layers
- Download and external-navigation ownership
- Authentication validation matrix
- Mature references to consult live

## Separate host-owned OAuth from website-owned authentication

Do not treat every OAuth-looking page as the desktop host's OAuth flow.

There are two materially different cases:

1. **Host-owned native OAuth**: the desktop application owns the OAuth client registration, redirect URI, PKCE verifier, state/nonce, token exchange, and resulting credential store.
2. **Website-owned authentication**: an independently released remote website opens or redirects to an identity provider and expects the resulting browser cookies/navigation to return to that website's browser session.

For host-owned native OAuth, use the identity provider's documented native-app flow. For website-owned authentication, preserve the website's intended browser/session topology. Opening its IdP page externally is not automatically a fix: the resulting browser state may land in the system browser and never reach the embedded Session.

Never copy cookies or tokens from an external browser into an embedded Session unless the target service explicitly documents a secure handoff contract and the host is authorized to use it.

## External user-agent and PKCE rule

OAuth 2.0 best current practice for native applications requires authorization through an external user-agent and requires PKCE for public native clients.

When the desktop host owns the OAuth client:

`create auth transaction -> generate state/nonce + PKCE -> launch approved external user-agent -> receive exact registered callback -> verify transaction -> exchange code -> bind credential to intended account`

Treat state, redirect URI, account owner, and transaction generation as one authority bundle. A callback that cannot be mapped to one live transaction must fail closed.

Do not implement a local embedded login form merely because it is visually smoother.

## Embedded-user-agent rejection

Identity providers may intentionally reject authorization pages shown inside an embedded user-agent. A user-agent string change does not turn an embedded renderer into an external browser security boundary.

If an IdP rejects the embedded environment:

1. determine whether the host owns a supported native OAuth integration;
2. determine whether the remote website documents an external-browser/deep-link handoff;
3. if neither exists, classify the website capability as unsupported/degraded instead of bypassing the IdP's policy;
4. do not spoof a newer browser or Chrome brand merely to evade embedded-client detection.

The security boundary is about who can inspect/modify the authorization page and cookies, not only what the `User-Agent` header says.

## Authentication as a routed transaction

Model authentication as a graph with explicit ownership:

`account -> service -> auth origin -> window/frame -> callback -> account Session`

Capture for each transition:

- current account/session identity;
- main-frame vs subframe;
- opener WebContents/document generation;
- destination origin and scheme;
- whether the transition is internal, trusted-auth, external, download, or blocked;
- whether the target must share the opener Session;
- how completion is observed.

A login page rendering successfully is not proof the callback returns to the right account.

## Popup and child-window ownership

Use the main-process window-creation policy as the authority for renderer-created windows. Deny by default and classify destinations deliberately.

Typical categories:

- service-owned child UI that must share the account Session;
- trusted IdP popup that must remain attached to the auth transaction;
- external/help/documentation link that belongs in the system browser;
- download/navigation that should not create a privileged child window;
- unknown or untrusted scheme/origin that must be blocked.

Preserve secure child-window preferences. Do not allow a remote page's `window.open` feature string to weaken Node integration, context isolation, sandboxing, or other host security invariants.

Bind child windows to opener account + Session + generation. If the opener dies, navigates, or changes account, invalidate stale auth-window authority.

## Deep-link and loopback return paths

A desktop auth callback may arrive through:

- a custom protocol/deep link;
- a claimed HTTPS/universal link where the platform supports it;
- a loopback listener on localhost/127.0.0.1;
- an identity broker supplied by the OS/platform.

Treat the callback endpoint as a security boundary.

Validate:

- scheme/host/path;
- exact redirect URI associated with the outgoing auth transaction;
- state/nonce and PKCE transaction;
- one-time consumption;
- account and request generation;
- expiry/cancellation.

A deep link must not be able to select an arbitrary account by a user-controlled ID alone. Map it to an already-created transaction.

For loopback callbacks, bind to loopback only, use an ephemeral/bounded listener, and close it after success/cancellation/timeout.

## Passkeys and WebAuthn

Treat WebAuthn as a runtime + OS capability, not a JavaScript shim.

Check:

- relying-party ID and secure-origin rules;
- platform authenticator/security-key availability;
- account-selection flows when multiple discoverable credentials match;
- requesting frame and document generation;
- popup/custom-domain transitions that could change the RP ID;
- OS prompts and cancellation paths.

Do not emulate WebAuthn by extracting credentials or private key material. Use the runtime's native WebAuthn support and fail safely when unsupported.

## Enterprise HTTP auth and client certificates

Corporate services can introduce authentication below the page layer:

- HTTP Basic/Digest challenges;
- proxy `407` authentication;
- NTLM/Negotiate integrated authentication;
- mutual TLS/client-certificate selection;
- enterprise TLS interception with installed roots.

Route these challenges using exact Session/WebContents/account and origin/realm. Do not maintain one global credential cache for all accounts.

Client-certificate selection is identity-bearing. Do not silently choose the first certificate across all services; use explicit policy or user choice scoped to the requesting service/session.

Do not blanket-accept certificate errors. A corporate root that Chromium trusts and an actually invalid/revoked certificate are different conditions.

## Permission and OS-entitlement layers

A web capability can require multiple authorities:

`service capability -> requesting frame/origin -> Electron Session permission -> OS entitlement/permission -> current user gesture -> device/source selection`

For camera, microphone, screen capture, geolocation, HID/USB/serial and similar APIs, approving only the Electron permission handler may still leave the feature blocked by the operating system.

Test both permission-check and permission-request paths when the runtime distinguishes them. Persist device grants only if the product explicitly needs durable grants; otherwise prefer the runtime's ephemeral default.

For display capture, prefer a user-visible source picker or equivalent intentional selection. Never silently hand an arbitrary embedded frame the first screen/source.

## Download and external-navigation ownership

Downloads and external links cross from untrusted remote content into host/OS authority.

For downloads:

- identify the initiating WebContents/account/session;
- use the runtime download owner rather than re-fetching arbitrary page URLs with a privileged Node HTTP client;
- validate destination policy and filename behavior;
- track completion/interruption/cancellation;
- keep user-selected filesystem paths in the privileged host owner when possible.

For external navigation:

- parse and allowlist schemes/origins as required by product semantics;
- never pass untrusted arbitrary URLs directly to a privileged OS opener;
- distinguish an OAuth external-browser route from a normal external link;
- preserve transaction/account identity when a callback is expected.

## Authentication validation matrix

For integrations that support authentication, test at least the applicable rows:

- fresh account / no prior cookies;
- existing restored session;
- second account of same service;
- popup login;
- redirect login;
- system-browser/native OAuth when the host owns the flow;
- enterprise SSO/tenant URL;
- passkey/security key;
- proxy auth/client certificate when supported;
- cancel/back/timeout;
- opener reload/close during auth;
- restart after successful login;
- logout/reset of one account without touching another.

Do not mark an auth method supported unless its end-to-end return path is proven.

## Mature references to consult live

Prefer current versions of:

- RFC 8252 / BCP 212 for native OAuth external user-agent and PKCE requirements;
- the identity provider's current embedded-user-agent, desktop OAuth, redirect, and broker guidance;
- Electron `webContents.setWindowOpenHandler`, Deep Links, Session/WebAuthn, permission, `login`, and client-certificate APIs;
- Electron Security guidance for navigation/window/external-URL restrictions;
- current field reports from maintained multi-service clients for service-specific auth topology changes.

Keep provider-specific hostnames and browser policies out of permanent rules; re-check them live.
