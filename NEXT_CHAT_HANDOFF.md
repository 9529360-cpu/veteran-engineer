# Veteran Engineer — Next Chat Handoff

## Current priority

The active product work is **Veteran Remote Host**.

Read this file first, then immediately read:

`REMOTE_HOST_HANDOFF.md`

That document is the detailed continuation authority for the current workstream.

Do **not** resume the older generic convergence/audit work that used to live in this file. The user explicitly changed priority to the Remote Host capability.

## User intent

The user has a spare computer that can be dedicated to Veteran Engineer. The desired end state is:

`user describes outcome in ChatGPT -> Veteran Engineer connects to the dedicated machine -> inspects/edits/runs/tests the real project -> launches browser/Electron/desktop app when relevant -> inspects screenshots/rendered state -> keeps fixing until the requested outcome is actually visible -> reports only after real validation`

This is specifically meant to solve failures like:

`"make Hermes Desktop use a Codex-style layout + liquid-glass OS theme" -> agent only changes a color and stops`

Veteran must preserve separate requirement dimensions, make structural changes for structural requests, and use the real machine for rendered/runtime proof when available.

## Repository state

Repository:

`9529360-cpu/veteran-engineer`

Active branch:

`feat/remote-host-control-plane-v1-final`

Open PR:

`#457 feat: add Veteran Remote Host control plane`

PR base:

`feat/remediation-reentry`

Known head when this pointer was written:

`e92a9e50818220589eb011d3ca602dee127b6417`

Always refresh branch/PR/CI truth before editing.

## Important current status

Remote Host is **partially implemented, not finished**.

The branch already contains the machine-side v1 work described in `REMOTE_HOST_HANDOFF.md`, including:

- workspace allowlist/canonicalization;
- Remote Host device/config/token model;
- authenticated standard Streamable HTTP MCP server;
- loopback-only default listener;
- Host/Origin/request-size boundaries;
- `veteran-remote-host` CLI lifecycle commands;
- package/bin registration;
- real Remote Host integration tests;
- root/runtime-starter mirror changes.

Do not recreate these pieces from scratch. Inspect current branch truth first.

## Immediate next action

1. Read `REMOTE_HOST_HANDOFF.md` completely.
2. Refresh PR #457 and latest workflow runs.
3. Treat any failing CI/runtime integration as the next task and fix the real owner; do not weaken tests.
4. Get Remote Host v1 fully green at the strongest available boundary.
5. Then continue the next slices in the handoff: supervised daemon -> clean-machine bootstrap -> secure Web connectivity -> visible browser/Electron/desktop control -> first real spare-machine proof.

## Architectural invariants

- One Veteran Skill/policy + one Mission/MCP runtime; Remote Host is an execution/transport boundary, not a second engineering brain.
- Reuse the existing intention-level MCP tool surface. Do not add a raw unauthenticated shell endpoint for convenience.
- Default bind remains loopback-only. Public connectivity requires TLS/approved tunnel/relay/platform binding.
- Pairing credentials must be revocable/rotatable and must not be casually persisted in plaintext.
- Local repositories must remain inside configured canonicalized workspace roots.
- Remote Git acquisition remains runtime-managed.
- Merge/push/release/deploy authority is not implied by remote machine connectivity.
- Root runtime and `skills/runtime-regression-debugger/assets/plugin-runtime-starter/` must remain aligned for mirrored runtime files.
- Visible UI/desktop work requires rendered proof when the remote machine can provide it.
- Do not ask the user for ordinary repository-answerable implementation details. Continue autonomously until a real authorization/product/environment blocker exists.

## Do not call it complete yet

Remote Host should only be called remotely end-to-end validated after the spare machine proves the full sequence:

`clean machine -> bootstrap/install -> pair -> open/clone repo -> execute Mission -> edit -> test/build -> launch real browser/Electron/desktop app -> screenshot/visual inspection -> intentional visual mismatch -> self-repair -> revoke/disconnect -> old credential rejected`

Until then, use calibrated completion language.
