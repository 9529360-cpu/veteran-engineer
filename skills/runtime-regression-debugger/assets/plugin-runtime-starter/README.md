# Veteran Engineer

Veteran Engineer is one cross-host engineering plugin: one policy Skill, one durable runtime/control plane, and thin host adapters for Codex, Hermes, generic MCP hosts, and future integrations.

This `0.3.0` tree is a reconstruction of the last saved development checkpoint after the original exported ZIP was lost. The current saved `runtime-regression-debugger` Skill and its architecture references are the policy authority; repository/runtime evidence and tests are the implementation authority. The historical ZIP cannot be byte-for-byte recovered, so this tree must be judged by its current executable evidence rather than by the old `106/106` count.

## Safety and authority

Veteran Engineer keeps the user checkout out of the multi-agent mutation surface. Mission and task work happen in isolated Git worktrees. Workers may propose writes, but the runtime validates declared scopes, rejects symlink traversal, owns task commits, and integrates serially into the isolated mission branch. It never auto-merges the user's branch, pushes, deploys, publishes, rotates credentials, or performs irreversible external release actions.

Repository/runtime evidence outranks remembered experience. Candidate experience is quarantined until review/activation. Unknown idempotent outcomes require reconciliation and are never replayed blindly. Validation normally runs only operator-defined argv capabilities; arbitrary raw validation additionally requires both operator policy and an explicit per-call confirmation.

## MCP protocol modes

Veteran exposes exactly 34 intention-level MCP tools from one shared registry.

| Runtime path | MCP era | Protocol | Opening behavior |
| --- | --- | --- | --- |
| Official TypeScript SDK v2 | modern + legacy | `2026-07-28` + `2025-11-25` | modern `server/discover`; legacy `initialize` |
| Standalone offline fallback | legacy only | `2025-11-25` | `initialize` only |

The standalone fallback intentionally does **not** partially clone the 2026 wire. `server/discover` is rejected there as an unknown method. When the pinned official SDK packages are installed, the hard compatibility gate is:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

The complete graph must match exactly and `package-lock.json` must contain matching root pins, package entries, and npm `sha512` integrity evidence. A partial graph, version drift, or broken lockfile fails closed instead of silently selecting the fallback.

```bash
npm run mcp:handshake:modern
```

That command pins `2026-07-28`; it does not permit legacy fallback. It enumerates the exact 34-tool surface and performs a stateful `project_open`. The test suite also verifies that an official modern client in `auto` mode can safely negotiate down to the standalone legacy fallback, while a modern pin against that fallback fails.

`runtime_health` and `veteran-engineer doctor` report the active transport implementation, eras, protocol versions, exact SDK graph, and lockfile verification state. Doctor only reports the pinned modern gate as PASS after a real official-SDK handshake. `VETERAN_MCP_REQUIRE_SDK=1` fails if the verified official path cannot start and never degrades to standalone fallback.

## Installation model

The default shared runtime root is `~/plugins/veteran-engineer`. Durable runtime state is separate at `~/.veteran-engineer/state`, and installer ownership metadata lives outside the runtime tree.

List available adapters:

```bash
node bin/veteran-engineer.mjs hosts
```

Install for a generic MCP host and emit a portable descriptor:

```bash
node bin/veteran-engineer.mjs install generic
```

Install into Codex:

```bash
node bin/veteran-engineer.mjs install codex
```

The Codex adapter uses the current native plugin model (`.codex-plugin/plugin.json` + `.mcp.json` + bundled Skill) and the personal marketplace. It preserves unrelated marketplace entries.

Install into Hermes:

```bash
node bin/veteran-engineer.mjs install hermes
```

The Hermes adapter registers the same shared MCP runtime through the Hermes CLI and projects the same bundled Skill into the Hermes skill directory. It does not fork the engineering core.

Inspect or repair:

```bash
node bin/veteran-engineer.mjs status
node bin/veteran-engineer.mjs doctor
node bin/veteran-engineer.mjs repair
node bin/veteran-engineer.mjs upgrade
```

Uninstalling one host removes only Veteran-owned host surfaces. `--purge` removes the shared runtime only when no other recorded host still references it.

## Operator configuration

Operator authority lives outside MCP caller input in `~/.veteran-engineer/state/operator.json` by default, or at `VETERAN_ENGINEER_CONFIG` when set. It can define validation capabilities, worker policy/executables, host-agnostic planner/reviewer providers, validation requirements, and semantic-review requirements. Provider outputs are proposals: the Veteran core still validates task DAGs, risk levels, write sets, review bounds, and state transitions.

Reviewed active project experience is routed in bounded form into Planner, Worker, and semantic Reviewer inputs. Candidate, challenged, rejected, and retired experience never influences execution; current repository/runtime evidence always wins. Worker failures may create project-scoped candidate lessons only, never active rules.

A worker packet is durable runtime evidence stored outside the task worktree. Worker environment exposure is intentionally narrow. Global worker admission is reserved atomically under the state lock before worker preparation. Custom unconfined workers require explicit operator opt-in and may not execute high/critical or broad-write tasks.

The built-in Codex worker preset uses `codex exec` with a `workspace-write` sandbox and an ephemeral session. It deliberately refuses sandbox/approval bypass flags; advanced or externally sandboxed execution belongs behind an explicit custom worker contract rather than weakening the preset.

## Development validation

Run the full current suite:

```bash
npm run check
```

Run protocol checks directly:

```bash
node scripts/mcp-handshake.mjs --mode legacy --force-fallback
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
node scripts/mcp-handshake.mjs --mode auto --require-sdk --force-fallback
```

The second and third commands require the official SDK packages. If they are unavailable, that is reported as unavailable rather than treated as a passing modern-protocol proof.

## Version policy

The official pinned 2026-era compatibility milestone is validated in this checkpoint. The runtime/plugin intentionally remains at `0.3.0`; a later version bump is a separate product/release decision, not an automatic side effect of passing the gate.
