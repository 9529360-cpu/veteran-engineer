# Veteran Engineer — Current Checkpoint Handoff

## Authority

The active implementation authority is the GitHub repository:

`9529360-cpu/veteran-engineer`

Judge the product by current repository/runtime evidence, executable gates, and the bundled `runtime-regression-debugger` Skill. Historical ZIPs, remembered checkpoints, and this handoff are not implementation authority when they disagree with current `main`.

Product invariant:

`Skill/policy + shared Mission/MCP runtime -> thin host adapter -> host registration`

Do not fork Mission, MCP, worker, state, evidence, or experience logic per host.

## Current line

- Runtime/package/plugin version: `0.3.0`
- State schema: `3`
- Public MCP tool surface: exactly **34 tools**
- Official modern protocol: `2026-07-28`
- Legacy protocol: `2025-11-25`
- Standalone fallback is legacy-only; modern pin never falls back
- Local JSON remains the default state authority
- PostgreSQL remains an explicit hosted capability and requires exact `pg@8.23.0` when selected
- Root runtime is the handwritten owner; `skills/runtime-regression-debugger/assets/plugin-runtime-starter/` must remain byte-identical for mirrored runtime paths

Pinned MCP SDK graph remains:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

## Current executable evidence

The validation gate at the #331 checkpoint proves:

- **224 syntax files**
- exact **34-tool** MCP surface
- official SDK graph + lockfile integrity
- protocol constants and fallback boundaries
- runtime/starter mirror parity across **230 mirrored files**
- **418 total / 418 PASS / 0 SKIP / 0 FAIL** Node tests

Mainline CI also proves the current code through:

1. Node 20 `npm ci --include=optional && npm run check`
2. real Docker confined WorkerAdapter smoke
3. real PostgreSQL state-backend contract/durability integration plus modern MCP selection path
4. profile-aware Desktop/Codex/Web plugin artifact export with reproducibility and packaging-boundary checks

The #331 head passed all four boundaries before merge.

## Recent convergence line

The recent mainline sequence materially changed the current runtime and supersedes older handoff assumptions:

- **#322** — adaptive Mission controller v1: project-aware continuity, inferred task risk, execution strategy, and same-project write-conflict coordination without growing the 34-tool surface.
- **#323** — live validation lifecycle hardening: release drains sessions still starting and fences new starts during cleanup.
- **#324** — worker lifecycle hardening: normal success reaps background descendants instead of leaving runtime-owned processes behind.
- **#325** — adaptive Mission controller v2: effective-risk strategy, risk-shaped Mission concurrency, shared execution-capacity authority, and execution-time project snapshot refresh.
- **#326** — explicit Mission risk-envelope authority: explicitly supplied `riskEnvelope: "medium"` is no longer collapsed into the ordinary default baseline.
- **#327** — checkpoint refresh only; no runtime authority change.
- **#328** — planner authority propagation: `veteran-planner-v1` now carries whether the Mission risk envelope was defaulted or explicit, so external planning sees the same intent as the runtime strategy compiler.
- **#329** — provider evidence secrecy: explicitly allowlisted planner/reviewer environment values are redacted before structured provider output, findings/tasks, errors, or evidence artifacts become durable; malformed semantic-review stdout is not persisted raw.
- **#330** — interruption reconciliation authority: repeated resume and partial retry can no longer erase unresolved interrupted-task blockers; readiness fails closed on actual interrupted task state and final successful reconciliation clears the blocker.
- **#331** — provider operator-config validation: executable planner/reviewer provider fields fail fast at the operator-policy boundary while inert provider objects and unknown future fields remain backward compatible.

At the time this handoff was refreshed, `main` includes #331 at merge commit:

`5f8beb1fdf881d2e3f7ecba6a52c17794fb1b7ea`

Always refresh `main` before relying on this SHA or the counts above.

## Adaptive Mission authority

The adaptive controller is internal runtime policy, not a new public MCP surface.

