# Worker Execution Runtime

Use this reference when the plugin is allowed to execute coding workers rather than only emit work packets.

## Contract

Treat worker execution as a repository-local, reversible engineering mutation boundary:

`mission integration base -> isolated task worktree -> worker mutation -> actual-write inspection -> task commit -> serial integration -> evidence`

Do not run multiple coding agents in the user's active checkout. Do not let worker completion imply successful integration.

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

## Worker adapter boundary

Keep the executable under operator configuration, not MCP request control. Pass arguments with `shell: false` and a stable packet/prompt/environment contract.

The adapter may wrap Codex CLI, Claude Code, Aider, an internal agent, or another coding worker. The bundled runtime includes a Codex preset that keeps the control plane contract stable while isolating Codex-specific CLI flags in one wrapper. Prefer this adapter boundary when vendor CLI flags change; keep mission/tool contracts vendor-neutral. Never use a vendor's full sandbox/approval bypass merely to make unattended execution convenient unless an external sandbox boundary explicitly justifies it.

Worker execution should be disabled unless the operator explicitly enables it. Do not inherit the plugin process environment wholesale; pass only basic runtime variables and explicitly allowlisted credentials/config needed by the selected worker. A normal `mission_execute` can still produce durable worker packets without process execution.

## Security boundary

Git worktrees provide source isolation, not OS sandboxing. A local coding-agent process still has the host user's filesystem, process, credential, and network permissions unless the runtime separately constrains them.

For untrusted repositories or stronger autonomous execution, run each worker inside a container, VM, sandbox, or comparable restricted environment with explicit filesystem/network/secrets policy.

Never infer authorization for push, merge-to-user-branch, deployment, release, credential changes, security policy changes, production data mutation, or real monetary/external effects from worker execution authorization.

## Evidence

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
