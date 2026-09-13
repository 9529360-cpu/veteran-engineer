# Plugin Runtime V2

Use this reference when turning this Skill into an executable plugin/app or when modifying the bundled runtime under `assets/plugin-runtime-starter/`.

## V2 contract

Keep the runtime a bounded engineering control plane, not an unrestricted remote shell.

V2 provides:

- durable `Project`, `Mission`, `Task`, `Evidence`, and `Experience` state;
- exact Git source identity capture and refresh;
- dependency-aware task planning;
- predicted write-set conflict detection;
- consequence/risk gates before dispatch;
- durable worker packets;
- optional operator-enabled coding-worker execution;
- isolated Mission and task Git worktrees;
- actual-write-set enforcement after workers run;
- task commit creation and deterministic serial integration into the Mission branch;
- worker and integration evidence capture;
- candidate-only automatic failure learning;
- resumable mission export;
- stdio MCP with one shared tool registry across protocol modes;
- real MCP handshake regression coverage, including an end-to-end `mission_execute(runWorkers=true)` smoke path;
- official TypeScript SDK v2 serving modern `2026-07-28` plus legacy `2025-11-25` eras when the pinned SDK graph is installed;
- an offline dependency-free stdio fallback that intentionally implements legacy `2025-11-25` only.

Use `scripts/export_plugin_bundle.py` to combine the current Skill and runtime into one plugin ZIP. Do not hand-copy the Skill into the runtime because duplicated policy kernels drift.

## Protocol verification boundary

Treat MCP connectivity as executable evidence. Run `npm test` after tool/runtime changes. The protocol tests must launch the child-process MCP server, enumerate the exact tool surface, invoke stateful tools, and close cleanly.

The stdio entrypoint has two honest capability modes:

- **official SDK mode** - use the pinned MCP TypeScript SDK v2 server entry (`serveStdio`) and support both modern `2026-07-28` and legacy `2025-11-25`;
- **standalone fallback** - dependency-free and legacy `2025-11-25` only. It must reject `server/discover` rather than pretending to implement the 2026 wire.

Every health/doctor/handshake report must identify the runtime path, protocol era, and protocol revision that actually answered. A fallback pass proves legacy wire compatibility and control-plane reachability; it never proves the official SDK package graph.

Before claiming modern official-SDK validation, install the exact client/server/core `2.0.0` plus Zod `4.2.0` graph, verify matching `package-lock.json` entries and npm integrity, and run a no-fallback gate:

```bash
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
```

Also test an official client in `auto` mode against the forced standalone fallback. It must negotiate down to legacy safely. If the pinned SDK packages are unavailable, report the modern gates as unavailable/SKIP rather than converting fallback success into a modern PASS.

## Public tools

Keep the public surface intention-level. The current `0.3.0` runtime locks an exact **34-tool** surface grouped around project/mission execution, workers, evidence/validation/review, immutable candidates, experience governance, runtime maintenance, and handoff export. `tests/mcp-handshake.test.mjs` is the exact-surface regression boundary.

Do not expose generic Git, shell, or arbitrary-filesystem tools merely because the runtime executes workers internally. A new public tool must represent an operator intent with bounded authority and evidence, not a thin wrapper around a primitive.

## Worker execution boundary

`mission_execute` has two modes:

- `runWorkers=false` - scheduler/dispatcher only; persist worker packets;
- `runWorkers=true` - only when operator configuration explicitly enables a worker executable, create isolated task worktrees, launch the selected workers, enforce declared write scope, commit accepted patches, and integrate them into the isolated Mission branch.

The MCP caller may request worker execution, but it may not choose or replace the executable. Keep the executable and argument template under operator configuration.

Read `references/worker-execution-runtime.md` before modifying worktree, worker, or integration behavior.

## Git topology

Use:

`user checkout (untouched)`
`-> mission integration branch/worktree`
`-> task branches/worktrees for one wave`
`-> worker changes`
`-> task commits`
`-> serial cherry-pick into mission integration branch`

Dependent waves branch from the updated Mission integration head. Do not auto-merge the Mission branch into the user's branch and do not push it remotely without separate authorization.

## Persistence boundary

The JSON store is a local-host control-plane store with cross-process file locking, atomic replacement, backup recovery, and an audit hash chain. It is suitable for multiple local Veteran processes that share the same filesystem and lock discipline. Before team/hosted deployment, network filesystems with weak lock semantics, or horizontally distributed writers, replace it with a transactional store while preserving the domain state transitions.

Store bounded summaries in state. Keep large logs, patches, traces, screenshots, and other artifacts in file/object storage and retain stable pointers.

## Freshness

A planned mission records `baseSourceIdentity`. Before first dispatch, reject stale plans whose repository HEAD changed.

Within worker execution, bind each wave to a Mission integration head. All task worktrees in that wave start from the same head. Integrate successful commits serially and use the resulting head as the base for dependent waves.

After any external merge/push/rebase, generated-source regeneration, dependency lockfile rewrite, migration, release, or production mutation, refresh the authority relevant to the next action.

## Security

Git worktrees are source isolation, not OS sandboxing. The configured coding worker runs with the plugin host's process permissions. Use a container/VM/sandbox boundary where stronger filesystem/network/secrets isolation is required.

Worker authorization remains narrower than release/production authorization. Never infer permission to push, merge to the user's branch, deploy, publish, mutate production data, rotate credentials, change security policy, or trigger monetary/external effects.

## Experience governance

Runtime failures may create candidate lessons, never automatically active rules. Current repository/runtime truth supersedes stored project memory.

## Next evolution after V2

Prioritize only after the current checkpoint gates are honest:

1. preserve the now-validated pinned official-SDK `2026-07-28` gate, exact dependency graph, lockfile integrity, stateful call, and fallback negative coverage in every exported checkpoint;
2. Mission finalize/rebase/merge proposal with separate explicit authorization and no automatic user-branch mutation;
3. worker sandbox/container adapter for stronger filesystem/network/secrets isolation;
4. review/approval cockpit UI where it materially improves evidence inspection and consequence approvals;
5. transactional hosted state store before distributed/team writers;
6. GitHub/CI/issue-system connectors behind bounded operator intents;
7. throughput/change-failure/rework benchmark telemetry.

Do not add autonomous production mutation before the validation, recovery, approval, and release-authority model is proven.
