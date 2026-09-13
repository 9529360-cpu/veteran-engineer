# Veteran Engineer — Current Checkpoint Handoff

## Authority and provenance

The historical pre-reconstruction `0.3.0` ZIP is lost and cannot be recovered byte-for-byte. The active authority is now the GitHub repository:

`9529360-cpu/veteran-engineer`

Judge the product by current repository/runtime evidence, tests, schemas, and the bundled `runtime-regression-debugger` Skill. Do not compare current test counts directly with the historical `106/106` claim.

Product invariant:

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

The official path verifies installed versions plus `package-lock.json` package entries and npm integrity. Missing/partial/drifted graphs fail closed. The dependency-free standalone fallback remains deliberately legacy-only and must not fake `server/discover` or modern negotiation.

Hard modern gate:

```bash
npm run mcp:handshake:modern
```

A modern pin never falls back.

## Current executable evidence

GitHub CI runs on PRs and pushes to `main` with Node 20:

```bash
npm ci --include=optional
npm run check
```

Current mainline evidence after the Mission finalize and container-worker milestones:

- static/syntax/manifest gate: PASS
- exact MCP tool count: 34
- official SDK graph + lockfile integrity: VERIFIED
- full Node suite: **45 total / 45 PASS / 0 SKIP / 0 FAIL**
- official pinned `2026-07-28` stdio handshake: PASS
- official modern client auto-negotiation against forced standalone legacy fallback: PASS
- modern pin against standalone fallback: expected failure PASS
- `VETERAN_MCP_REQUIRE_SDK=1`: no silent fallback PASS
- runtime starter mirrors for changed core source/tests: blob-identical at merge time

Important milestone merge SHAs:

- Mission finalize / merge proposal: `36ff039fd4119e237e8319a45703619e448e12bb`
- Confined container worker: `d22faf4ce618dce76a4c3d01903ea9ffdf9ee5dd`

## Mission lifecycle

The mission state machine now covers:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize does **not** merge or push. A proof-fresh candidate produces a durable merge proposal containing:

- candidate ID/SHA/ref;
- expected source HEAD and target branch;
- mission head;
- bound validation/review/semantic-review proof;
- `automaticMerge:false`;
- `automaticPush:false`;
- `requiresOperatorAction:true`.

Stable retries reuse the durable proposal. If proposal persistence succeeds but evidence recording fails, a retry repairs the missing evidence without creating a second proposal. Source drift supersedes the active proposal, refreshes the immutable candidate, and forces revalidation/re-review before another proposal can be emitted.

The runtime never moves the user's branch during candidate creation, refresh, or finalize.

## Worker execution model

The runtime owns task worktrees, task commits, actual-write verification, and deterministic serial integration. Worker HEAD mutation is rejected. Task packets live outside task worktrees.

### Codex preset

The built-in Codex preset uses:

`codex exec --sandbox workspace-write --ephemeral`

Dangerous sandbox/approval bypass flags are rejected.

### Custom workers

`custom-unconfined` requires explicit operator opt-in and remains blocked for high/critical/broad-write tasks.

### Confined container worker

A built-in `container` worker is implemented at the WorkerAdapter boundary so the orchestrator remains host-neutral.

Fail-closed rules:

- engine restricted to Docker or Podman;
- image must be pinned to an exact `@sha256:<64 hex>` digest;
- no network;
- read-only root filesystem;
- `cap-drop ALL`;
- `no-new-privileges`;
- bounded pids/memory/cpu;
- bounded `noexec,nosuid` tmpfs for `/tmp`;
- only the isolated task worktree is writable;
- task `.git` control file is overmounted read-only and the linked external gitdir is not mounted;
- task packet is read-only;
- environment is allowlist-only;
- Docker/Podman control environment variables are rejected;
- no arbitrary engine flags or extra mounts;
- every invocation receives a unique bounded container name;
- cancel, timeout, and engine-client close perform best-effort `rm -f` cleanup.

The runtime still applies its post-execution HEAD, symlink-containment, write-scope, commit, and integration gates. Container isolation does not become a new state authority.

Current tests validate the generated container contract and policy behavior. A real Docker/Podman engine-backed smoke test has not yet been promoted into the permanent CI gate; do not claim that proof until it exists.

## Durable state and experience

Current state remains local durable JSON under the runtime state root with:

- cross-process lock ownership;
- atomic replacement and backup recovery;
- audit hash chain;
- persistent requestId idempotency;
- `unknown` outcome reconciliation instead of blind replay;
- durable projects/missions/tasks/evidence/experience/candidates/merge proposals.

Reviewed **active** experience may influence Planner/Worker/semantic Reviewer. Candidate/challenged/rejected/retired experience is quarantined. Current repository/runtime evidence always outranks experience.

## Cross-host installation

- Shared runtime default: `~/plugins/veteran-engineer`
- Durable state default: `~/.veteran-engineer/state`
- Installer metadata: `~/.veteran-engineer/installer.json`
- Codex, Hermes, and generic MCP adapters all use the same runtime.
- External trusted adapters must pass adapter API/id/filename validation.
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
11. Container isolation is defense-in-depth; runtime post-execution ownership gates remain mandatory.

## Packaging resilience

The bundled Skill must continue to contain `assets/plugin-runtime-starter/` as the recovery seed. Core runtime files/tests changed for product behavior must remain synchronized with that starter. `scripts/export_plugin_bundle.py` is the supported bundle export path and must avoid recursive starter duplication.

## Exact next target

Keep `0.3.0` until a separate version/release decision is made.

The next practical target is to close the remaining proof gap for the new confined worker by adding a **real Docker engine-backed CI smoke gate** that:

1. obtains a digest-pinned test image identity at runtime;
2. executes a harmless worker through the actual `WorkerAdapter` container path;
3. proves task-worktree writes succeed while network/rootfs/Git metadata escape attempts fail;
4. proves cancellation/timeout cleanup leaves no named container behind;
5. skips/fails explicitly based on runner capability rather than pretending a contract-only unit test is engine proof.

After that, the next architectural candidates are hosted/transactional state and bounded external connectors. Preserve the exact 34-tool public MCP surface unless a separate compatibility decision explicitly changes it.