Planning now:

- refreshes project/source/environment truth before deriving a Mission;
- preserves explicit task risk as authority and infers risk only when task risk is omitted;
- distinguishes an omitted default `medium` Mission envelope from an explicitly supplied `medium` envelope;
- propagates that default-vs-explicit distinction to configured planner providers as well as the runtime strategy compiler;
- records bounded same-project continuity for planner/runtime decisions;
- compiles `veteran-adaptive-mission-v1` execution strategy with task class, effective risk, validation posture, runtime-feedback posture, and bounded concurrency;
- exposes strategy and continuity through Mission readiness/capability snapshots.

Execution uses the same strategy authority rather than treating it as descriptive metadata:

- consequential work is serialized to one Mission worker;
- heavy work is bounded to at most two Mission workers;
- lighter work may use safe structural parallelism up to project worker policy;
- global active-worker capacity and Mission-local strategy capacity are combined by one capacity calculation;
- same-project active write overlap fails closed before dispatch;
- current project snapshot/readiness is refreshed again at execution preflight.

Explicit `riskEnvelope: "medium"` remains operator intent. For a single otherwise-low task it raises effective Mission risk to `medium`, producing a `moderate` / cross-boundary validation posture instead of the ordinary default `light` / focused posture.

## Interruption and recovery authority

Interrupted work is unresolved execution truth until each affected task is reconciled.

- repeated `mission_resume` preserves already-interrupted tasks and the original interruption detection boundary;
- `mission_readiness` derives `RECONCILIATION_REQUIRED` from actual interrupted task state even if Mission metadata is stale or incomplete;
- retrying one interrupted task removes only that task from the unresolved set; interrupted siblings keep the Mission blocked;
- an external-ready interrupted result may follow the existing explicit commit/integration path when source/write-scope checks prove it safe;
- the final successful reconciliation clears Mission interruption authority; partial runtime-managed writes with an unknown completion boundary still require explicit reconciliation/retry.

Do not clear Mission-level interruption merely because one task was retried or one resume pass found no newly executing task.

## Provider execution and evidence boundary

Planner and semantic-review providers remain operator-configured subprocesses, not independent authorities.

Known executable provider fields are validated at operator-config load/policy resolution:

- `command`: non-empty string when execution fields are configured
- `args`: array of strings when present
- `envAllowlist`: array of non-empty strings when present
- `timeoutMs`: positive integer when present

Historical inert provider objects remain compatible, and unknown future fields are preserved rather than forcing a closed provider schema.

Allowlisted environment values are treated as potentially sensitive. Planner/reviewer structured output and stderr are sanitized before they can enter task/review state, returned findings, error details, or durable evidence. This complements the existing credential-redaction boundaries used by other provider surfaces.

## Mission lifecycle and finalize

Mission lifecycle remains:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize never merges, pushes, releases, or deploys. A proof-fresh candidate produces a durable merge proposal with:

- `automaticMerge:false`
- `automaticPush:false`
- `requiresOperatorAction:true`

Source or Mission drift invalidates stale proof/proposals and requires refresh plus the appropriate proof gates again.

## Worker and runtime boundary

The runtime owns task worktrees, HEAD authority, actual-write verification, task commits, deterministic integration, process lifecycle, capability leases, and cleanup.

Codex preset remains:

`codex exec --sandbox workspace-write --ephemeral`

Confined container execution remains Docker/Podman only with digest-pinned images, network disabled, read-only rootfs, dropped capabilities, `no-new-privileges`, bounded resources, isolated writable task worktree, allowlist-only environment forwarding, and cleanup on cancel/timeout/runtime exit.

`custom-unconfined` remains explicitly gated and blocked for high/critical/broad-write work.

Process-lifecycle regressions are covered: cancellation/timeout drain descendants, normal success reaps background descendants, and persistent live-session release handles start/release races conservatively.

## Capability and feedback plane

