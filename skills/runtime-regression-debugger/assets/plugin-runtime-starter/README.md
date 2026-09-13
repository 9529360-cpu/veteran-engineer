# Veteran Engineer

Veteran Engineer is one cross-host engineering plugin: one policy Skill, one durable runtime/control plane, and thin host adapters for Codex, Hermes, generic MCP hosts, and future integrations.

This `0.3.0` tree is a behavioral reconstruction of the last saved development checkpoint after the original exported ZIP was lost. The repository is now the implementation source of truth. The bundled `runtime-regression-debugger` Skill and its architecture references remain the engineering-policy authority; current repository/runtime evidence and executable gates outrank historical claims.

## Current checkpoint

The current mainline preserves an exact **34-tool MCP surface** and the pinned official MCP SDK graph:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

GitHub CI runs two ordered gates on Node 20 after installing the exact optional SDK graph:

1. `npm run check`: **62 tests / 62 PASS / 0 SKIP / 0 FAIL**;
2. a real Docker engine-backed container-worker smoke through the actual `WorkerAdapter` path.

Static validation currently verifies **59 syntax files**, the exact 34-tool surface, modern `2026-07-28` protocol, legacy `2025-11-25` protocol, SDK graph, and lockfile integrity. The Docker gate resolves a test image to a RepoDigest before Veteran sees it and proves worktree access, packet access, rootfs/Git-metadata/network isolation, cancellation cleanup, and timeout cleanup against a real engine.

## Safety and authority

Veteran keeps the user checkout out of the multi-agent mutation surface. Mission and task work happen in isolated Git worktrees. Workers may propose writes, but the runtime validates declared scopes, rejects symlink traversal, owns task commits, and integrates serially into the isolated mission branch.

The runtime never automatically merges the user's branch, pushes, deploys, publishes, rotates credentials, or performs irreversible release actions. A proof-fresh immutable candidate advances into an explicit `finalize` phase that produces a durable merge proposal with `automaticMerge:false`, `automaticPush:false`, and `requiresOperatorAction:true`. Source drift supersedes the proposal and forces candidate refresh plus revalidation/re-review.

Repository/runtime evidence outranks remembered experience. Candidate experience is quarantined until review/activation. Unknown idempotent outcomes require reconciliation and are never replayed blindly. Validation normally runs only operator-defined argv capabilities; arbitrary raw validation additionally requires both operator policy and explicit per-call confirmation.

## MCP protocol modes

Veteran exposes exactly 34 intention-level MCP tools from one shared registry.

| Runtime path | MCP era | Protocol | Opening behavior |
| --- | --- | --- | --- |
| Official TypeScript SDK v2 | modern + legacy | `2026-07-28` + `2025-11-25` | modern `server/discover`; legacy `initialize` |
| Standalone offline fallback | legacy only | `2025-11-25` | `initialize` only |

The standalone fallback intentionally does **not** partially clone the 2026 wire. `server/discover` is rejected there as an unknown method. The official path fails closed on a partial SDK graph, version drift, or broken/missing lockfile integrity.

Hard modern gate:

```bash
npm run mcp:handshake:modern
```

A modern pin never falls back. The suite separately verifies that an official modern client in `auto` mode can negotiate down to the standalone legacy fallback and that `VETERAN_MCP_REQUIRE_SDK=1` never silently degrades.

## State backend contracts and durability

Local durable JSON remains the default state authority. It owns the proven cross-process lock, atomic file replacement, backup recovery, audit hash chain, requestId idempotency, and startup reconciliation of orphaned `started` outcomes to `unknown`.

The runtime consumes two explicit internal backend contracts:

- `veteran-state-backend-v1`: `init`, `read`, `transaction`, `recordTimeline`, `verifyAudit`, plus execution-local artifacts/worktrees paths;
- `veteran-state-transaction-v1`: `readSnapshot()` and `compareAndCommit(expectedRevision, ...)`.

`createVeteranApp` fails closed unless an injected backend satisfies both contracts. Local JSON is the first conforming implementation; no hosted database has been introduced yet.

