# Veteran Engineer

Veteran Engineer is one cross-host engineering plugin: one policy Skill, one durable runtime/control plane, and thin host adapters for Codex, Hermes, generic MCP hosts, and future integrations.

This `0.3.0` tree is a behavioral reconstruction of the last saved development checkpoint after the original exported ZIP was lost. The repository is now the implementation source of truth. The saved `runtime-regression-debugger` Skill and its architecture references remain the engineering-policy authority; current repository/runtime evidence and executable gates outrank historical claims.

## Current checkpoint

The current mainline preserves an exact **34-tool MCP surface** and the pinned official MCP SDK graph:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

The current GitHub CI gate runs `npm ci --include=optional` followed by `npm run check` on Node 20. After the Mission finalize and confined-container-worker milestones, the suite is **45 tests / 45 PASS / 0 SKIP / 0 FAIL** with the exact SDK graph installed. Static validation also verifies the 34-tool surface, modern `2026-07-28` protocol, legacy `2025-11-25` protocol, SDK graph, and lockfile integrity.

## Safety and authority

Veteran keeps the user checkout out of the multi-agent mutation surface. Mission and task work happen in isolated Git worktrees. Workers may propose writes, but the runtime validates declared scopes, rejects symlink traversal, owns task commits, and integrates serially into the isolated mission branch.

The runtime never automatically merges the user's branch, pushes, deploys, publishes, rotates credentials, or performs irreversible release actions. A proof-fresh immutable candidate advances into an explicit `finalize` phase that produces a durable **merge proposal**. The proposal records the candidate SHA/ref, expected source HEAD/branch, and validation/review proof, but sets `automaticMerge:false`, `automaticPush:false`, and `requiresOperatorAction:true`. Source drift supersedes the proposal and forces candidate refresh plus revalidation/re-review.

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

That command pins `2026-07-28`, enumerates the exact 34-tool surface, and performs a stateful call. A pin never falls back. The suite separately verifies that an official modern client in `auto` mode can negotiate down to the standalone legacy fallback and that `VETERAN_MCP_REQUIRE_SDK=1` never silently degrades.

## Worker execution boundaries

A worker packet is durable runtime evidence stored outside the task worktree. Worker environment exposure is intentionally narrow. Global worker admission is reserved atomically under the state lock before worker preparation.

The built-in Codex preset uses `codex exec --sandbox workspace-write --ephemeral` and rejects dangerous sandbox/approval bypass flags.

Veteran also supports a built-in `container` worker type at the WorkerAdapter boundary. It is deliberately fail-closed:

- engine is restricted to Docker or Podman;
- images must be pinned to an exact `@sha256:<digest>` reference;
- network is disabled;
- root filesystem is read-only;
- all Linux capabilities are dropped and `no-new-privileges` is enabled;
- pids, memory, and CPU are bounded;
- `/tmp` is a bounded `noexec,nosuid` tmpfs;
- only the isolated task worktree is mounted writable;
- the task worktree `.git` control file and the task packet are mounted read-only;
- environment forwarding is allowlist-only and engine-control variables are rejected;
- no arbitrary engine flags or extra mounts are exposed;
- cancel, timeout, and engine-client exit trigger best-effort named-container cleanup.

The existing runtime-owned HEAD, write-scope, symlink-containment, commit, and serial-integration checks remain authoritative after container execution. `custom-unconfined` workers still require explicit operator opt-in and remain blocked for high/critical/broad-write tasks.

## Installation model

The default shared runtime root is `~/plugins/veteran-engineer`. Durable runtime state is separate at `~/.veteran-engineer/state`, and installer ownership metadata lives outside the runtime tree.

List adapters and install a host:

```bash
node bin/veteran-engineer.mjs hosts
node bin/veteran-engineer.mjs install generic
node bin/veteran-engineer.mjs install codex
node bin/veteran-engineer.mjs install hermes
```

Codex, Hermes, and generic MCP all bind the same shared runtime. External adapters load only from explicit trusted directories and must satisfy the adapter API/id/filename contract.

Inspect or repair:

```bash
node bin/veteran-engineer.mjs status
node bin/veteran-engineer.mjs doctor
node bin/veteran-engineer.mjs repair
node bin/veteran-engineer.mjs upgrade
```

Uninstalling one host removes only Veteran-owned host surfaces. `--purge` removes the shared runtime only when no other recorded host still references it.

## Operator configuration

Operator authority lives outside MCP caller input in `~/.veteran-engineer/state/operator.json` by default, or at `VETERAN_ENGINEER_CONFIG` when set. It can define validation capabilities, worker policy/executables, host-neutral planner/reviewer providers, validation requirements, and semantic-review requirements. Provider outputs are proposals: Veteran core still validates task DAGs, risk levels, write sets, review bounds, and state transitions.

Reviewed active project experience can be routed in bounded form into Planner, Worker, and semantic Reviewer inputs. Candidate, challenged, rejected, and retired experience never influences execution; current repository/runtime evidence always wins. Worker failures may create project-scoped candidate lessons only, never active rules.

## Development validation

Run the complete current suite:

```bash
npm ci --include=optional
npm run check
```

Run protocol checks directly:

```bash
node scripts/mcp-handshake.mjs --mode legacy --force-fallback
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
node scripts/mcp-handshake.mjs --mode auto --require-sdk --force-fallback
```

The official-SDK commands are only evidence when the exact pinned packages and lockfile integrity are present. Fallback results are never counted as modern proof.

## Version policy

The protocol, Mission finalize/merge-proposal, and confined-container-worker milestones are implemented on the `0.3.0` development line. The version is intentionally not bumped automatically; versioning/release remains a separate product decision.
