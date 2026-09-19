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

The product/runtime stack through #466, the post-merge authority refresh #468, the clean V16 Skill-brain replay #469, and the Windows Unicode-safe Remote Host service launcher fix #472 are now merged into `main`.

Last behavior-bearing repository checkpoint captured by this handoff:

`behavior checkpoint = 82f2cfd980914362e1a699db8965a4fc801e3744` (`#472`)

The live `main` branch is remote authority and must be refreshed before consequential work. #470 and #471 were documentation-only descendants; #472 is the next behavior-bearing change because it alters Windows Remote Host service launch behavior. The recent behavior-bearing convergence sequence was:

- #456 -> `4295cfcea94ce2ae41847b0523f73f52e1728c8c`
- #457 -> `ab7db508a693a3830f51cf84288f5517fea4b30d`
- #458 -> `0f8f759bdb035fcb15a6bc277670d8cbc7ad1d50`
- #459 -> `2c07d0c0806c94450b141e8d0aa21620718e3eeb`
- #460 -> `0615f020d99df8a557087efae942158514184a82`
- #461 -> `24ec3436c3fe4fcdd8491bfdddec1910f496941a`
- #464 -> `14f989d31bd71e8debe7377b4fcbd4670722713a`
- #465 -> `9f1859e792fd81ba185ac84befe3acbaeb5e02b7`
- #466 -> `628399e41d663fae5931ad7ba7677725a9d5d605`
- #468 -> `eda67060d78f7bf6ef58f5d9e5a036b675350cfe`
- #469 -> `ed3b9a90759f17e348c19a06be15ad85b7d5a4ef`
- #472 -> `82f2cfd980914362e1a699db8965a4fc801e3744`

#456 and #457 were freshly revalidated after retargeting to the evolving `main`; #458 also completed fresh post-retarget validation. For #459 onward, merge proof was selectively reused only after proving that each newly merged `main` tree was byte-identical to the parent PR head tree, the child remained mergeable with the intended current-main diff, and the child's exact head already had green CI, Cross-platform host smoke, Package Plugin Artifacts, and Release dry-run evidence. No release was published.

The resulting mainline includes:

- outcome-clause preservation, evidence-bearing semantic review, and bounded remediation re-entry;
- Veteran Remote Host control plane, Windows supervised service, clean-machine bootstrap, and Secure MCP Tunnel stdio transport;
- live pairing-token invalidation, real Windows service restart lifecycle proof, native Windows Chromium screenshot validation, and a Unicode-safe PowerShell launcher for non-ASCII Windows service paths;
- bounded verified screenshot image delivery through the existing `evidence_query` tool without increasing the 34-tool public surface;
- Remote Host workspace authorization for pre-existing shared-state project/Mission/candidate/evidence/experience identities, plus fail-closed handling of future unclassified unscoped tools;
- the V16 Optimized Skill brain replayed cleanly on the merged desktop runtime authority, including current routing/evidence/frontier/journal/decision machinery, eval fixtures, and specialist references without replacing runtime ownership.

The latest public GitHub Release remains `v0.4.0`; the repository development package remains `0.5.0`. No release/publish action has been authorized or performed.

Post-merge authority refresh #468 and the V16 Skill-brain replay #469 are merged, followed by documentation-only #470 and #471, then behavior-bearing #472 at `82f2cfd980914362e1a699db8965a4fc801e3744`. That #472 merge is the last behavior-bearing checkpoint captured here; exact live `main` is always refreshed from GitHub before consequential action.

## Recent convergence line

The historical #333/#453 checkpoints are no longer the current completion boundary. The product/runtime convergence that was previously represented by the stacked PR line has now landed in `main`.

Merged convergence:

- **#456** — consolidated outcome closure and bounded remediation re-entry.
- **#457** — Veteran Remote Host control plane.
- **#458** — supervised Windows Remote Host service.
- **#459** — clean-machine Remote Host bootstrap.
- **#460** — Secure MCP Tunnel stdio transport.
- **#461** — native Windows Chromium screenshot validation, live token invalidation, and the real Windows supervisor restart repair.
- **#464** — bounded verified MCP image delivery through existing `evidence_query`, exact-id scoped and metadata-contract aware.
- **#465** — shared-state Remote Host workspace authorization, including fail-closed future unclassified tool scope.
- **#468** — post-merge repository/Remote Host authority refresh after the runtime stack landed.
- **#469** — clean V16 Optimized Skill-brain replay on current desktop-runtime main; 133-file Skill/test/workflow write set only.
- **#470** — documentation-only V16 authority cap; merged as `ab992cf9fe9776b7d792a1f7f7a6936659999201` with no runtime, Skill, package, or release-intent mutation.
- **#471** — documentation-only authority-semantics stabilization so handoffs distinguish stable behavior checkpoints from live remote `main`.
- **#472** — Windows Remote Host service launcher changed from `.cmd` to a Veteran-owned UTF-8 PowerShell launcher, with non-ASCII path coverage and real Windows lifecycle proof.

#454 and #455 remain closed staging predecessors superseded by #456. #463 remains closed as the duplicate image-delivery exploration whose stronger exact-id/output-schema ideas were reused in #464. #462 remains closed because its parallel documentation branch was superseded by this final stack-cap documentation line.

With #472 merged and #467 closed as superseded, there is no remaining non-Draft product/runtime/Skill PR from this convergence line. The older `native-*` family (#381, #385, #388, #390, #391, #393, #395, #397-#400, #402-#404, #406) remains parked as Draft. Treat their historical CI as non-current and recompute current-main drift before any replay.

Issue **#338** remains the repository-governance frontier: repository rulesets are still empty and the current GitHub App receives `403 Resource not accessible by integration` for `main` branch-protection inspection. Do not confuse green engineering evidence with enforced merge governance.

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

Current V16 brain integration is release-candidate-validated at merge head `439ad41707ed30e0ccee4fddf19bb4ec65f8a784`: Skill Engineering Tools **108 passed**; Node `npm run check` **683 / 683**; Linux/macOS/Windows host smoke, PostgreSQL, Docker, Chromium, Electron, packaging, and Release dry-run all succeeded; publish remained skipped. The clean replay changed only Skill/test/workflow owners and preserved the desktop runtime authority.

There is no evidence-backed reason to add another subsystem merely to continue development. Continue convergence from concrete defects, drift, or product requirements. Repository governance issue #338 remains a real RC blocker: the ruleset collection is empty and the current GitHub App cannot read/configure `main` branch protection (`403 Resource not accessible by integration`), so that policy must be configured and verified outside the current connector boundary before an RC release.

High-value next audits are:

- continue adversarial restart/recovery checks where persisted Mission/task/lease state can outlive one runtime process, without duplicating existing reconciliation authority;
- revisit multi-Mission contention or capacity/lease policy only when a concrete execution trace contradicts the currently green reservation/reconciliation tests;
- harden real remote-provider/credential onboarding only from observed provider behavior, not guessed cloud-provider abstractions;
- prepare a versioned release candidate only when release scope and delivery authorization are explicit.

Do not add MCP tools merely for storage or convenience. Do not move irreversible delivery authority into the runtime. Do not hand-edit dependency locks when a dependency/package decision is made.