Snapshot revisions are opaque content tokens. Local JSON checks the expected revision **inside the existing cross-process state lock**, so compare-and-commit admission is atomic with respect to other runtime mutations. A stale revision raises `STATE_REVISION_CONFLICT` before state or audit mutation. Concurrent contenders using the same revision admit exactly one winner.

The former state/audit partial-failure gap is now explicit and recoverable. Every durable state mutation records a unique state-commit identity in state, and its audit entry carries the same identity. If state replacement succeeds but audit append or acknowledgement becomes ambiguous, the operation reports an unknown durable outcome instead of pretending normal success/failure. Startup and the next mutation reconcile the latest state commit against the verified append-only audit chain: a missing entry is repaired exactly once, an already-appended entry is accepted without duplication, and malformed/tampered/mismatched history fails closed.

Request admission also carries an internal attempt identity. An ambiguous `request_started` commit can resume only the invocation that actually owns that reservation. If a handler mutation may already have committed, the request becomes `unknown` rather than being falsely recorded as failed. If only request-completion audit acknowledgement is ambiguous, Veteran returns success only after reconciliation proves the durable request record is already `completed`.

Fault-injection tests exercise both crash windows—after state commit before audit, and after audit append before acknowledgement—while preserving state schema version 3 and backward verification of pre-marker audit entries.

## Worker execution boundaries

A worker packet is durable runtime evidence stored outside the task worktree. Global worker admission is reserved atomically before worker preparation.

The built-in Codex preset uses `codex exec --sandbox workspace-write --ephemeral` and rejects dangerous sandbox/approval bypass flags.

The built-in `container` worker is fail-closed: Docker/Podman only, digest-pinned images, network disabled, read-only rootfs, `cap-drop ALL`, `no-new-privileges`, bounded resources, bounded `noexec,nosuid` `/tmp`, only the isolated task worktree writable, read-only `.git` control file and task packet, allowlist-only environment, and named-container cleanup on cancel/timeout/client exit.

Real-engine validation exposed an ownership boundary that contract-only tests could not prove: a host-created `0600` task packet is unreadable to an unrelated image-default UID. Veteran therefore defaults confined containers to the host process numeric UID:GID when available, preserving private packet mode and avoiding root-owned worktree output. An explicit operator `user` remains authoritative.

Container isolation is defense-in-depth; post-execution HEAD, symlink-containment, write-scope, commit, and integration gates remain mandatory. `custom-unconfined` workers still require explicit operator opt-in and remain blocked for high/critical/broad-write tasks.

## Installation model

The default shared runtime root is `~/plugins/veteran-engineer`. Durable runtime state is separate at `~/.veteran-engineer/state`, and installer ownership metadata lives outside the runtime tree.

```bash
node bin/veteran-engineer.mjs hosts
node bin/veteran-engineer.mjs install generic
node bin/veteran-engineer.mjs install codex
node bin/veteran-engineer.mjs install hermes
node bin/veteran-engineer.mjs status
node bin/veteran-engineer.mjs doctor
```

Codex, Hermes, generic MCP, and trusted external adapters bind the same shared runtime; hosts do not fork the engineering core.

## Development validation

```bash
npm ci --include=optional
npm run check
```

Real Docker worker proof on an engine-capable host:

```bash
VETERAN_CONTAINER_SMOKE_IMAGE='registry/image@sha256:<digest>' npm run test:container-smoke
```

Protocol checks:

```bash
node scripts/mcp-handshake.mjs --mode legacy --force-fallback
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
node scripts/mcp-handshake.mjs --mode auto --require-sdk --force-fallback
```

Fallback results are never counted as modern-protocol proof.

## Version policy

The protocol, Mission finalize/merge-proposal, confined-container-worker, real engine-backed container proof, state-backend contract, transactional compare-and-commit, and state/audit reconciliation milestones are implemented on the `0.3.0` development line. Versioning/release remains a separate product decision.
