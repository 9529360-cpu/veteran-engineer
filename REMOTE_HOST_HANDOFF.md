# Veteran Remote Host — Next Chat Handoff

## Read this first

This document is the continuation authority for the Remote Host workstream started from the user's request:

> Take a clean spare computer, install Veteran Engineer there, let ChatGPT/Web connect to that machine, and let Veteran Engineer actually inspect repositories, edit code, run terminals/processes, launch/validate desktop apps, inspect screenshots, and keep working until the user's requested outcome is visibly complete.

The user's desired product behavior is:

`user describes outcome -> Veteran Engineer connects to dedicated machine -> inspects/edits/runs/tests real project -> launches browser/Electron/desktop app when relevant -> inspects visible result -> continues fixing if the result does not match -> reports only after real validation`

Do not reduce this to “remote shell access”. The Remote Host is the execution body for the existing Veteran Engineer Skill + Mission/MCP runtime.

## Repository / active branch / PR

Repository:

`9529360-cpu/veteran-engineer`

Active Remote Host branch:

`feat/remote-host-control-plane-v1-final`

Current known branch head at handoff creation:

`db0bd13434b733d0660535f7a68e2ab66ef8b6c3`

Open PR:

`#457 feat: add Veteran Remote Host control plane`

Base branch:

`feat/remediation-reentry`

Important: refresh the branch, PR, and workflow state before making further changes. Do not assume this SHA is still current.

## Why this work exists

The user wants Veteran Engineer to behave like:

- “I describe it; it completes it.”
- Not “I describe layout + liquid glass and it changes one color.”
- Not “build passed, therefore UI is done.”
- Not “review found a gap, so report the gap and stop.”

The remediation/outcome-closure work preceding this branch already hardened the engineering brain:

- preserve every material user clause;
- reject semantic-dimension substitution (layout cannot be replaced by colors/theme-only changes);
- require visible-boundary validation for UI/desktop work when the runtime can render it;
- failed review with a safe remediation path is continuation, not completion;
- `remediation_plan(apply=true)` re-enters the same Mission;
- applied remediation routes back toward `mission_execute`;
- remediation is bound to authoritative failed-review findings;
- packaged Skill/runtime alignment was fixed so desktop artifacts carry the new behavioral kernel.

Remote Host is the missing execution body that lets that brain operate a real machine.

## Architectural invariant

Do **not** fork Veteran Engineer into a second remote-agent implementation.

Keep:

`one Skill/policy + one Mission/runtime core + one MCP tool contract + Remote Host transport/device boundary`

The remote machine should run the existing Veteran runtime. Remote access should expose the existing intention-level MCP surface, not create a parallel raw-shell product.

The repository already had `veteran-surface-capabilities-v1` and a `secure-tunnel` topology before this branch. That existing topology described capability but did not yet provide a real remote host process, pairing lifecycle, HTTP MCP listener, or device control plane. This work fills that gap.

## What has already been implemented on this branch

### 1. Workspace boundary

New file:

`src/workspace-policy.mjs`

Mirrored at:

`skills/runtime-regression-debugger/assets/plugin-runtime-starter/src/workspace-policy.mjs`

Behavior:

- normalize configured workspace roots;
- create workspace roots during Host initialization;
- canonicalize via `realpath` where possible;
- enforce path containment with `path.relative`, not naive string prefix checks;
- fail with `REMOTE_WORKSPACE_NOT_ALLOWED` when a requested local path is outside configured roots;
- intended to block sibling-prefix tricks and symlink escapes.

Remote `project_open(repoPath=...)` and `file://` repository sources are passed through this gate.

### 2. Remote Host configuration / device identity / pairing token

New file:

`src/remote-host-config.mjs`

Mirrored in the starter runtime.

Implemented concepts:

- `REMOTE_HOST_CONFIG_VERSION = 1`;
- default config path: `~/.veteran-engineer/remote-host.json`;
- default state root: `~/.veteran-engineer/state`;
- default bind: `127.0.0.1`;
- default port: `8765`;
- generated device identity `device_<uuid>`;
- generated high-entropy pairing token `veteran_<random base64url>`;
- only `SHA-256` of the pairing token is persisted;
- plaintext token is returned only during initialization / token rotation;
- config records device name, state root, workspaces, allowed origins, allowed Host header names;
- config file is written with restrictive permissions where supported;
- token rotation invalidates the prior token immediately.

This is intentionally not OAuth yet. It is the machine-side pairing primitive for v1.

### 3. Authenticated Remote MCP server

New file:

`src/remote-host-server.mjs`

Mirrored in the starter runtime.

Current server behavior:

