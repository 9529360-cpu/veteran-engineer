# Veteran Engineer — Current Checkpoint Handoff

## Authority

The active implementation authority is the GitHub repository:

`9529360-cpu/veteran-engineer`

Judge the product by current repository/runtime evidence, executable gates, and the bundled `runtime-regression-debugger` Skill. Historical ZIPs, remembered checkpoints, and this handoff are not implementation authority when they disagree with current `main`.

Product invariant:

`Skill/policy + shared Mission/MCP runtime -> thin host adapter -> host registration`

Do not fork Mission, MCP, worker, state, evidence, or experience logic per host.

## Current line

- Runtime/package/plugin development version: `0.5.0` (latest public release: `v0.4.0`)
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

Current authoritative source identity is:

`main = ccd2f296d45604a50828c296d7b8fea5063cd9fe`

That commit is merge #453 (`fix(workflow): gate execution progress on readiness`). At this exact source identity:

- GitHub Actions CI run `35120654994` completed successfully.
- `Node 20 / npm run check` passed **651 / 651** Node tests with **0 fail / 0 skipped**.
- the same CI run passed Electron desktop smoke, PostgreSQL state-backend smoke, Docker worker smoke, and Chromium full-stack smoke.
- Package Plugin Artifacts run `35120655016` completed successfully.
- the latest public GitHub Release is `v0.4.0`; the repository development package is `0.5.0`.

The active non-Draft product/runtime line is now #456 -> #461 -> #464 -> #465. #456 was retargeted directly to current `main`, and fresh post-retarget CI, Cross-platform host smoke, Package Plugin Artifacts, Release dry-run, and Skill Engineering Tools runs all succeeded for head `6599e452122fb38017c95ca75eb80c16e649f120`. #457 -> #461 remain stacked above #456. Current #461 head `4bf8406958b8100f6d7a3c2a9cebfa0d52ca4d68` has all four workflows green and includes live token-rotation freshness plus a real hosted-Windows Task Scheduler start/readiness/forced-child-failure/restart/stop proof. #464 is stacked directly on that exact #461 head; current #464 head `02cd4c5ea4cfc60b8cdf8786bc2ccc7b4f9712d9` is fully green and proves bounded opt-in `evidence_query` PNG image delivery through authenticated MCP, requires unique exact evidence ids for image bytes, publishes durable attachment metadata in the output contract, and keeps the public surface at 34 tools. #465 is stacked directly on that exact #464 head; current #465 head `29a34e7fdff28b142af8e5e3671656e450340b5f` is fully green and closes the shared-state workspace authorization gap by resolving stable project/Mission/candidate/evidence/experience identities before Remote Host calls enter the shared app. All proofs remain bound to their exact source/base identities and must be refreshed if ancestry changes.

## Recent convergence line

Current `main` has advanced materially beyond the historical #333 checkpoint. Do not use the old #333 test counts or SHA as a current completion boundary.

The latest settled mainline authority includes the proof/readiness convergence that culminated in:

- **#451** — restore the proof freshness barrier.
- **#453** — gate Mission execution progress on current readiness.
- current `main` HEAD: `ccd2f296d45604a50828c296d7b8fea5063cd9fe`.

The current non-Draft development line is:

- **#456** — consolidated outcome closure: preserve multi-clause intent, require evidence-bearing semantic review for every Mission obligation, and safely re-enter the same Mission for bounded remediation. It now bases directly on current `main`.
- **#457** — add the Veteran Remote Host control plane.
- **#458** — supervise Veteran Remote Host on Windows.
- **#459** — bootstrap Veteran Remote Host on a clean Windows machine.
- **#460** — add Secure MCP Tunnel stdio transport.
- **#461** — validate native Chromium screenshots on Windows; current head also closes live pairing-token invalidation and the real Windows supervisor restart lifecycle defect without adding another state/process authority.
- **#464** — deliver bounded, verified browser screenshot PNGs through the existing `evidence_query` MCP result as opt-in image content; require unique exact evidence ids for byte delivery, publish durable attachment metadata in the canonical output contract, keep the public surface at 34 tools, and preserve EvidenceService as the one artifact-byte authority.
- **#465** — enforce Remote Host workspace scope for stable ids already present in the shared durable state; resolve project ownership before shared-app calls, reject unscoped/global runtime operations under configured workspace roots, and reuse the existing realpath-aware workspace policy instead of adding a parallel ACL subsystem.

#454 and #455 were staging predecessors for the same outcome-closure chain. They are closed as superseded by #456; their implementation remains reachable in #456's history. #457 -> #461 keep their original parent/head chain above #456 because they represent separate product/runtime boundaries. #464 bases directly on the fully validated #461 head and is a separate evidence transport/presentation slice. #463 was a duplicate image-delivery exploration; its stronger exact-id/output-schema ideas were reused in #464, then #463 was closed as superseded. #465 bases directly on the fully validated #464 head and is a distinct security-boundary repair in the existing Remote Host authorizer.

The older `native-*` PR family (#381, #385, #388, #390, #391, #393, #395, #397-#400, #402-#404, #406) remains materially stale against current main at roughly 112-179 commits behind. All 15 are now parked as Draft with explicit replay conditions. Their code/history is retained, but old CI is historical evidence only; reuse requires a current-owner/capability-overlap review and replay onto current main rather than blind merge.

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

Execution readiness is also subordinate to actual task state:

- active `failed`, `cancelled`, or `interrupted` tasks prevent Mission status from projecting a stronger-than-`blocked` execution posture;
- `mission_readiness` exposes `FAILED_TASKS`, `CANCELLED_TASKS`, and `RECONCILIATION_REQUIRED` from task truth;
- `admitted`, `dispatched`, `executing`, and `cancelling` tasks expose `OUTSTANDING_TASKS`, so readiness for the next transition remains false while work is outstanding;
- dispatch-only Mission lifecycle status may remain `ready` while readiness is false: lifecycle state and safe-next-transition state are intentionally distinct.

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

Install/repair/upgrade synchronizes one shared distribution. Host adapters stay thin. Purge is refused while another host still references the runtime. Local refresh preserves installed runtime dependencies/capabilities. The `v0.4.0` release line added verified `upgrade --release latest|vX.Y.Z`; the `0.5.0` development line retains that contract: stable exact-commit GitHub Release metadata + asset/manifest/runtime-file SHA-256 verification, staged atomic swap, target-version host rebinding, downgrade refusal, and fail-closed dependency-graph drift detection.

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

There is no evidence-backed reason to add another subsystem merely to continue development. Continue convergence from concrete defects, drift, or product requirements. Repository governance issue #338 remains a real RC blocker: the ruleset collection is empty and the current GitHub App cannot read/configure `main` branch protection (`403 Resource not accessible by integration`), so that policy must be configured and verified outside the current connector boundary before an RC release.

High-value next audits are:

- continue adversarial restart/recovery checks where persisted Mission/task/lease state can outlive one runtime process, without duplicating existing reconciliation authority;
- revisit multi-Mission contention or capacity/lease policy only when a concrete execution trace contradicts the currently green reservation/reconciliation tests;
- harden real remote-provider/credential onboarding only from observed provider behavior, not guessed cloud-provider abstractions;
- prepare a versioned release candidate only when release scope and delivery authorization are explicit.

Do not add MCP tools merely for storage or convenience. Do not move irreversible delivery authority into the runtime. Do not hand-edit dependency locks when a dependency/package decision is made.
