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

Current mainline evidence at merge `045414c7f2592856a35c4ab01c9f9a79c9f6cea3`:

- static/syntax/manifest gate: PASS (**59 syntax files**)
- exact MCP tool count: **34**
- official SDK graph + lockfile integrity: VERIFIED
- full Node suite: **56 total / 56 PASS / 0 SKIP / 0 FAIL**
- official pinned `2026-07-28` stdio handshake: PASS
- official modern client auto-negotiation against forced standalone legacy fallback: PASS
- modern pin against standalone fallback: expected failure PASS
- `VETERAN_MCP_REQUIRE_SDK=1`: no silent fallback PASS
- real Docker engine-backed WorkerAdapter smoke: PASS
- root/starter mirrors for changed source/tests/scripts: synchronized

State-specific proof now includes:

- `veteran-state-backend-v1` base contract: PASS
- Local JSON conformance: PASS
- concurrent transaction serialization without lost updates: PASS
- failed mutator commits neither state nor audit event: PASS
- timeline durability + audit verification: PASS
- restart orphaned request `started -> unknown`: PASS
- `veteran-state-transaction-v1`: PASS
- stable opaque snapshot revisions: PASS
- successful compare-and-commit changes revision: PASS
- stale revision fails before state/audit mutation: PASS
- two contenders on one revision admit exactly one winner: PASS
- injected backend contract enforcement at app startup: PASS

Important milestone merge SHAs:

- Mission finalize / merge proposal: `36ff039fd4119e237e8319a45703619e448e12bb`
- Confined container worker: `d22faf4ce618dce76a4c3d01903ea9ffdf9ee5dd`
- Checkpoint/Actions v7 refresh: `a015e21fc1fd394ed012cbfc98a907b2f85dad8b`
- Real Docker worker proof + host UID/GID fix: `c2762d30055988bd48b5df00c482f852753b208b`
- State backend v1 contract + conformance: `17fdd364cc88ebd9f490dbbcd0ed0b0f44180e05`
- Transactional state compare-and-commit: `045414c7f2592856a35c4ab01c9f9a79c9f6cea3`

## Mission lifecycle

The mission state machine covers:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize never merges or pushes. A proof-fresh candidate produces a durable merge proposal containing candidate/ref/source/proof identity, `automaticMerge:false`, `automaticPush:false`, and `requiresOperatorAction:true`. Stable retries reuse the proposal; missing finalize evidence after a partial failure is repaired on retry. Source drift supersedes the proposal, refreshes the candidate, and forces revalidation/re-review.

## Worker execution model

The runtime owns task worktrees, HEAD authority, actual-write verification, task commits, and deterministic serial integration. Worker HEAD mutation is rejected. Task packets live outside task worktrees.

The Codex preset uses `codex exec --sandbox workspace-write --ephemeral`; dangerous sandbox/approval bypass flags are rejected. `custom-unconfined` requires explicit operator opt-in and remains blocked for high/critical/broad-write tasks.

The built-in `container` worker remains at the WorkerAdapter boundary. It requires Docker/Podman, digest-pinned images, no network, read-only rootfs, `cap-drop ALL`, `no-new-privileges`, bounded resources, bounded `noexec,nosuid` `/tmp`, only task-worktree writable, read-only task `.git` control file and packet, allowlist-only environment, no arbitrary engine flags/mounts, unique names, and cleanup on cancel/timeout/client exit.

The permanent real-engine CI gate exposed and closed the host packet UID boundary: confined containers default to the host process numeric UID:GID when available so host `0600` packets remain private/readable and worktree output is not root-owned. Explicit operator `user` still overrides this default.

Container isolation is defense-in-depth; post-execution HEAD, symlink-containment, write-scope, commit, and integration gates remain mandatory.

## Durable state architecture

Local JSON remains the default authority and its proven storage algorithm has not been replaced. It provides cross-process locking, atomic state-file replacement, backup recovery, audit hash chain, persistent requestId idempotency, unknown-outcome reconciliation, and durable projects/missions/tasks/evidence/experience/candidates/merge proposals.

Two internal contracts now guard future state backends:

### `veteran-state-backend-v1`

Required runtime-facing surface:

- `init()`
- `read()`
- `transaction()`
- `recordTimeline()`
- `verifyAudit()`
- execution-local `artifactsDir`
- execution-local `worktreesDir`

`LocalJsonStateBackend extends StateStore` is the first conforming implementation. `createVeteranApp` accepts backend injection but fails closed on contract violations.

### `veteran-state-transaction-v1`

Required transactional extension:

- `readSnapshot()` -> `{ state, revision }`
- `compareAndCommit(expectedRevision, eventType, mutator, auditSummary)`

Revisions are opaque. Local JSON computes a content revision and checks it inside the existing state lock. Stale revisions raise `STATE_REVISION_CONFLICT` before state/audit mutation. Concurrent CAS contenders on one revision produce one winner and one conflict. A successful caller must re-read to get the next revision; the runtime does not invent a speculative post-commit token.

Important limitation that must remain explicit: local `StateStore.transaction()` atomically replaces the state file and then appends the audit entry. State-file commit plus audit append is **not** currently one atomic storage transaction. Do not claim otherwise. This is the next state-semantics gap to address before a hosted backend is treated as production-equivalent.

## Experience

Reviewed **active** experience may influence Planner/Worker/semantic Reviewer. Candidate/challenged/rejected/retired experience is quarantined. Current repository/runtime evidence always outranks experience.

## Cross-host installation

- Shared runtime default: `~/plugins/veteran-engineer`
- Durable state default: `~/.veteran-engineer/state`
- Installer metadata: `~/.veteran-engineer/installer.json`
- Codex, Hermes, generic MCP, and trusted external adapters all use the same runtime.
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
12. Future state backends must pass base + transactional contracts and the same conformance semantics; storage shape alone is insufficient.

## Packaging resilience

The bundled Skill must continue to contain `assets/plugin-runtime-starter/` as the recovery seed. Core runtime files/tests/scripts changed for product behavior must remain synchronized with that starter. `scripts/export_plugin_bundle.py` remains the supported bundle export path and must avoid recursive starter duplication.

## Exact next target

Keep `0.3.0` until a separate version/release decision is made. Preserve the exact 34-tool public MCP surface unless a separate compatibility decision explicitly changes it.

The backend-interface and compare/commit prerequisites are closed. **Do not add a hosted database yet.** The next state milestone is to define and prove commit-outcome / audit partial-failure semantics around the existing local ordering:

1. distinguish durable state commit from audit append completion;
2. ensure a crash/failure between those stages is detectable and reconcilable rather than silently reported as a normal success;
3. keep requestId `unknown` behavior conservative under ambiguous commit outcomes;
4. preserve append-only audit ordering and tamper detection;
5. preserve backup/recovery semantics;
6. add fault-injection/conformance tests before changing persistence implementation;
7. local JSON remains the default backend throughout this work.

Only after those semantics are explicit and executable should a hosted transactional implementation be considered. Bounded external connectors remain a later candidate.
