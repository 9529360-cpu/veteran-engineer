# Upstream research playbook for embedded web platforms

## Contents

- Goal
- Research lanes
- Source priority
- Recency windows
- Search construction
- Activity signals
- Evidence table
- Convert research into hypotheses
- Avoid stale knowledge
- Architecture research vs incident research
- Framework upgrade research
- New-service discovery research
- What to save in a skill
- Canonical live sources
- Stable source map

## Goal

Use external research to reduce speculation, not to outsource root-cause proof.

For embedded remote services, the runtime includes software released by several independent owners:

`desktop app -> Electron/Chromium -> service website/backend -> identity provider -> adapter/recipe/library -> OS/network`

A local repository diff may explain only one lane.

## Research lanes

Investigate the lanes independently.

### Runtime/framework

Search Electron and Chromium release notes, breaking changes, security changes, WebContents/Session behavior, and OS-specific runtime changes.

### Target service

Search official status, browser-support policy, login/auth changes, recent redesigns, developer/API notes, and recent user-visible incidents.

### Identity provider

Search OAuth/OIDC/SAML/passkey/embedded-browser policies when login leaves the service origin. Distinguish host-owned native OAuth from website-owned authentication before applying native-app guidance.

### Browser privacy/storage

Search current Chromium behavior for third-party storage partitioning, partitioned cookies, Storage Access, FedCM, service workers, and permission changes when a direct top-level page behaves differently from an embedded frame.

### Host shell/OS integration

Search current Electron and OS behavior for notifications, tray/taskbar/dock identity, deep links/single-instance routing, signing, keychain/credential storage, client certificates, dialogs, and native permission prompts. Development and installed/signed behavior may differ.

### Adapter/library

Search releases, changelogs, recent commits, open issues, and known version-compatibility changes in the specific integration library.

### Multi-service analogs

Search active projects that solve the same container/session problem, especially Ferdium/Rambox/Tangram-style products and maintained service recipe ecosystems.

### Historical archaeology

Archived wrappers can reveal recurring failure classes, but never treat archived architecture as a current recommendation.

## Source priority

Prefer:

1. official runtime/service/IdP documentation and status;
2. upstream source code, release notes, issue/PR discussions;
3. maintained mature products with real field reports;
4. high-signal technical writeups with reproducible details;
5. forums/Stack Overflow/Reddit only for symptom discovery and environment clues.

Popularity is not proof. A copied workaround with no mechanism should not outrank official behavior or local runtime evidence.

## Recency windows

Choose recency based on how quickly the dependency changes.

- remote web service/auth outage: hours to 30 days first;
- service UI/DOM/recipe compatibility: 30-90 days first;
- Electron current behavior: current docs + supported release lines;
- architecture patterns: 1-3 years can be useful if still maintained;
- security/runtime API semantics: use current docs even when an old issue first exposed the pattern;
- archived project behavior: historical context only.

Widen only after recent searches fail.

## Search construction

Combine symptom + layer + mechanism.

Examples:

- `embedded electron oauth popup same session login`
- `web app unsupported browser electron user agent chromium`
- `service worker persistent partition electron restart`
- `unread count selector redesign recipe`
- `webview did attach race listener electron`
- `session setProxy close connections electron`
- `webrtc proxy non proxied udp chromium`
- `pinned web version current backend login failure`

For vendor incidents, search exact user-visible error text plus service name and date window.

For framework bugs, search the Electron API/event name plus the symptom.

## Activity signals

Recent activity can reveal what is currently unstable.

High-signal examples:

- multiple recent PRs changing auth redirects or login URLs;
- recipes updating unread selectors after a redesign;
- browser-version/user-agent fixes across several services;
- changes to popup/external-link handling;
- hibernation/memory fixes in multi-service clients;
- Electron release notes changing security, notification, clipboard, WebView, navigation, or Session behavior;
- dependency release notes explicitly naming current remote-site compatibility.

One issue is a hypothesis. A cluster of independent recent changes is stronger evidence of ecosystem movement, but local reproduction still decides ownership.

## Evidence table

For meaningful investigations, maintain a compact table or notes with:

- source/date;
- affected version/environment;
- symptom;
- claimed mechanism;
- evidence quality;
- local match;
- local mismatch;
- cheapest falsifier.

This prevents "I found an issue that sounds similar" from becoming a patch without comparison.

## Convert research into hypotheses

After research, write at most three competing local hypotheses.

Each hypothesis must state:

- earliest failing owner;
- mechanism;
- local supporting evidence;
- local contradicting evidence;
- one observation/A-B that would falsify it.

Then run the cheapest discriminator.

Examples of strong discriminators:

- same Session/WebContents, switch only entry source;
- same source, switch only adapter version;
- fresh synthetic partition vs existing partition;
- popup allowed with inherited Session vs external browser;
- real UA vs override while engine is unchanged;
- direct network vs proxy with connection pool reset.

## Avoid stale knowledge

Do not permanently write transient facts such as:

- "service X currently requires UA Y";
- "Electron major Z is latest";
- "selector `.abc` is the unread counter";
- "vendor incident is ongoing".

Instead write:

- how to discover the current requirement;
- which runtime fact to record;
- how to A/B the mechanism;
- what test should fail when compatibility drifts.

Store stable mechanisms; research volatile values live.

## Architecture research vs incident research

Architecture research asks: "What stable design minimizes whole classes of failures?"

