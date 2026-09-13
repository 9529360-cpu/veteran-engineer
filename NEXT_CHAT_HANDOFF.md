# Veteran Engineer — Current Checkpoint Handoff

## Authority and provenance

The historical pre-reconstruction `0.3.0` ZIP is lost and cannot be recovered byte-for-byte. The active implementation authority is the GitHub repository:

`9529360-cpu/veteran-engineer`

Judge the product by current repository/runtime evidence, executable gates, and the bundled `runtime-regression-debugger` Skill. Product invariant:

`Skill/policy + shared Mission/MCP runtime -> thin host adapter -> host registration`

Do not fork the engineering core for Codex, Hermes, generic MCP, or future hosts.

## Current version and protocol surface

- Runtime/package/plugin manifest: `0.3.0`
- Version intentionally not bumped yet.
- Exact MCP tool surface: **34** tools.
- Official modern protocol: `2026-07-28`.
- Standalone legacy protocol: `2025-11-25`.
- Pinned SDK graph:
  - `@modelcontextprotocol/client@2.0.0`
  - `@modelcontextprotocol/server@2.0.0`
  - `@modelcontextprotocol/core@2.0.0`
  - `zod@4.2.0`

The official path verifies installed versions plus `package-lock.json` entries and npm integrity. Missing/partial/drifted graphs fail closed. Standalone fallback remains deliberately legacy-only. A modern pin never falls back.

## Current executable evidence

GitHub CI runs on PRs and pushes to `main` with ordered gates:

1. `npm ci --include=optional && npm run check`
2. real Docker engine-backed `WorkerAdapter` smoke

Current mainline evidence at merge `c2762d30055988bd48b5df00c482f852753b208b`:

- static/syntax/manifest gate: PASS (**54 syntax files**)
- exact MCP tool count: **34**
- official SDK graph + lockfile integrity: VERIFIED
- full Node suite: **46 total / 46 PASS / 0 SKIP / 0 FAIL**
- official pinned `2026-07-28` stdio handshake: PASS
- official modern client auto-negotiation against forced standalone legacy fallback: PASS
- modern pin against standalone fallback: expected failure PASS
- `VETERAN_MCP_REQUIRE_SDK=1`: no silent fallback PASS
- real Docker engine availability: PASS
- digest-pinned test image resolution: PASS
- real confined worker execution through `WorkerAdapter`: PASS
- task packet read with host mode `0600`: PASS
- task-worktree write: PASS
- read-only rootfs: PASS
- Git control-file write block: PASS
- outbound network block: PASS
- operator-cancel cleanup: PASS
- timeout cleanup: PASS
- root/starter mirrors for changed source/tests/scripts: synchronized

Important milestone merge SHAs:

- Mission finalize / merge proposal: `36ff039fd4119e237e8319a45703619e448e12bb`
- Confined container worker: `d22faf4ce618dce76a4c3d01903ea9ffdf9ee5dd`
- Checkpoint/Actions v7 refresh: `a015e21fc1fd394ed012cbfc98a907b2f85dad8b`
- Real Docker engine-backed worker proof + host UID/GID fix: `c2762d30055988bd48b5df00c482f852753b208b`

## Mission lifecycle

The mission state machine covers:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize never merges or pushes. A proof-fresh candidate produces a durable merge proposal containing candidate/ref/source/proof identity, `automaticMerge:false`, `automaticPush:false`, and `requiresOperatorAction:true`. Stable retries reuse the proposal; missing finalize evidence after a partial failure is repaired on retry. Source drift supersedes the proposal, refreshes the candidate, and forces revalidation/re-review.

## Worker execution model

The runtime owns task worktrees, HEAD authority, actual-write verification, task commits, and deterministic serial integration. Worker HEAD mutation is rejected. Task packets live outside task worktrees.

### Codex preset

Uses `codex exec --sandbox workspace-write --ephemeral`; dangerous sandbox/approval bypass flags are rejected.

