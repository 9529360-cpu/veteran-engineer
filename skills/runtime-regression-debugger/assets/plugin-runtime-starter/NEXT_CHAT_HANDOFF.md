# Veteran Engineer — MCP 2026 Protocol-Compatible Checkpoint Handoff

## Recovery provenance

The historical `0.3.0` final ZIP from the deleted chat is lost and cannot be byte-for-byte recovered. Development resumed from the user-supplied `veteran-engineer-0.3.0-rebuilt.zip`, which had been reconstructed from:

1. the saved `runtime-regression-debugger` Skill and its architecture references;
2. the user's `Veteran Engineer — Next Chat Handoff` contract from the lost checkpoint;
3. fresh executable regression evidence produced during the reconstruction.

Do not claim this tree is byte-identical to the historical ZIP or compare the current test count directly with the historical `106/106`. Judge it by the current contracts and evidence below.

## Product invariant

Veteran Engineer remains one cross-host plugin product:

`Skill/policy + shared Mission/MCP runtime -> thin host adapter -> host registration`

Do not fork the engineering core for Codex, Hermes, generic MCP, or future hosts.

## Current version

- Runtime/package/plugin manifest: `0.3.0`
- Version intentionally not bumped yet.
- Exact MCP tool surface: **34** tools, asserted by `src/tool-catalog.mjs` and MCP tests.

## Fresh validation evidence

From the current protocol-compatible source tree:

- `npm run check`: **PASS**
- Syntax/manifest/static gate: **PASS**
- Full Node test suite with exact SDK graph installed: **42 total / 42 PASS / 0 SKIP / 0 FAIL**
- Exact dependency graph and npm lockfile integrity: **VERIFIED**
- Cross-process state lock stress after the Windows handle-sharing correction: **10/10 PASS**
- Candidate plugin ZIP fresh-unpack -> `npm ci --include=optional` -> `npm run check`: **42/42 PASS**
- Fresh-unpacked standalone Skill validator: **PASS**
- Plugin ZIP and `skill.zip` full-entry integrity read: **PASS**
- MCP fallback:
  - real legacy `initialize`: PASS
  - exact 34-tool `tools/list`: PASS
  - `server/discover` rejected with `-32601`: PASS
  - MCP `project_open -> mission_plan -> mission_execute(runWorkers=true) -> mission_status`: PASS
- MCP official SDK:
  - pinned `2026-07-28` stdio handshake: PASS
  - exact 34-tool `tools/list`: PASS
  - stateful `project_open`: PASS
  - official modern client `auto` -> forced standalone legacy fallback: PASS
  - modern pin -> forced standalone fallback: expected failure PASS
  - `VETERAN_MCP_REQUIRE_SDK=1` -> no fallback: PASS
- Installer/CLI regression coverage: PASS
- Cross-process state lock stress was also repeated for ten high-concurrency rounds after fixing a young-lock parse race: **10/10 PASS**.

The protocol milestone is now genuinely closed in an environment with npm access. No fallback result was used as modern evidence.

## MCP protocol contract

The runtime has two honest stdio modes:

### Official SDK mode

Pinned package intent:

- `@modelcontextprotocol/client`: `2.0.0`
- `@modelcontextprotocol/server`: `2.0.0`
- `@modelcontextprotocol/core`: `2.0.0`
- `zod`: `4.2.0`

The runtime verifies all four installed versions plus root pins, lockfile package entries, and npm `sha512` integrity. Partial installs, version drift, and missing/corrupt lock evidence fail closed.

When installed, the server path uses SDK v2 `serveStdio(factory)` and reports:

- transport: `stdio`
- implementation: `official-sdk`
- eras: `modern`, `legacy`
- protocols: `2026-07-28`, `2025-11-25`

Hard gate:

```bash
npm run mcp:handshake:modern
```

This pins `2026-07-28` and requires both client and server SDK packages at exactly `2.0.0`. A pin never falls back.

### Standalone fallback

Dependency-free fallback remains deliberately legacy-only:

- era: `legacy`
- protocol: `2025-11-25`
- opening: `initialize`
- `server/discover`: method not found

Do not partially clone the modern wire in fallback mode.

## Reconstructed capabilities

Current executable runtime includes:

