# Veteran Engineer — Current Checkpoint Handoff

## Authority

The active implementation authority is the GitHub repository:

`9529360-cpu/veteran-engineer`

Judge the product by current repository/runtime evidence, executable gates, and the bundled `runtime-regression-debugger` Skill. Historical exported ZIPs and remembered checkpoints are not implementation authority.

Product invariant:

`Skill/policy + shared Mission/MCP runtime -> thin host adapter -> host registration`

Do not fork Mission, MCP, worker, state, evidence, or experience logic per host.

## Current line

- Runtime/package/plugin version: `0.3.0`
- State schema: `3`
- Public MCP tool surface: exactly **34 tools**
- Official modern protocol: `2026-07-28`
- Legacy protocol: `2025-11-25`
- Standalone fallback is legacy-only
- Modern pin never falls back
- Pinned base SDK graph:
  - `@modelcontextprotocol/client@2.0.0`
  - `@modelcontextprotocol/server@2.0.0`
  - `@modelcontextprotocol/core@2.0.0`
  - `zod@4.2.0`

The base lockfile remains the verified MCP SDK graph. PostgreSQL is an explicit hosted capability and currently requires exact `pg@8.23.0` installed in the shared runtime when selected.

## Current executable evidence

Mainline CI has three real gates:

1. Node 20 `npm ci --include=optional && npm run check`
2. real Docker engine-backed confined WorkerAdapter smoke
3. real PostgreSQL engine-backed state-backend integration plus modern MCP handshake with PostgreSQL selected

Current base gate proves:

- **67 syntax files**
- exact **34-tool** MCP surface
- protocol constants correct
- official SDK graph + lockfile integrity verified
- runtime/starter mirror parity enforced by `scripts/check.mjs`
- **70 total / 70 PASS / 0 SKIP / 0 FAIL** Node tests

PostgreSQL integration separately proves the shared base/transaction semantics, durability behavior, commit acknowledgement reconciliation, tamper rejection, audit repair, and concurrent writes from independent backend instances/connection pools sharing one durable `instanceKey`.

## Completed milestones

The active implementation now contains:

1. Mission finalize and durable merge proposal
2. confined Docker/Podman WorkerAdapter
3. real Docker engine worker proof and host UID:GID correction
4. `veteran-state-backend-v1`
5. `veteran-state-transaction-v1`
6. opaque revisions + compare-and-commit / stale conflict semantics
7. state-commit / audit partial-failure reconciliation
8. request admission attempt identity and conservative unknown outcomes
9. `veteran-state-durability-v1`
10. Local JSON conformance for all three contracts
11. explicit PostgreSQL hosted backend with real engine proof
12. root/runtime-starter parity as an executable CI invariant
13. convergence audit across the previous milestones

Important recent mainline milestone:

- hosted PostgreSQL merge: `d874544261676535a0a0aadec06b9089d3cbed27` (`#12`)

When this handoff is read after later commits, refresh `main` before trusting any SHA/count here.

## Mission authority and finalize

Mission lifecycle:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize never merges or pushes. A proof-fresh candidate produces a durable merge proposal with:

- `automaticMerge:false`
- `automaticPush:false`
- `requiresOperatorAction:true`

Proposal identity binds candidate SHA/ref, expected source HEAD/branch, mission HEAD, and proof identities. Source or mission drift invalidates the proposal and forces candidate refresh plus revalidation/re-review. Stable retries reuse an unchanged proposal. Partial-failure evidence is repaired rather than silently replaced.

## Worker boundary

The runtime owns task worktrees, HEAD authority, actual-write verification, task commits, and deterministic serial integration.

Codex preset:

`codex exec --sandbox workspace-write --ephemeral`

Dangerous sandbox/approval bypass flags are rejected.

Confined container worker:

- Docker or Podman only
- digest-pinned images only
- network disabled
- read-only rootfs
- all capabilities dropped
- `no-new-privileges`
- bounded resources
- bounded `noexec,nosuid` `/tmp`
- only isolated task worktree writable
- task `.git` control file and packet read-only
- allowlist-only environment forwarding
- host numeric UID:GID by default when available
- cleanup on cancel/timeout/client exit

Container isolation never replaces post-execution HEAD, symlink-containment, write-scope, commit, and integration gates.

`custom-unconfined` remains blocked for high/critical/broad-write tasks and requires explicit operator opt-in otherwise.

## Durable state architecture

### Base contract

`veteran-state-backend-v1` requires:

- `init()`
- `read()`
- `transaction()`
- `recordTimeline()`
- `verifyAudit()`
- execution-local `artifactsDir`
- execution-local `worktreesDir`

### Transaction contract

`veteran-state-transaction-v1` requires:

- `readSnapshot()` -> `{ state, revision }`
- `compareAndCommit(expectedRevision, eventType, mutator, auditSummary)`