Use broader mature sources and compare multiple products.

Incident research asks: "What changed now and which owner is broken?"

Use narrow recency, exact error text, exact dependency versions, and runtime A/B.

Do not redesign architecture during an incident unless the architecture itself is proven causal and a migration is separately scoped.

## Framework upgrade research

Electron moves with Chromium quickly and supports only a small number of stable major lines.

For planned upgrades:

1. read current supported release schedule;
2. read breaking changes for every skipped major;
3. inspect security and platform-specific changes;
4. check embedding primitive deprecations/migrations;
5. run the full service capability matrix, not only app startup;
6. test authentication/browser-support gates because a newer Chromium can both fix and introduce service behavior;
7. isolate framework upgrade from unrelated feature changes.

Do not stay indefinitely on an unsupported runtime to preserve one fragile web-service workaround. Replace the workaround or isolate the service-specific incompatibility.

## New-service discovery research

Before adding a new remote service, search:

- official supported browsers/OSs;
- auth methods and enterprise SSO options;
- popup/deep-link behavior;
- PWA/service-worker/offline behavior;
- notifications;
- media/screen-share requirements;
- upload/download behavior;
- custom/self-hosted tenant URLs;
- existing Ferdium/Rambox recipes or similar integration definitions;
- recent issues in multi-service clients;
- whether the site blocks embedded browsers or Electron;
- whether it depends on protected DRM/browser extensions unsupported by Electron.

Use this to fill the onboarding capability matrix before writing an adapter.

## What to save in a skill

Save:

- source priority;
- search strategy;
- stable failure classes;
- capability matrices;
- A/B methods;
- security constraints;
- evidence hierarchy;
- regression gates.

Do not save:

- current incident status;
- current app version;
- one user's account data;
- ephemeral URLs/tokens;
- exact temporary selectors/workarounds unless explicitly labeled as historical examples.

## Canonical live sources

Keep these families in the regular research loop:

- Electron official docs/blog/releases/schedule/breaking changes/security/performance;
- Chromium/Chrome platform and enterprise policy docs for network/WebRTC/browser behavior, storage partitioning, CSP, and Trusted Types;
- electron-builder/electron-updater docs for packaging/update behavior;
- target service and identity-provider official docs/status pages;
- maintained multi-service products and recipe repositories;
- service-specific automation/integration libraries only when a target service uses them;
- GitHub issues/PRs sorted by recent activity for live field evidence.

Research should be repeated when the task starts. A skill is a map for finding current truth, not a frozen mirror of the web.

## Stable source map

Prefer stable documentation entrypoints and then inspect their current content; do not copy today's version numbers into permanent rules. Useful starting points include:

- Electron Web Embeds: `https://www.electronjs.org/docs/latest/tutorial/web-embeds`
- Electron `<webview>`: `https://www.electronjs.org/docs/latest/api/webview-tag`
- Electron WebContentsView: `https://www.electronjs.org/docs/latest/api/web-contents-view`
- Electron Session: `https://www.electronjs.org/docs/latest/api/session`
- Electron WebContents: `https://www.electronjs.org/docs/latest/api/web-contents`
- Electron Security: `https://www.electronjs.org/docs/latest/tutorial/security`
- Electron breaking changes: `https://www.electronjs.org/docs/latest/breaking-changes`
- Electron release schedule: `https://releases.electronjs.org/schedule`
- Electron extensions: `https://www.electronjs.org/docs/latest/api/extensions`
- Electron desktop capture: `https://www.electronjs.org/docs/latest/api/desktop-capturer`
- Electron safe storage: `https://www.electronjs.org/docs/latest/api/safe-storage`
- Electron fuses: `https://www.electronjs.org/docs/latest/tutorial/fuses`
- Electron protocol: `https://www.electronjs.org/docs/latest/api/protocol`
- Electron notifications: `https://www.electronjs.org/docs/latest/tutorial/notifications`
- Electron deep links: `https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app`
- Electron automated testing: `https://www.electronjs.org/docs/latest/tutorial/automated-testing`
- Playwright Electron automation: `https://playwright.dev/docs/api/class-electron`
- OAuth for native apps (RFC 8252): `https://www.rfc-editor.org/rfc/rfc8252`
- Chrome storage partitioning: `https://developer.chrome.com/docs/privacy-sandbox/storage-partitioning/`
- Chrome FedCM: `https://developer.chrome.com/docs/identity/fedcm/`
- Trusted Types/CSP: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for`
- Chromium process model/Site Isolation: `https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md`
- electron-builder updater: `https://www.electron.build/docs/features/auto-update/`
- The Update Framework metadata model: `https://theupdateframework.io/docs/metadata/`
- GitHub artifact attestations: `https://docs.github.com/en/actions/concepts/security/artifact-attestations`
- Ferdium recipes: `https://github.com/ferdium/ferdium-recipes`
- Ferdium application/issues: `https://github.com/ferdium/ferdium-app`
- Rambox support/custom-app documentation: `https://support.rambox.app/`
- WebCatalog Spaces/profiles: `https://webcatalog.io/solutions/spaces`
- Wavebox Spaces/profiles: `https://wavebox.io/platform`

When a connected source tool is available for a repository, use it to inspect exact current source/issues/PRs; use web search for official runtime/service documentation, status pages, and broader ecosystem evidence. Always record the date/version context of any volatile claim.