- Node HTTP server;
- `/health` endpoint;
- authenticated `/status` endpoint;
- authenticated `/mcp` endpoint;
- uses official `@modelcontextprotocol/server@2.0.0` Streamable HTTP handler (`createMcpHandler`);
- reuses the existing Veteran `TOOL_DEFINITIONS`, input/output schemas, annotations, workflow metadata, workflow bindings, suggestions, and `createVeteranApp`;
- does **not** introduce a second public tool catalog;
- uses the existing Mission/Worker/Validation/Review/Remediation runtime;
- starts Veteran with `surfaceProfile: 'secure-tunnel'`;
- Bearer token authentication with timing-safe digest comparison;
- Host-header allowlist;
- Origin allowlist;
- 8 MiB request-body limit;
- remote `project_open(repoPath=...)` workspace enforcement;
- remote `project_open(repoUrl=file://...)` workspace enforcement;
- graceful close function.

Important security decision:

The server defaults to loopback only. Do **not** simply bind it to a public interface and call the product finished. TLS / approved tunnel / platform app / relay remains the outer transport boundary.

### 4. Remote Host CLI

New executable:

`bin/veteran-remote-host.mjs`

Mirrored in the starter runtime.

Current commands:

- `veteran-remote-host init --workspace <path> [...]`
- `veteran-remote-host start`
- `veteran-remote-host status`
- `veteran-remote-host rotate-token`

Important behavior:

- `init` requires at least one workspace;
- plaintext pairing token is shown once;
- `start` launches the Remote Host and logs device/endpoint/workspace info to stderr;
- SIGINT/SIGTERM trigger graceful close;
- help text explicitly warns to put TLS / an approved tunnel in front of the process rather than exposing it directly.

### 5. Package registration

`package.json` and `package-lock.json` now include the second executable:

- `veteran-engineer`
- `veteran-remote-host`

These files are mirrored in the starter runtime.

### 6. Real Remote Host tests

New test:

`tests/remote-host.test.mjs`

Mirrored in the starter runtime.

The intended tests cover:

1. config stores only the token digest, not plaintext token;
2. Host starts and `/health` responds;
3. `/mcp` requires auth;
4. bad Origin is rejected;
5. bad Host header is rejected;
6. authenticated `/status` exposes device identity and `secure-tunnel` profile;
7. official MCP Client can connect over Streamable HTTP;
8. remote tool list equals the existing Veteran tool surface;
9. allowed workspace `project_open` succeeds;
10. outside-workspace `project_open` returns `REMOTE_WORKSPACE_NOT_ALLOWED`.

This is intended to prove actual remote MCP behavior, not only helper functions.

## Current validation state

At the point of this handoff:

- PR #457 exists.
- Initial Actions were triggered for an earlier head.
- Root/starter mirror changes were then added and branch head advanced to `db0bd13434b733d0660535f7a68e2ab66ef8b6c3`.
- The latest head's workflow runs had not yet appeared when the user requested this handoff.

Therefore **do not claim Remote Host v1 is green yet**.

Next chat must first:

1. refresh `feat/remote-host-control-plane-v1-final` head;
2. refresh PR #457;
3. fetch workflow runs for the latest head;
4. if any job fails, inspect job steps/logs and repair the real failure;
5. confirm root/starter byte parity still passes;
6. confirm the real Remote Host integration test executes (not skipped unexpectedly because of dependency/setup drift).

Likely failure classes to watch for:

- exact official SDK import/export shape for `createMcpHandler` / Streamable HTTP client;
- SDK integrity root calculation in `remote-host-server.mjs`;
- request/response bridging between Node HTTP and Fetch API types;
- Streamable HTTP client auth-header option shape;
- starter mirror parity;
- package-lock/bin metadata checks;
- cross-platform path / file URL behavior on Windows;
- tests accidentally passing only on Linux because of filesystem semantics.

Do not weaken the test to get green. Fix the runtime owner.

## Immediate next implementation sequence

After Remote Host v1 is green, continue in this order.

### Slice A — Host daemon / supervised lifecycle

Goal: the spare computer can keep the Veteran Host online without a terminal window.

Implement:

- `install-service` / `uninstall-service` or equivalent host lifecycle;
- Windows first, because the user's spare machine is likely to be used as the first real worker;
- startup/restart supervision;
- PID/status authority;
- log location and bounded log rotation;
- safe upgrade/repair behavior;
- pause / resume / stop controls;
- no hidden persistence outside Veteran-owned directories.

Do not couple service supervision to Mission state ownership.

### Slice B — Clean-machine bootstrap

Goal: user can take a nearly empty Windows machine and get to a working Veteran Host with minimal manual setup.

Need a verified bootstrap path that prepares or validates:

- Node runtime requirement;
- Git;
- Veteran runtime bundle;
- MCP SDK dependencies;
- browser/Electron validation dependencies as needed;
- workspace root;
- Remote Host config + token;
- service installation.