### Custom workers

`custom-unconfined` requires explicit operator opt-in and remains blocked for high/critical/broad-write tasks.

### Confined container worker

The built-in `container` worker remains at the WorkerAdapter boundary so the orchestrator stays host-neutral. Fail-closed rules include Docker/Podman only, digest-pinned images, no network, read-only rootfs, `cap-drop ALL`, `no-new-privileges`, bounded pids/memory/cpu, bounded `noexec,nosuid` `/tmp`, only task-worktree writable, read-only task `.git` control file and task packet, allowlist-only environment, engine-control env rejection, no arbitrary mounts/engine flags, unique names, and cleanup on cancel/timeout/client exit.

The permanent CI gate now proves this against a real Docker engine. That gate exposed a real ownership bug: host `0600` packets were unreadable to an unrelated image-default UID. Veteran now defaults confined containers to the host process numeric UID:GID when available, preserving private packet mode and avoiding root-owned worktree output. An explicit operator `user` still overrides the default.

Container isolation is defense-in-depth; post-execution HEAD, symlink-containment, write-scope, commit, and integration gates remain mandatory.

## Durable state and experience

Current authority remains local durable JSON under the runtime state root with cross-process locking, atomic replacement, backup recovery, audit hash chain, persistent requestId idempotency, unknown-outcome reconciliation, and durable projects/missions/tasks/evidence/experience/candidates/merge proposals.

Reviewed **active** experience may influence Planner/Worker/semantic Reviewer. Candidate/challenged/rejected/retired experience is quarantined. Current repository/runtime evidence always outranks experience.

## Cross-host installation

- Shared runtime default: `~/plugins/veteran-engineer`
- Durable state default: `~/.veteran-engineer/state`
- Installer metadata: `~/.veteran-engineer/installer.json`
- Codex, Hermes, and generic MCP adapters all use the same runtime.
- External trusted adapters must pass API/id/filename validation.
- Repair/upgrade preserves an existing `node_modules` tree so official SDK capability does not silently disappear.

## Authority invariants

1. One product; host adapters do not fork the core.
2. Current repository/runtime evidence outranks experience.
3. Candidate/challenged/rejected/retired experience never influences execution.
4. Planner/worker/reviewer providers propose; core validates and owns state.
5. Runtime never auto-merges/pushes/deploys/publishes/releases.
6. User checkout is never the multi-agent mutation surface.
7. Unknown idempotent outcomes require reconciliation, never blind replay.
8. Unconfined custom workers cannot run high/critical/broad-write tasks.
9. AI validation defaults to operator-defined capabilities, not arbitrary shell.
10. Modern MCP support requires a real pinned official-SDK proof.
11. Container isolation does not replace runtime ownership gates.

## Packaging resilience

The bundled Skill must continue to contain `assets/plugin-runtime-starter/` as the recovery seed. Core runtime files/tests/scripts changed for product behavior must remain synchronized with that starter. `scripts/export_plugin_bundle.py` remains the supported bundle export path and must avoid recursive starter duplication.

## Exact next target

Keep `0.3.0` until a separate version/release decision is made. Preserve the exact 34-tool public MCP surface unless a separate compatibility decision explicitly changes it.

The container engine proof gap is closed. The next architectural candidate is **hosted/transactional state**, but do not begin with a storage rewrite. First define and prove a narrow state-backend contract that preserves current semantics:

1. atomic compare/commit boundary for runtime mutations;
2. requestId idempotency including `unknown` outcome reconciliation;
3. append-only audit-chain ordering and integrity;
4. cross-process/global worker admission correctness;
5. backup/recovery or equivalent durable snapshot semantics;
6. local JSON remains the default backend and passes the same conformance suite;
7. no host-specific state fork and no MCP surface expansion solely for storage.

Only after the backend contract and conformance tests exist should a hosted transactional implementation be considered. Bounded external connectors remain a later candidate.
