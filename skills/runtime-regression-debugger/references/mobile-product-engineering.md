# Mobile product engineering


## Contents

- Compile the mobile contract
- Recover platform authority before editing
- State and lifecycle
- Navigation and deep links
- Permissions, privacy, and device capabilities
- Networking, offline behavior, and synchronization
- Background execution and notifications
- Secure local storage
- UI, accessibility, and device adaptation
- Native boundaries in cross-platform apps
- Release and compatibility
- Validation shape
- Finish the whole slice

Use this for native and cross-platform mobile work: iOS, Android, React Native, Expo, Flutter, and mixed mobile/backend product slices. Treat a mobile app as a long-lived offline-capable client with platform lifecycle, permissions, release-store, and device constraints rather than as a small web page.

## Compile the mobile contract

Start from the user-visible transition:

`user action -> local state -> permission/session gate -> network/storage effect -> background/lifecycle behavior -> visible completion or recovery`

Capture only constraints that can change implementation:

- supported platforms, minimum OS versions, form factors, orientation, and accessibility requirements;
- online, slow, offline, background, killed-process, and restored-process behavior;
- authoritative server state versus local durable/cache state;
- authentication/session refresh, secure credential storage, and account/tenant scope;
- permissions, privacy declarations, deep links/universal links/app links, push notifications, files/media/location/camera where material;
- retry/idempotency for mutations that can outlive a screen or process;
- app-version/API compatibility and staged rollout behavior;
- store signing, entitlements/capabilities, release tracks, crash/telemetry evidence, and rollback/forward-fix limits.

Do not ask the user to choose framework-internal filenames or ordinary repository-derived implementation details.

## Recover platform authority before editing

Identify the active application owner instead of assuming the JavaScript/Dart/native surface that looks familiar is authoritative.

For React Native / Expo, inspect package manifests, Expo config/app config, native `ios/` and `android/` directories when present, navigation owner, state/data layer, native modules/config plugins, EAS/build configuration, and actual platform entrypoints.

For Flutter, inspect `pubspec.yaml`, platform directories, routing/state architecture, generated plugin registration/config, flavors, build configuration, and package/application identifiers.

For native iOS, recover the Xcode project/workspace, targets/configurations, bundle identifiers, entitlements, Info.plist/privacy manifest authority, Swift Package/CocoaPods dependencies, scene/app lifecycle, and signing/build settings.

For native Android, recover Gradle settings/modules, application ID/namespace, manifests, build types/product flavors, permissions, signing configuration, Compose/View ownership, background components, and dependency/version catalogs.

Generated native projects may be projections. In managed Expo or code-generated setups, patch the config/plugin/generator that owns the native output rather than hand-editing derivative files unless the repository explicitly treats native projects as authoritative.

## State and lifecycle

Mobile correctness crosses foreground/background/process-death boundaries.

- Separate transient view state, navigation state, cached server state, and durable device state.
- Treat app relaunch and OS process death as normal states, not exceptional crashes.
- Cancel or generation-guard stale async work when screens, accounts, or selected entities change.
- Reconcile optimistic mutations after connectivity loss or process termination; do not infer server success from a local animation.
- Make queued/retryable writes idempotent when timeout-after-commit or duplicate delivery is possible.
- Define what happens when credentials expire while the app is backgrounded or offline.
- Do not keep security-sensitive authority only in in-memory UI state.

## Navigation and deep links

Navigation is product state, not cosmetic routing.

- Validate cold-start deep links as well as links received while the app is already running.
- Bind protected destinations to current auth/account/tenant authority.
- Define back-stack behavior after login, logout, account switching, destructive flows, and notification taps.
- Preserve unknown/expired links as explicit recoverable states instead of silently landing on an unrelated screen.
- Test restoration after backgrounding and process recreation where the framework/platform supports it.

## Permissions, privacy, and device capabilities

Request permissions at the user-intent boundary, not merely at startup because an API is available.

- Model not-determined, denied, restricted, limited/partial, granted, and later-revoked states where the platform exposes them.
- Provide a usable degraded path when a non-essential permission is denied.
- Keep platform manifests/entitlements/privacy declarations aligned with real code paths.
- Treat camera, microphone, photos, contacts, Bluetooth, location, notifications, health, and device identifiers as privacy-sensitive capabilities.
- Never log secrets, tokens, raw sensitive payloads, or unnecessary personal/device data to analytics/crash systems.

## Networking, offline behavior, and synchronization