Prefer a signed/verified release artifact path over “clone repo and manually npm install”. Keep dependency lifecycle scripts constrained according to existing repository policy.

### Slice C — Secure Web connectivity

Goal: ChatGPT Web can reach the dedicated machine.

Do **not** invent undocumented OpenAI provisioning APIs.

Implement the machine-side connector boundary cleanly and use an approved stable transport when available. Desired architecture:

`ChatGPT Web / Veteran plugin -> authenticated TLS/remote MCP/tunnel -> Veteran Remote Host on dedicated machine`

Requirements:

- Host should initiate outbound connectivity where practical; do not require inbound public port exposure;
- TLS;
- per-device identity;
- token/key rotation;
- explicit pairing;
- disconnect/revoke;
- replay resistance / session expiry as appropriate;
- audit trail;
- no raw unauthenticated shell endpoint;
- platform/plugin binding stays outside core Mission semantics.

If using a third-party relay/tunnel for development, keep it an adapter, not core authority.

### Slice D — Visible desktop/browser execution

This is essential. The product is not complete with filesystem + terminal only.

Goal:

`edit -> launch real app -> inspect rendered result -> interact -> screenshot -> compare against outcome contract -> continue fixing`

Add or connect capabilities for:

- browser launch/control;
- screenshots;
- Electron app launch / close / restart;
- desktop-app process lifecycle;
- window discovery / focus where safely supported;
- visual inspection evidence;
- representative window sizes/states;
- runtime logs;
- UI interaction where available;
- artifact/evidence binding to the exact source/build/runtime identity.

Do not add a raw `exec_anything` MCP tool merely for convenience. Prefer existing Mission/Worker/Validation owners and add generic runtime capabilities only when the existing intention-level surface cannot express the needed validation.

### Slice E — First real machine proof

When the spare machine is available, use it as the first acceptance environment.

Target first acceptance sequence:

1. fresh/clean Windows machine;
2. install/bootstrap Veteran Remote Host;
3. initialize one workspace, e.g. `D:\VeteranWorkspace`;
4. pair Web/agent connection;
5. clone/open an authorized repository;
6. run a simple Mission remotely;
7. edit a file;
8. run tests/build;
9. launch a real browser/Electron fixture;
10. capture/inspect screenshot;
11. intentionally create one bad visual result and prove the agent continues fixing instead of reporting completion;
12. disconnect/revoke and prove the old credential cannot reconnect.

Only after this sequence should the product be described as remotely end-to-end validated.

## Security invariants — do not relax

1. Default bind remains loopback-only.
2. Public internet exposure requires TLS / approved tunnel / relay; no naked HTTP listener on `0.0.0.0` as the recommended setup.
3. Pairing token plaintext is not persisted by default.
4. Workspaces are allowlisted and canonicalized.
5. Remote Git clones go into Veteran-managed storage unless explicitly opening an allowlisted local repo.
6. No arbitrary filesystem root access by default.
7. No new raw shell MCP endpoint just because remote execution is convenient.
8. Existing Veteran Mission/Worker authority remains in force.
9. Merge/push/release/deploy authority is still separate and must not be silently granted by remote connectivity.
10. Keep root runtime and `assets/plugin-runtime-starter` mirrored.
11. Host transport must not become a second engineering brain.
12. Visible UI work requires rendered proof when the remote machine can provide it.

## Product shape we are aiming for

Conceptually:

```text
ChatGPT Web / Desktop
        |
        | Veteran plugin / MCP
        v
Secure pairing + remote transport
        |
        v
Veteran Remote Host (dedicated machine)
        |
        +-- Veteran Skill / Mission runtime
        +-- repository/worktree ownership
        +-- terminal/process execution through existing workers
        +-- Git/build/test
        +-- browser validation
        +-- Electron/desktop lifecycle
        +-- screenshot / visual QA
        +-- logs/evidence
        +-- remediation loop
```

The user's experience should eventually be:

> “把 Hermes Desktop 改成 Codex 布局 + OS 液态玻璃。”

Veteran should then connect to the dedicated machine, inspect the real repo, make structural layout changes and visual-system changes as separate requirements, launch Hermes Desktop, inspect the rendered app, continue fixing if either requirement is missing, run tests, and only then report what is actually proven.

## Do not lose the original intent

The user explicitly asked to prioritize this Remote Host capability now. The spare machine can be prepared later; implementation should continue in the repository first.

Do not bounce ordinary implementation details back to the user. Continue autonomously until a real authorization/product/environment blocker remains.

Do not stop after writing docs or transport scaffolding. The next real milestones are:

`latest CI green -> supervised Host -> clean-machine bootstrap -> secure Web pairing -> browser/Electron/screenshots -> first real spare-machine end-to-end proof`
