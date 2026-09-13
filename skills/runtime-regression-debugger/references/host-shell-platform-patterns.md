# Host-shell and platform integration patterns

## Contents

- Why the host shell is a separate compatibility layer
- Notification and unread pipeline
- Activation, focus, deep links, and single-instance routing
- Popups and external navigation
- Downloads and native dialogs
- Platform identity, signing, and trust stores
- Local application origins and custom protocols
- Enterprise network and certificate prompts
- Installed-package validation matrix
- Mature references to consult live

## Why the host shell is a separate compatibility layer

A remote web service can be healthy while the desktop shell around it is broken.

Model the full user-visible path as separate owners:

`remote-service event -> service adapter -> host state -> OS shell surface -> activation route -> exact account/context`

Examples of host-shell surfaces include tray/menu-bar icons, taskbar/dock badges, native notifications, protocol/deep-link activation, external browser routing, file dialogs, downloads, login items, global shortcuts, media pickers, and OS permission prompts.

Do not infer that these surfaces work because the page itself renders or because an in-app unread counter is correct.

## Notification and unread pipeline

Treat unread and notification behavior as a layered pipeline:

1. remote service produces a semantic event or visible signal;
2. adapter derives unread/direct/indirect state;
3. host stores the current account-scoped projection;
4. host updates in-app badge/tray/taskbar/dock state;
5. native notification is emitted when policy allows it;
6. notification click routes to the correct service/account/context generation.

Test each transition independently. A correct in-app badge does not prove a tray badge, and a displayed notification does not prove click-through routing.

Avoid double notifications and double sounds when the remote service already owns one layer. DND/mute behavior should define whether it suppresses service audio, host notifications, badges, or all of them; do not conflate these states.

## Activation, focus, deep links, and single-instance routing

App activation is a routing problem across OS and process lifecycle.

For protocol/deep-link callbacks and notification clicks:

- parse and validate the destination before routing;
- bind the event to the intended account/service and current generation;
- bring the owning window/workspace to a valid visible state before focusing the target view;
- handle an already-running primary instance and a cold-start instance separately;
- queue early callbacks until the routing owner is ready, with bounded lifetime and exact transaction identity;
- reject stale or unrecognized callbacks instead of sending them to whichever account is visible.

On operating systems where a second process forwards command-line/deep-link data to the primary process, the single-instance boundary is part of the auth/navigation contract.

## Popups and external navigation

A remote page must not own arbitrary native windows or external launches.

Use a privileged host policy to decide whether a request:

- opens as an in-app child WebContents using the same intended Session;
- opens in the system browser;
- is converted into a known internal route;
- is denied.

Validate full parsed URLs and intended schemes. Keep child security preferences at least as strict as the parent. A service needing one OAuth popup does not justify a global `allowpopups` policy or unrestricted `shell.openExternal`.

## Downloads and native dialogs

Downloads belong to the initiating Session/WebContents and user action.

Preserve:

`initiating account + source URL/origin + current WebContents generation + DownloadItem + chosen destination`

Do not re-fetch a download URL with a more privileged Node HTTP client merely to save it. That can lose browser authentication, origin policy, proxy routing, download semantics, and auditability.

Native file/open/save dialogs are main/OS-level surfaces, so renderer-only E2E may not observe them. For deterministic automation, stub only the native dialog owner in test builds or through the runtime's supported main-process test seam, then separately validate the real installed dialog path.

## Platform identity, signing, and trust stores

Installed app identity is part of runtime compatibility.

Depending on platform, native notifications, auto-update, keychain/credential APIs, login items, protocol handlers, and reputation/trust behavior can differ between:

- development executable;
- unpackaged build;
- packaged but unsigned build;
- ad-hoc signed build;
- consistently signed/notarized production build.

Do not call a feature platform-compatible from a development build alone when the OS binds it to application identity or signing.

Treat signing-certificate/publisher rotation as a compatibility migration. Test old installed clients updating to the new signing identity when the updater validates publishers.

## Local application origins and custom protocols

The host shell's local UI origin is a security decision.

Prefer a dedicated application protocol over broad `file://` privileges when the runtime supports it. Register protocol privileges before the required lifecycle boundary and enable only the capabilities actually needed, such as `standard`, `secure`, fetch support, or service workers.

Do not set `bypassCSP`, broad CORS privileges, extension access, or filesystem-like behavior simply because a custom protocol exists. Local-host privileges should be explicit and minimal.

## Enterprise network and certificate prompts

Corporate environments add privileged host-shell flows that consumer testing may not exercise:

- HTTP basic/digest auth;
- proxy authentication;
- NTLM/Negotiate allowlists;
- client-certificate selection;
- private certificate authorities;
- PAC/split DNS;
- smart-card or security-key prompts.

Bind credentials/certificates to the exact requesting host/realm/account/Session. Never globally accept certificate errors. If a custom trust decision is unavoidable, constrain it to documented hosts and validate actual certificate properties rather than returning `true` for every failure.

## Installed-package validation matrix

For shell-sensitive changes, separate at least:

1. source/unit contract;
2. Electron interaction E2E;
3. packaged validation build;
4. installed build;
5. signed/notarized installed build where platform identity matters;
6. update from a supported previous installed version;
7. real OS shell interaction.

Useful shell regression cases:

- notification display and click routing;
- tray/menu-bar/taskbar/dock badge update;
- second-instance/deep-link cold and warm activation;
- external-link policy;
- file open/save/download dialogs;
- media/screen capture prompts;
- app restart and login-item behavior;
- display scaling/multi-monitor focus;
- signed update and keychain/credential continuity.

## Mature references to consult live

Prefer current documentation for:

- Electron Notifications, Deep Links, `app` lifecycle, `webContents.setWindowOpenHandler`, `shell`, `session.will-download`, protocol handling, code signing, and safe storage;
- target OS notification/protocol/signing guidance when Electron delegates to native facilities;
- Playwright Electron support for main-process evaluation and deterministic native-dialog seams;
- active multi-service clients for tray/unread/focus/click-routing field regressions.

Use mature incidents to identify failure classes, but verify current OS/Electron behavior before implementing a workaround.
