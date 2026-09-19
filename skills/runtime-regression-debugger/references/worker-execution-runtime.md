# Worker Execution Runtime

Use this reference when the plugin is allowed to execute coding workers rather than only emit work packets.

## Contents

- Contract
- Isolation hierarchy
- Write-scope enforcement
- Parallelism
- Neutral reconciliation for colliding worker changes
- Worker adapter boundary
- Security boundary
- Evidence
- Failure handling

## Contract

Treat worker execution as a repository-local, reversible engineering mutation boundary:

`mission integration base -> isolated task worktree -> worker mutation -> actual-write inspection -> task commit -> serial integration -> evidence`

Do not run multiple coding agents in the user's active checkout. Do not let worker completion imply successful integration.

Keep the worker packet split between **task semantics** and **runtime guardrails**. Task/product/engineering policy arrives through the compiled task contract or an explicitly loaded Skill. The runtime may add write-scope, Git ownership, isolation, stop, authorization, and evidence constraints, but must not maintain a second generic engineering-style policy that can drift from `SKILL.md`.

For packet-protocol compatibility, a legacy policy field may remain as a narrow authority pointer, but it must not carry a second checklist of engineering judgment. Prefer additive migration: old consumers keep a parseable field while new consumers use explicit `policyAuthority`, `executionGuardrails`, and candidate/review contracts. Remove the legacy field only under an explicit protocol-version migration.

## Isolation hierarchy

Use two Git isolation layers:

1. **Mission integration worktree** - one branch/worktree that accumulates accepted task commits for the mission.
2. **Task worktree** - one branch/worktree per dispatched worker, based on the mission head at the start of that wave.

Create task worktrees before launching workers. Creating many worktrees concurrently can race Git's shared administrative locks; parallelize the expensive worker processes, not Git administration.

Keep the user's checked-out branch untouched. A completed mission may still require a separate reviewed merge/rebase/push step.

## Write-scope enforcement

Treat predicted write sets as both a scheduler input and a post-execution guardrail.

After a worker exits:

- collect tracked and untracked changed paths;
- reject any path outside the task's declared write set;
- do not integrate an out-of-scope patch;
- preserve the task worktree/logs for inspection when useful;
- record the violation as execution evidence, not as proof of a product-code root cause.

Require an explicit `.` write scope if a task truly needs repository-wide mutation. Empty write scope means no repository mutation is authorized for automated worker execution.

## Parallelism

For one wave:

- branch all selected task worktrees from the same mission integration head;
- run workers concurrently only when the scheduler predicts no overlapping writes and dependency edges are satisfied;
- collect all worker results before integration;
- integrate successful task commits in deterministic order;
- treat every accepted commit as a freshness barrier for subsequent waves.

Do not make task workers merge each other. The control plane owns convergence.


## Neutral reconciliation for colliding worker changes

When two worker branches collide on the same semantic owner, do not let either worker self-adjudicate merely because it finished first or owns one side of the conflict. For a non-trivial agent-vs-agent conflict, use the mission integration owner or a fresh neutral reconciler that receives both local contracts, both diffs/commits, both completion summaries/evidence, the current integration base, and the active authoritative product/design/API contract.

Classify each conflicted region before editing it:

- **disjoint intent / combine** - both changes can coexist without violating the active contract; integrate both deliberately;
- **same question / decide** - both workers made different choices for the same owned semantic; resolve from current authority and evidence rather than line-count, completion order, or model confidence;
- **superseded / drop** - one branch was built against stale requirements, stale design revision, or an authority that has since been replaced; do not preserve obsolete behavior merely to avoid discarding work;
- **unresolved product conflict / escalate** - same-precedence choices materially change product/security/data/compatibility semantics and current evidence cannot decide safely.

Record the material per-conflict decision so later review can distinguish intentional semantic convergence from an accidental textual merge. Re-run the relevant focused and integration oracles on the reconciled result. A clean Git merge is not evidence that the combined behavior is correct. If collisions repeat on the same central file or owner, change the task partition/integration ownership for the next wave instead of normalizing reconciliation as routine.

## Worker adapter boundary

Keep the executable under operator configuration, not MCP request control. Pass arguments with `shell: false` and a stable packet/prompt/environment contract.

The adapter may wrap Codex CLI, Claude Code, Aider, an internal agent, or another coding worker. The bundled runtime includes a Codex preset that keeps the control plane contract stable while isolating Codex-specific CLI flags in one wrapper. Prefer this adapter boundary when vendor CLI flags change; keep mission/tool contracts vendor-neutral. Never use a vendor's full sandbox/approval bypass merely to make unattended execution convenient unless an external sandbox boundary explicitly justifies it.

Worker execution should be disabled unless the operator explicitly enables it. Do not inherit the plugin process environment wholesale. Prefer keeping credentials outside the worker sandbox entirely: let a trusted control-plane proxy or credential broker perform the authorized Git/MCP/provider action with scoped identity while the worker receives only the capability/result it needs. If no equivalent proxy path exists and the task genuinely requires a credential inside the worker, inject only an explicitly allowlisted, least-privilege, task-scoped credential with bounded lifetime and do not persist it in packets/logs. A normal `mission_execute` can still produce durable worker packets without process execution.

## Security boundary

Git worktrees provide source isolation, not OS sandboxing. A local coding-agent process still has the host user's filesystem, process, credential, and network permissions unless the runtime separately constrains them.

For untrusted repositories or stronger autonomous execution, run each worker inside a container, VM, sandbox, or comparable restricted environment with explicit filesystem/network/secrets policy.

Never infer authorization for push, merge-to-user-branch, deployment, release, credential changes, security policy changes, production data mutation, or real monetary/external effects from worker execution authorization.

## Evidence

Keep the **worker result** separate from **post-run verification**. A useful task result records the task state (`done` / `partial` / `blocked`), completed outcome, changed surface/artifact identity, exclusive proof the worker produced, material gaps/uncertainty, and the one required next action when not complete. Verification receipts, test output, or stop hooks are separate evidence that may support or invalidate the result; they must not overwrite the worker's actual findings or completion report merely because they happened last.

If a worker's prose result is missing, truncated, replaced by a verifier, or otherwise unreliable, reconstruct the task outcome from the actual diff/write set, logs, commit/artifact identity, and independent validation rather than treating a generic `tests passed` message as proof of what was implemented. Prefer structured result fields when the worker adapter supports them, but do not require one vendor-specific envelope.

For every executed task retain enough evidence to reconstruct what happened:

- task ID and dispatch ID;
- wave base source identity;
- worker executable identity/config class when appropriate;
- task branch/worktree;
- worker start/end/exit/timeout;
- log pointer;
- actual changed paths;
- task commit SHA;
- integration commit SHA or conflict state;
- validation evidence when available.

Do not claim integration success from worker exit code alone.

## Failure handling

Classify failures by phase:

- **worker** - process error, timeout, no change, or scope violation;
- **integration** - cherry-pick/semantic convergence conflict;
- **validation** - accepted integration fails a meaningful oracle;
- **freshness** - mission/base assumptions no longer hold.

A failed worker may create a candidate experience item, but the runtime must not turn one execution failure into a durable engineering rule automatically.