Revisions are opaque. Stale expected revisions fail before state/audit mutation.

### Durability contract

`veteran-state-durability-v1` requires explicit commit-outcome reconciliation through `reconcilePendingAudit()`.

Durable mutations bind state and audit with `stateCommitId`. Unknown outcomes are conservative; blind replay is forbidden. Tamper/mismatch fails closed.

### Local JSON

Local JSON remains the default authority and keeps:

- cross-process locking
- atomic state replacement
- backup recovery
- audit hash chain
- requestId idempotency
- commit/audit repair
- orphaned `started -> unknown` startup reconciliation

### PostgreSQL

PostgreSQL is opt-in and can be selected programmatically or via:

```bash
VETERAN_ENGINEER_STATE_BACKEND=postgres
VETERAN_ENGINEER_POSTGRES_URL='postgresql://...'
VETERAN_ENGINEER_STATE_INSTANCE='stable-instance-key'
VETERAN_ENGINEER_POSTGRES_POOL_MAX=4
```

It requires exact `pg@8.23.0` in the shared runtime.

PostgreSQL semantics:

- state row and audit append commit in one SQL transaction
- per-instance database transaction lock before mutations/reconciliation
- state row `FOR UPDATE`
- explicit CAS revision check
- post-COMMIT acknowledgement ambiguity reconciled by `stateCommitId`
- uncertain connection removed from the pool
- audit chain ordered by the numeric DB sequence column
- latest missing audit can be repaired exactly once
- tampered/mismatched audit fails closed
- independent backend instances targeting one `instanceKey` serialize without lost updates

## Request idempotency

Every mutating MCP request requires `requestId`.

- same id + different operation/payload -> conflict
- completed -> replay stored result
- failed -> replay failure
- unknown -> never blindly replay
- started -> equivalent request reported in progress unless the current invocation owns the durable ambiguous admission reservation

If handler state may already have committed, request status becomes `unknown` rather than false `failed`. Completion acknowledgement ambiguity returns known success only after durable state proves `completed`.

## MCP compatibility

Official SDK path supports modern and legacy protocol eras. Standalone fallback is intentionally legacy-only; it does not partially clone the 2026 wire.

Hard modern proof:

```bash
npm run mcp:handshake:modern
```

The base gate verifies exact SDK versions, lock entries, npm integrity, and tool count. `VETERAN_MCP_REQUIRE_SDK=1` cannot silently degrade.

## Cross-host installation

- shared runtime: `~/plugins/veteran-engineer`
- durable state: `~/.veteran-engineer/state`
- installer metadata: `~/.veteran-engineer/installer.json`

Install/repair/upgrade synchronizes one shared distribution. Host adapters remain thin. Uninstall cannot purge the runtime while another host still references it.

Distribution refresh preserves an existing `node_modules` tree. This matters for installed runtime capabilities such as official MCP SDK packages and the opt-in PostgreSQL driver.

## Packaging resilience

The bundled Skill must keep `assets/plugin-runtime-starter/` as a recovery seed. Root runtime and starter are now checked byte-for-byte for the mirrored runtime surface by the normal validation gate. Do not merge a runtime/source/test/script/doc change that updates only one side.

`scripts/export_plugin_bundle.py` remains the supported Skill bundle export path; do not manually maintain a second Skill fork.

## Convergence findings already closed

The convergence pass found concrete defects and closed them:

1. An experimental PostgreSQL dependency lock corrupted the existing optional MCP dependency graph. The old SDK integrity gate correctly failed closed; that lockfile was not accepted into main.
2. The first PostgreSQL audit query cast sequence to text and then accidentally ordered by the text alias, producing `1, 10, 2...`. Real concurrency tests exposed the issue. Ordering now uses the numeric database column.
3. Root/runtime-starter synchronization used to be a convention only. It is now enforced by the main validation gate.
4. Hosted state originally had same-process/pool concurrency proof. The convergence gate now also proves two independent backend instances/pools against the same durable identity.
5. README and handoff were one milestone behind implementation. They are now current.

The audit did not find evidence that finalize auto-merges/pushes, that workers own Git commits, that unknown outcomes replay blindly, that standalone fallback pretends to be modern MCP, or that Local JSON stopped being the default.

## Exact next decision

There is no mandatory correctness feature queued behind this checkpoint. Keep the product converged unless new evidence or a concrete product requirement appears.

The next major action should be a deliberate product/release decision, not another automatic feature wave. Candidate decisions:

- keep developing on `0.3.0`; or
- prepare a versioned release candidate and package hosted PostgreSQL capability more formally.

If packaging PostgreSQL into the base dependency graph is chosen, regenerate and verify the lockfile with real npm tooling; do not hand-edit it. Preserve the official MCP dependency integrity proof.

Do not add MCP tools merely for storage. Do not move merge/push/deploy authority into the runtime. Do not replace Local JSON as default without a separate migration/compatibility decision.
