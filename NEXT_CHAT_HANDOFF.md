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

Current mainline evidence at merge `91df0cd8a3138947e53672b584cc39bd3504f23d`:

- static/syntax/manifest gate: PASS (**59 syntax files**)
- exact MCP tool count: **34**
- official SDK graph + lockfile integrity: VERIFIED
- full Node suite: **62 total / 62 PASS / 0 SKIP / 0 FAIL**
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
- stale revision fails before state/audit mutation: PASS
- two contenders on one revision admit exactly one winner: PASS
- durable state commit / missing audit is detected: PASS
- restart repairs a missing audit exactly once: PASS
- audit appended / acknowledgement lost is recognized without duplication: PASS
- a later mutation reconciles the prior audit gap before proceeding: PASS
- audit mismatch/tamper remains fail-closed: PASS
- ambiguous request admission resumes only the owning attempt: PASS
- ambiguous handler commit becomes request `unknown`, not false `failed`: PASS
- ambiguous request-completion audit returns success only after durable reconciliation proves `completed`: PASS

Important milestone merge SHAs:

- Mission finalize / merge proposal: `36ff039fd4119e237e8319a45703619e448e12bb`
- Confined container worker: `d22faf4ce618dce76a4c3d01903ea9ffdf9ee5dd`
- Checkpoint/Actions v7 refresh: `a015e21fc1fd394ed012cbfc98a907b2f85dad8b`
- Real Docker worker proof + host UID/GID fix: `c2762d30055988bd48b5df00c482f852753b208b`
- State backend v1 contract + conformance: `17fdd364cc88ebd9f490dbbcd0ed0b0f44180e05`
- Transactional state compare-and-commit: `045414c7f2592856a35c4ab01c9f9a79c9f6cea3`
- State commit/audit partial-failure reconciliation: `91df0cd8a3138947e53672b584cc39bd3504f23d`

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

Local JSON remains the default authority and its proven storage algorithm has not been replaced. It provides cross-process locking, atomic state-file replacement, backup recovery, append-only audit hash chain, persistent requestId idempotency, unknown-outcome reconciliation, and durable projects/missions/tasks/evidence/experience/candidates/merge proposals.

Two internal contracts currently guard future state backends:

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

### State commit / audit outcome semantics

Every new local durable state mutation now stores `runtime.durability.lastStateCommit` with a unique commit identity, commit timestamp, event type, and audit summary. The matching audit entry includes the same `stateCommitId`.

If state replacement is durable but audit append or acknowledgement becomes ambiguous, the transaction raises `STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN` with `stateCommitted:true`; it does not pretend the transaction definitely failed. Startup, explicit `reconcilePendingAudit()`, and the next mutation reconcile the latest commit against the verified audit chain before progressing:

- matching entry already exists -> accept without duplication;
- entry is missing -> append exactly once;
- duplicate/mismatch/malformed/tampered chain -> fail closed with audit integrity error.

`verifyAudit()` also detects when the current state's latest commit has no matching audit record.

At the request layer, each `request_started` reservation carries an internal admission attempt identity. Only the invocation whose admission identity matches the durable reservation may resume after an ambiguous admission commit. A handler mutation with an ambiguous durable outcome is marked request `unknown`, never `failed`. A completion-stage ambiguity returns the known result only after reconciliation proves the durable request record is already `completed`.

Existing schema version remains `3`; old state without `runtime.durability` remains readable, and old audit entries without `stateCommitId` retain their historical hash material.

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
12. Future state backends must pass base + transactional + durable-outcome semantics; storage shape alone is insufficient.

## Packaging resilience

The bundled Skill must continue to contain `assets/plugin-runtime-starter/` as the recovery seed. Core runtime files/tests/scripts changed for product behavior must remain synchronized with that starter. `scripts/export_plugin_bundle.py` remains the supported bundle export path and must avoid recursive starter duplication.

## Exact next target

Keep `0.3.0` until a separate version/release decision is made. Preserve the exact 34-tool public MCP surface unless a separate compatibility decision explicitly changes it.

The local commit/audit partial-failure gap is closed. Before introducing a real hosted database, promote the newly proven semantics into an explicit **durable-outcome backend capability contract** and reusable conformance gate:

1. declare a versioned capability for commit-outcome reconciliation rather than relying on optional method detection;
2. require a backend-level reconciliation operation and fail closed at app startup when the capability is absent;
3. conformance must prove state-committed/audit-missing recovery, audit-appended/ack-lost deduplication, conservative unknown request outcomes, and tamper/mismatch rejection;
4. keep `veteran-state-backend-v1` and `veteran-state-transaction-v1` unchanged for compatibility;
5. Local JSON remains the first implementation and default backend;
6. no MCP surface expansion solely for storage;
7. only after this capability is executable should a concrete hosted transactional adapter be added behind an explicit operator configuration boundary.

The installed ChatGPT Skill is already usable; future repository hardening must not block normal Skill use. Repackage the Skill at the next meaningful stable checkpoint rather than after every small internal PR.