Assume networks disappear between request and acknowledgement.

- Distinguish transport failure from application rejection and authentication expiry.
- Bound retries and use backoff; avoid synchronized retry storms after connectivity restoration.
- Give offline writes stable identities when they may be replayed.
- Define conflict behavior when local edits and remote state diverge.
- Make cache freshness visible to the product when stale data can cause harmful decisions.
- Test switching Wi-Fi/cellular/offline, slow responses, duplicate taps, app backgrounding during a request, and relaunch before completion where material.

## Background execution and notifications

Platform schedulers are constrained and non-deterministic.

- Do not assume background jobs run immediately or indefinitely.
- Persist enough identity/state to resume safely after the process is killed.
- Make background effects idempotent and bounded.
- Treat push payloads as untrusted input; authorize any resulting server/object action at a trusted boundary.
- Separate notification delivery from the business effect it may trigger.
- Keep token rotation/unregistration/account logout cleanup explicit.

## Secure local storage

Use platform-backed secure storage for credentials or cryptographic secrets when the product requires device persistence. Ordinary preferences, async key-value stores, SQLite, files, or app databases are not automatically secret stores.

Define logout/account-removal cleanup across secure credentials, local databases, caches, downloaded files, notification tokens, widgets/extensions, and background jobs. Multi-account products need explicit per-account namespaces so one account's local state cannot bleed into another.

## UI, accessibility, and device adaptation

Use platform conventions when they carry interaction or accessibility semantics. Validate:

- dynamic text/font scaling and truncation;
- screen readers and accessible names/actions;
- touch target sizes and keyboard/switch navigation where applicable;
- safe areas, notches, system bars, foldables/tablets, rotation, and split-screen where supported;
- light/dark/high-contrast behavior;
- loading, empty, offline, denied-permission, expired-session, conflict, and partial-success states;
- expensive lists/images/animations on representative lower-end devices.

Do not copy web interaction patterns blindly when the platform has a different navigation, gesture, permission, or lifecycle contract.

## Native boundaries in cross-platform apps

Treat a native module/plugin/config-plugin boundary like an independently versioned integration.

- Verify both JavaScript/Dart and native-side contracts.
- Keep platform-specific fallback/error behavior explicit.
- Check autolinking/plugin registration, build settings, entitlements/manifests, and ProGuard/R8 or linker implications when relevant.
- Test upgrades against actual supported framework/platform versions rather than assuming generated native code remains compatible.
- Prefer one cross-platform abstraction only while it preserves necessary native semantics; do not hide material platform differences behind an unsafe common interface.

## Release and compatibility

Mobile clients cannot be upgraded atomically with the backend.

Assume old app versions remain active during backend rollout. Evolve APIs and persisted data additively or through explicit compatibility windows. Before removing an old contract, use real adoption/support policy evidence rather than assuming users updated.

Release validation should cover the actual artifact path: signed/archive/release build, production configuration, native capabilities, deep links, push/environment configuration, crash symbol/source-map handling, and store/internal-track installation where available. A debug simulator build is not proof of release correctness.

Treat app-store review, phased/staged rollout, and emergency hotfix/rollback limits as part of the delivery model. Store rollback is often slower and less controllable than server rollback, so favor backend-compatible forward repair.

## Validation shape

Choose evidence from the changed mechanism:

- pure state/domain logic -> unit/property tests;
- API/cache/offline logic -> integration tests with failures/retries/duplicates;
- navigation/deep-link/auth flows -> device/simulator integration or E2E tests;
- native module/plugin/config changes -> platform build plus focused runtime smoke;
- permissions/camera/location/push/background work -> representative device/emulator scenario tests where automation supports them;
- performance-sensitive UI -> profile startup, frame/render pressure, memory/network/image behavior on representative devices;
- release/signing/config changes -> release artifact build/install smoke, not debug-only validation.

When only one platform can be executed in the current environment, state that validation boundary explicitly and preserve platform-specific negative-space review for the unexecuted target.

## Finish the whole slice

A mobile change is not complete because one screen renders. Close the implied responsibilities: server/API compatibility, auth, offline/retry behavior, lifecycle recovery, permissions/privacy declarations, analytics/crash hygiene, native configuration, accessibility, tests, release configuration, and cleanup/removal behavior that the mechanism creates.

Prefer repository-native architecture and the smallest compatible vertical slice. Do not migrate navigation, state management, native build systems, or cross-platform frameworks unless the requested contract requires it.