- durable project/mission/task/evidence/experience state;
- cross-process JSON locking, atomic replace, backup recovery, audit hash chain;
- persistent requestId idempotency with `started/completed/failed/unknown` and no blind replay of unknown outcomes;
- dirty-source planning/first-dispatch/candidate guards;
- mission DAG validation, dependency waves, write-set conflict scheduling;
- atomic global worker admission reservation across runtime processes;
- isolated mission/task Git worktrees, hooks disabled for runtime Git, runtime-owned commits and deterministic serial integration;
- write-scope enforcement plus symlink-escape rejection even for broad `.` scope;
- dispatch-only packets outside task worktrees, cancellation/resume/retry and conservative interruption reconciliation;
- custom worker contract plus safe built-in Codex preset using `codex exec --sandbox workspace-write --ephemeral`, with dangerous bypass flags rejected;
- repository-native validation from operator-defined argv capabilities, with raw validation requiring operator policy plus per-call confirmation;
- deterministic whole-change review, independent semantic reviewer provider, bounded remediation planning;
- host-agnostic planner provider whose proposals are revalidated by Veteran core;
- reviewed **active** experience routing into Planner/Worker/semantic Reviewer; candidate/challenged/rejected/retired experience is quarantined;
- worker failures create project-scoped **candidate-only** failed-attempt experience;
- experience conflict isolation, freshness audit, exact candidate compaction and usage telemetry;
- mission state machine through execution -> validation -> deterministic review -> semantic review -> immutable candidate;
- read-only merge-tree preflight and source-drift candidate refresh with revalidation/re-review;
- runtime health/integrity/cleanup/maintenance and mission readiness/timeline/handoff;
- cross-host installer with shared runtime, installer state outside runtime, Codex/Hermes/generic adapters, repair/upgrade/uninstall/purge semantics, external trusted adapter API v1;
- installer refresh preserves an existing `node_modules` tree so official SDK capability does not silently disappear on repair/upgrade.
- Codex/Hermes adapter command execution now uses the installer's injectable execution boundary; cross-platform tests cannot accidentally invoke real host CLIs from the machine PATH.
- Windows state locks close the creation handle after durable lock-token write, preserving file/token ownership while avoiding cross-process read denial.

## Authority invariants

1. One plugin product; hosts are adapters, not product forks.
2. Current repository/runtime evidence outranks project experience.
3. Candidate/challenged experience never influences execution.
4. Planner/worker/reviewer agents propose; Veteran core validates and owns state authority.
5. Runtime never auto-merges the user's branch, pushes, deploys, publishes, rotates credentials, or performs irreversible release actions.
6. User checkout is never the multi-agent mutation surface.
7. Unknown idempotent outcomes require reconciliation, never blind replay.
8. Unconfined custom workers require explicit opt-in and cannot run high/critical/broad-write tasks.
9. AI validation defaults to operator-defined capabilities, not arbitrary shell.
10. Modern MCP support must be proven by a real pinned SDK handshake, not a protocol-version string.

## Cross-host state

- Shared runtime default: `~/plugins/veteran-engineer`
- Durable state default: `~/.veteran-engineer/state`
- Installer metadata: `~/.veteran-engineer/installer.json`
- Codex adapter uses native plugin ingestion (`.codex-plugin/plugin.json`, `.mcp.json`, bundled Skill) and a personal local marketplace entry.
- Hermes adapter uses its MCP CLI and projects the same bundled Skill into the Hermes skills directory.
- Generic adapter emits a portable MCP descriptor.
- External adapters load only from explicit trusted directories and must pass API/id/filename validation.

## Packaging resilience

The standalone updated Skill must contain `assets/plugin-runtime-starter/` again. That asset is the rebuild seed. `scripts/export_plugin_bundle.py` exports one plugin ZIP from the Skill while avoiding recursive duplication of the runtime asset inside the bundled Skill copy.

For future recovery, prefer:

1. standalone `skill.zip` as policy + runtime-starter authority;
2. exported plugin ZIP as installable runtime artifact;
3. this handoff for checkpoint evidence and known blockers.

## Exact next target

Keep `0.3.0` until a separate version/release decision is made. Preserve the completed protocol gates in every future export.

The next architectural candidates are explicit Mission finalize/merge proposal (never auto-merge), stronger worker sandbox/container adapters, hosted transactional state, and bounded external connectors.