Capability sensing and execution authority stay separate. Operator declarations cannot spoof structural worker-isolation proof. Runtime-resource leases and coordination keys participate in wave safety and cross-Mission conflict detection.

Persistent live/browser feedback is bounded and source-aware. Runtime feedback may inform later waves or bounded repair, but cannot silently widen task ownership or invent project-level write scope.

## Durable state architecture

Three state contracts remain authoritative:

- `veteran-state-backend-v1`
- `veteran-state-transaction-v1`
- `veteran-state-durability-v1`

Local JSON keeps cross-process locking, atomic replacement, backup recovery, audit hash chain, request idempotency, commit/audit repair, and conservative orphaned-request reconciliation.

PostgreSQL is opt-in and preserves the same semantic contracts using SQL transactions, per-instance locking, compare-and-commit revisions, ordered audit sequence, `stateCommitId` reconciliation, and fail-closed tamper/mismatch handling. Independent backend instances targeting one durable identity are tested for serialization without lost updates.

Unknown durable outcomes are never blindly replayed.

## Remote repository and source authority

`project_open` accepts exactly one of `repoPath` or `repoUrl`.

Remote onboarding uses a runtime-managed checkout and is conservative about source identity:

- no embedded HTTPS credentials/query/fragment;
- no recursive submodule acquisition;
- same-remote acquisition is serialized;
- refresh is fetch + fast-forward only;
- dirty, detached, or locally diverged managed checkouts fail closed;
- credential-bearing local origins are sanitized before durable storage;
- workers still mutate only isolated Mission/task worktrees.

## Cross-surface and packaging authority

`veteran-surface-capabilities-v1` keeps Web/Desktop/Codex differences at the topology/capability edge instead of forking engineering core logic.

Plugin export is profile-aware:

- Desktop/Codex retain local runtime and `.mcp.json` surfaces;
- Web excludes local MCP/runtime surfaces and can reference caller-supplied app configuration;
- exporter reproducibility and symlink/package-boundary refusal are CI-proven.

Host/tunnel/app provisioning remains external platform configuration unless a stable machine-consumable contract exists.

## Cross-host installation

- shared runtime: `~/plugins/veteran-engineer`
- durable state: `~/.veteran-engineer/state`
- installer metadata: `~/.veteran-engineer/installer.json`

Install/repair/upgrade synchronizes one shared distribution. Host adapters stay thin. Purge is refused while another host still references the runtime. Distribution refresh preserves installed runtime dependencies/capabilities.

## Convergence rules for the next pass

1. Refresh `main`, open PR/issue state, and CI truth before editing.
2. Prefer owner fixes over new abstractions or duplicate control planes.
3. Treat root runtime as source owner and keep the bundled starter mirror synchronized.
4. Preserve the exact 34-tool public MCP surface unless a real product requirement proves a new tool is necessary.
5. Keep Local JSON as default and PostgreSQL explicit unless a separate migration decision changes that contract.
6. Keep merge/push/release/deploy authority outside Mission finalize.
7. Use real engine/product validation at the strongest practical boundary before claiming closure.
8. Update this handoff when executable counts, core lifecycle authority, or the active convergence line materially changes.

## Next product work

There is no evidence-backed reason to add another subsystem merely to continue development. Continue convergence from concrete defects, drift, or product requirements.

High-value next audits are:

- verify Mission status cannot report a stronger readiness posture than authoritative task/blocker state across mixed failed/interrupted/cancelled combinations;
- continue adversarial lifecycle checks around capacity/lease release, restart reconciliation, and multi-Mission contention without duplicating the existing scheduler authority;
- harden real remote-provider/credential onboarding only from observed provider behavior, not guessed cloud-provider abstractions;
- prepare a versioned release candidate only when release scope and delivery authorization are explicit.

Do not add MCP tools merely for storage or convenience. Do not move irreversible delivery authority into the runtime. Do not hand-edit dependency locks when a dependency/package decision is made.
