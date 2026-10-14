# Veteran Engineering Studio

Veteran Engineering Studio is one cross-host engineering plugin with two cooperating Skills, one shared Mission/MCP runtime, one durable control plane, and thin host adapters for Codex, Hermes, generic MCP hosts, and future integrations.

- `runtime-regression-debugger` is the Veteran Full-Stack Engineer control plane for repository takeover, architecture, backend/data, debugging, migrations, release, operations, and cross-host engineering execution. It now includes a routed Python Agent engineering profile for explicit state lifecycles, strict tool schemas, bounded execution loops, resilient external calls, and Agent-specific boundary validation.
- `frontend-design-builder` is the specialist UI/frontend design and implementation layer for visual direction, design-system reuse, design-to-code, responsive behavior, motion, accessibility, and rendered visual QA.

The Full-Stack Engineer keeps end-to-end ownership. Material UI/UX work routes into Frontend Design Builder, and broader backend/data/infrastructure/release concerns route back to the Full-Stack Engineer.

The GitHub repository `9529360-cpu/veteran-engineer` is the implementation source of truth. Current repository/runtime evidence and executable gates outrank old exported artifacts, historical claims, or remembered checkpoints.

## Optional MCP workflow learning (opt-in)

The Veteran MCP runtime can record its own real tool outcomes into a task journal
without capturing prompts or raw tool output. It recognizes returned repository
snapshots, accepted task commits, validation results and deterministic reviews.
Capture is **off by default**. Initialize a task journal and set
`VETERAN_WORKFLOW_OBSERVER=1`, `VETERAN_WORKFLOW_JOURNAL` (absolute file),
and `VETERAN_WORKFLOW_OBSERVER_IMPORTER` (absolute path to the matching Skill's
`scripts/workflow_observer.py`) on the running MCP process. An available Python
interpreter is required; optionally set `VETERAN_WORKFLOW_OBSERVER_PYTHON`.

Both SDK and fallback MCP transports use the same post-result producer. Events
are sent through JSONL stdin to the existing journal importer; failed capture
cannot turn a tool success into failure. Journals are task-scoped; do not share
one journal between active producers without serialization. Completed journals
may be analyzed with `experience_compactor.py --include-workflows` to propose
review-required, project-scoped workflow candidates after independent repetition.
The feature does **not** observe other ChatGPT tools, install background hooks,
or automatically edit Skills. See
`skills/runtime-regression-debugger/references/engineering-experience-governance.md`.
## Visual Design Authority

Substantial new UI, major redesigns, and explicit visual-quality recovery work now pass a blocking design gate before deep implementation. Frontend Design Builder must inspect the current product and system, materialize a real visual direction when capable tools exist, compete meaningfully different directions when the target is unresolved, reject generic AI-template patterns, lock one visual target/design contract, and only then proceed into deep frontend code.

The gate is intentionally not a numeric beauty score. It rejects process and evidence failures that repeatedly produce weak AI UI: code-first design, card soup, meaningless badges/gradients, generic dashboard shells, weak hierarchy/typography, text-only concepts despite available visual tools, and handoff without direct rendered comparison.

## Design Action Fabric

Frontend Design Builder now uses a provider-neutral Design Action Fabric instead of hard-wiring design execution to one vendor. The current Figma provider can supply structured design context, screenshots, variables, libraries, Code Connect, motion, canvas writes, live URL capture, asset import/export, FigJam diagrams, Slides, shaders, and generative tools when those host capabilities are actually connected.

The routing contract is capability-first: the Skill inventories what the current host can really do, loads only the workflow required for the active design phase, executes through the strongest provider, and degrades to repository/browser/image/code-native evidence when a design provider is unavailable. Figma remains the richest current provider, but it is not the permanent architecture of Veteran.

## Veteran Machine Bridge

Veteran Remote Host includes an opt-in cross-device Machine Action Fabric for web-first engineering. It exposes only two intention-level MCP tools: `machine_inspect` for read-only device/repository/files/process evidence and `machine_act` for request-id protected filesystem/process actions. Operators must explicitly enable the bridge and configure workspace roots plus executable policy; it is an application-level policy boundary, not an OS sandbox.

The bridge is designed for ChatGPT Web and other remote MCP-capable hosts that need local checkout state, terminal execution, persistent process sessions, local services, or desktop/runtime evidence without depending on a third-party desktop-control provider. `repo.status` binds the local Git root, HEAD, branch, upstream relation, and dirty-state counts before mutation; `repo.commands` derives script-name-only startup/validation invocations from repository metadata, current changed paths, package-manager authority, the Machine Bridge executable allowlist, and read-only PATH presence; `fs.digest` plus `expectedSha256` / `requireAbsent` provide optimistic file preconditions; `fs.replace` performs exact-count local text replacement against a required fresh digest instead of forcing whole-file overwrite; `repo.diff` returns a bounded no-ext-diff/no-textconv patch for post-edit review; `expectedRepoHead` rejects a mutation or process launch after checkout HEAD drift; and every successful `machine_act` returns an evidence-bound action receipt linked to its request id so duplicate request replay and postcondition checks can retain the exact machine action identity. One-shot process results close stdin, retain bounded stdout/stderr text for chat use, and separately report full raw-stream byte counts plus SHA-256 identities; persistent sessions expose the same full-stream identities after terminal exit, so truncated display text does not weaken execution evidence. Remote Host teardown also waits for managed persistent sessions to reach a verified terminal process state, escalating to a forced tree stop only when necessary instead of treating signal issuance as proof of cleanup.

The intended local engineering loop is `repo.status + repo.commands -> guarded edit -> shell-free process.start(minimal validation, expectedRepoHead) -> repo.diff -> repo.status`. Command discovery never executes package scripts or persists their bodies, and allowlisting alone is not treated as proof that an executable actually exists. On Windows, npm/pnpm/yarn `.cmd` shims are reported as unavailable for direct shell-free execution instead of silently enabling a shell; the bridge degrades honestly rather than weakening its executable boundary.

## Project command and validation plan

Project onboarding now derives a bounded command plan from repository-owned metadata instead of guessing shell commands. For Node projects, Veteran combines the selected package-manager authority, host readiness, and safe `package.json` script names into argument-vector invocations such as `npm run check` without persisting the script body itself. Unsafe script names are never converted into executable invocations.

`project_open` and `project_snapshot` also derive a minimal validation recommendation from the current dirty paths. Documentation-only changes remain command-free; source/test changes prefer repository-declared aggregate, typecheck, unit-test, lint, or build scripts in a bounded order; end-to-end scripts remain broader evidence rather than an automatic minimum. If `package.json` or a Node lockfile is itself dirty, the plan fails closed and requires fresh command-authority evidence. The plan is advisory and never auto-executes repository code.

## Studio contract and versioning

This repository has two intentionally separate version domains:

- `plugin.json` versions the portable/workspace **Veteran Engineering Studio** plugin.
- `package.json` plus `.codex-plugin/plugin.json` version the **Veteran runtime/MCP** compatibility surface and must stay aligned with each other.

Do not force these numbers to match unless the same change actually releases both domains. The Studio plugin may evolve its Skills and packaging without pretending the runtime protocol changed; runtime releases may evolve independently while preserving the Studio composition contract.

The Studio keeps one accountable delivery path. `runtime-regression-debugger` owns whole-product/repository engineering and integration. `frontend-design-builder` owns material UI/frontend design and implementation phases, then returns implementation evidence, intentional deviations, and unresolved UI gaps to the full-stack owner. CI validates this composition and both Skill packages together.

Skill discovery is metadata-driven. Neither Studio Skill declares a custom product-level invocation policy. `runtime-regression-debugger` remains the primary whole-product owner through its trigger description and collaboration contract, while `frontend-design-builder` is the bounded UI/frontend specialist. This avoids unsupported invocation metadata and keeps routing explicit without creating a second authority.

## Design intelligence stack

The frontend specialist uses a source-aware design workflow rather than treating every reference as equivalent:

- **Figma + Code Connect** for structured design intent, variables, component properties, libraries, and mapping to production components.
- **Storybook / component labs** for implemented APIs, state coverage, interaction checks, accessibility checks, and visual regression when the repository already has those systems.
- **Mobbin-style reference research** for mature screens, flows, and web sections; these sources are inspiration until explicitly promoted to a target.
- **Live product + browser renders** for current behavior and final implementation evidence.
- **Screenshots/mockups/exports** for accepted visual targets when structured design data is unavailable.
- **Image-generated concepts** for new visual directions before a target is selected.
- **Product-design cycle** for evidence-first audit, targeted research, distinct concept exploration, implementation, and blocking visual QA when the work is broader than direct coding.
- **Cross-tool design-system sync** for reconciling Figma variables/components, code tokens/APIs, Storybook states, Code Connect mappings, and the rendered product without creating parallel authorities.
- **Figma capability routing** for design-to-code, code-to-design, component libraries, Code Connect, motion, SwiftUI, FigJam diagrams, and specialized effects/automation only when those modes are actually requested.
- **Live URL reconstruction** for authorized evidence-first desktop/mobile capture, interaction/asset inventory, code-native recreation, and same-state visual comparison; redesign requests stay separate from clone mode.

The design-source authority model prevents accidental mixing of "what exists", "what should exist", and "what merely inspired the direction".

## Current checkpoint

Current development version is `0.5.0`; the latest public release is `v0.4.0`. State schema remains `3`. The public MCP surface remains exactly **36 tools**.

Protocol support is intentionally split:

- official TypeScript SDK path: modern `2026-07-28` and legacy `2025-11-25`;
- standalone fallback: legacy `2025-11-25` only;
- a modern pin never silently falls back;
- `VETERAN_MCP_REQUIRE_SDK=1` fails closed when the pinned official SDK graph is unavailable or invalid.

The pinned base dependency graph is:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

Current integration gates prove:

1. `npm run check`: exact **36-tool** surface, protocol constants, pinned SDK lock integrity, syntax, runtime-starter mirror parity, and the full Node regression suite;
2. a real Docker engine-backed confined `WorkerAdapter` smoke;
3. a real PostgreSQL engine-backed state-backend contract/durability integration gate, followed by the real modern MCP handshake while PostgreSQL is the active state backend;
4. profile-aware Desktop/Codex/Web plugin artifact export with reproducibility and package-boundary checks;
5. release-candidate reproducibility for the canonical runtime asset plus public release checksum verification before and after publication.

The bundled recovery seed under `skills/runtime-regression-debugger/assets/plugin-runtime-starter/` is part of the product contract. The main validation gate now compares the mirrored runtime file set and file contents against the repository runtime so root/starter drift fails CI instead of becoming a future recovery surprise.

## Remote repository onboarding

`project_open` now accepts exactly one source: an existing local `repoPath` or an authorized `repoUrl`. A remote URL is cloned into the runtime-managed project area under the execution-local state root, so an operator can hand Veteran a repository address without manually preparing a checkout first. The public MCP surface remains 36 tools; this extends the existing project intent instead of adding a raw Git primitive.

Remote acquisition is deliberately conservative:

- credential-free HTTPS, SSH, SSH scp-style, and local `file://` Git URLs are accepted; embedded HTTPS credentials, query strings, fragments, and unsupported remote-helper protocols are rejected;
- private repositories must authenticate through the operator's normal Git credential helper or SSH agent, so secrets are not placed in tool arguments or durable project state;
- clone runs with hooks disabled and does not recurse into submodules automatically;
- the managed checkout path is deterministic for the normalized remote and concurrent opens serialize through a local acquisition lock;
- a reused managed checkout fetches origin and advances only by fast-forward; dirty, detached, or locally diverged source checkouts fail closed instead of being reset;
- `refreshRemote=false` is an explicit opt-out for intentional offline/stale reuse;
- local repositories with credential-bearing origin URLs are stored only with a sanitized remote URL.

The managed source checkout is still outside the worker mutation surface. Mission and task changes continue to occur only in runtime-owned worktrees.

## Mission and authority model

The runtime keeps the user checkout outside the multi-agent mutation surface. Mission and task work occurs in isolated Git worktrees. Workers may propose writes, but the runtime owns task identity, packet identity, HEAD authority, actual-write verification, task commits, deterministic serial integration, proof binding, and final candidate identity.

The mission lifecycle is:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize does not merge or push. A proof-fresh candidate produces a durable merge proposal containing candidate/source/proof identity with:

- `automaticMerge:false`
- `automaticPush:false`
- `requiresOperatorAction:true`

Source or mission drift supersedes the proposal and forces candidate refresh plus revalidation/re-review. Stable retries reuse the same proposal; missing finalize evidence after a partial failure is repaired rather than inventing a new authority.

## Adaptive first-class Agent team (runtime capacity, not a fixed roster)

Veteran's primary full-stack Agent remains the **single Mission owner**.
Small tasks should stay with that owner; a broader Mission may use the existing
independent worker processes and task worktrees as subordinate first-class
Agent members. The primary retains planning, task-graph, integration, review,
quality and final-acceptance authority. A child is limited to its declared
task/writeSet and must return evidence rather than changing Mission authority.

On the **actual machine/server running the MCP runtime**, the admission
scheduler checks `os.availableParallelism()`, Linux cgroup CPU quota, free
memory and cgroup memory availability. It estimates how many workers fit
with per-worker memory and system reserve, and rechecks at every admission.
Configured `workerPolicy.maxWorkers` is an **optional positive integer ceiling**
or `null` for resource-based auto mode (now the default). There is **no fixed
default 2/4-worker cap**. Worktree independence, task DAG width, current
workers, exclusive resources and elevated-risk caps still take priority.

Set `workerPolicy.memoryMiBPerWorker` to the safe per-worker estimate for your
execution provider (default 512 MiB, minimum 64 MiB). The memory estimate is
conservative but cannot measure provider/account concurrency or predict
model token usage. A computer with forty available CPU slots and sufficient
memory may admit twenty independent task agents; a smaller or busy host
admits fewer. An explicit operator ceiling always wins.

**Actual subagents still require** authorized `workerPolicy.enabled: true`
and configured installed/authenticated workers, such as the `codex` preset
or a bounded container worker. The Skill alone does not spawn independent
ChatGPT model sessions or grant subscription-based worker access. One
mission can use multiple real worker processes through the existing
`mission_execute` / `mission_advance` pathway; no separate agent framework
or second authority was added.

`runtime_health.hostWorkerCapacity` reports the executing host's measured
capacity estimate, `mission_readiness.liveExecutionCapacity` reports the
current Mission admission envelope, and `mission_status.agentTeam` reports
the primary and durable subordinate dispatch identities. It counts **only**
actual WorkerAdapter-confirmed child processes as members, not planned roles,
unconfirmed launches or `runWorkers:false` packets. Unconfirmed attempts are
reported separately. A durable `executing` dispatch record is **not**
proof a process is still alive; live PID authority remains the WorkerAdapter.
Host resource snapshots do not prove model availability, and do not discover
resources on a different client machine when MCP is hosted remotely.

Without an enabled and configured native model or authorized external executor,
no actual worker can run. Native-model planning and task execution are now
available, while dynamic graph expansion, cross-machine scheduling and
runtime-observed per-agent cost/throughput control are **follow-up work**.
Changing the default capacity does not silently bypass the explicit
execution authorization policy.
## Evidence-based Worker selection (optional, no silent executor takeover)

The primary Agent can now compare **durable, verified engineering task outcomes**,
not role names or a model's opinion, when choosing the executor for a default
low/medium-risk task. `mission_status.workerPerformance` reports integrated
task attempts and evidence-backed failures; every actual dispatch records the
selected Worker and selection rationale. Successful integration is **not**
proof that final CI, semantic review or production acceptance passed.

This is an **explicit opt-in** for choosing among executors already authorized
by the operator. It never discovers or borrows a Codex/Claude session, installs
new providers, selects an unconfigured Worker, changes a task's explicit
`worker`, or automatically switches a high/critical-risk task.

```json
{
  "defaults": {
    "workerPolicy": {
      "enabled": true,
      "defaultWorker": "native",
      "nativeAgent": {
        "model": "your-model-name",
        "baseURL": "http://127.0.0.1:11434/v1"
      },
      "workers": {
        "bounded-specialist": {
          "type": "custom",
          "command": "/path/to/approved-worker",
          "args": []
        }
      },
      "adaptiveSelection": {
        "enabled": true,
        "candidates": ["native", "bounded-specialist"]
      }
    }
  }
}
```

Omit `adaptiveSelection` or leave `enabled: false` to retain the existing
operator/default routing. Candidate keys are configuration identities, **not**
extra authorization; each candidate must pass existing WorkerAdapter policy
and requested execution-capability checks. No candidate may expand a task's
`writeSet`, acquire credentials, or inherit the lead's merge authority.
Decisions use task-owner evidence when present, otherwise project history,
and exclude cancellation, supervisor-only launches, ambiguous timeouts,
integration conflicts and missing evidence. On retry the lead can choose
again using newly observed outcomes; execution remains subject to explicit
`mission_execute(runWorkers=true)` authorization, resource capacity and
operator control.

## Veteran-native Agent kernel (model-independent, self-spawning)

Veteran now includes its **own Agent inference/tool loop**, adapted from CodeAny
Open Agent SDK's `QueryEngine`/`AgentTool` architecture (upstream MIT;
`src/native-agent-LICENSE.txt`, reference commit
`a9ade5fdaefb0fb5cffdddeed93b3bc81feb7734`). It does **not** require
Claude, Codex or their subscriptions, CLI sessions, or an Anthropic API key.
It is a focused JavaScript port integrated with Veteran's runtime, **not** a
wholesale copy or claim of feature parity with the upstream SDK.

The kernel `src/native-agent-kernel.mjs` supports independent conversations,
iterative model decisions, arbitrary injected tool interfaces, tool-call
feedback, cancellation, bounded turns, and read-only `spawn_advisor` subagents
with **separate real model loops and histories**. The model can freely choose
whether to inspect files, debate designs, challenge assumptions or act; it is
not locked to a fixed role roster or canned step list. Advisers do not inherit
write tools or delegation permissions, and the primary owns final decisions.

The built-in native model adapter uses standard OpenAI-compatible Chat
Completions endpoints (`src/native-agent-model.mjs`) including **keyless local
Ollama / vLLM**. Host environments can inject any model object implementing
`complete({ messages, tools, signal })` instead. An API key is needed **only if
the selected model endpoint requires one**; the runtime never silently uses
an existing Claude/Codex session or creates an API subscription.

When an operator has authorized real native model execution, the same kernel:

- **Plans autonomously** using `mission_plan` without explicit tasks or an
  external planner command: the native planning Agent inspects repository
  evidence and submits a task DAG through `submit_plan`. The MissionService
  validates dependency/scope/conflict risk before admission.
- **Runs true engineering workers** through `mission_execute(runWorkers=true)`:
  each task is a separate OS subprocess with its own model context, controlled
  by the existing WorkerAdapter/supervisor, restricted file tools and an
  isolated Git worktree. The existing integration and proof gates remain.
- **Recruits advisers** inside an Agent's inference loop through
  `spawn_advisor`, with resource-based concurrent admission and no fixed
  2/4-worker roster. Advisory agents are independently reasoned opinions,
  not fake persona labels or execution-authority peers.
- **Runs an optional competitive Agent council** through `convene_council`:
  the primary picks the *perspectives and count* appropriate to an ambiguous
  decision; independent advisers propose before seeing each other's work,
  then separately instantiated adversarial reviewers test trade-offs and
  identify weak claims. Advisers run in capacity-sized waves when the host
  cannot safely admit all of them simultaneously. No fixed staff roster or
  per-mission 2/4-worker limit is introduced.
- **Keeps evidence-based selection under primary authority:** `read_council`
  pages proposals and critiques, while `select_council_option` records the
  lead's chosen proposal and explicit rationale. Model-derived endorsements
  and challenges are *advisory rankings only*, never correctness proofs or
  permission to edit/merge/deploy. Planning evidence records council size,
  structured ballots, selected option and bounded independent arguments.
  Small, straightforward tasks should skip this additional model work.

Advisory `advisorCapacity` is an *optional ceiling*, not a promise that the
host or model service can sustain that many calls. Current CPU/cgroup and
free-memory slots continue to bound adviser admission; overflow waits in
waves rather than being fabricated or prematurely promoted to a worker.
The council uses the configured model endpoint and therefore consumes its
available quota/cost; there is no new account, automatic paid API purchase,
or borrowed Claude/Codex session. A missing quota or failing model remains
an explicit incomplete review, not an invented successful vote.

Minimal local-model operator policy example (`operator.json` under the Veteran
runtime state root):

```json
{
  "defaults": {
    "workerPolicy": {
      "enabled": true,
      "maxWorkers": null,
      "nativeAgent": {
        "model": "qwen2.5-coder",
        "baseURL": "http://127.0.0.1:11434/v1",
        "maxTurns": 40,
        "plannerMaxTurns": 28
      }
    }
  }
}
```

This config is an example, **not** proof that the chosen local model or server
is installed, available or capable of tool calling. An optional `apiKeyEnv`
for a remote HTTPS model endpoint forwards only that named environment variable
into the authorized native worker. Credentials are never written into Mission
packets. Without an explicitly configured and reachable model, native Agent
execution is unavailable, rather than simulated.

Deliberate boundaries: native agents cannot run arbitrary shell commands by
default, see or edit private credential paths, commit/push/merge/deploy or
expand their worktree `writeSet`. This local file scope is not an OS-level
security sandbox: use appropriately isolated hosts or future container-backed
native executors for adversarial/untrusted code. The existing task source
verification and Worker process-tree cleanup still apply. Autonomous
always-on background operation, unlimited recursion, cloud subscription
reuse, a model marketplace, formal multi-adviser tournament scoring, and
cross-machine agent placement are **not yet implemented**.

## Worker execution boundaries

The built-in Codex preset uses `codex exec --sandbox workspace-write --ephemeral` and rejects dangerous sandbox/approval bypass flags.

The built-in `container` worker is fail-closed and requires Docker or Podman, a digest-pinned image, disabled network, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, bounded resources, bounded `noexec,nosuid` `/tmp`, controlled mounts, and allowlist-only environment forwarding.

Only the isolated task worktree is writable. The task packet and `.git` control file are read-only from the container. Confined containers default to the host numeric UID:GID when available so private `0600` task packets remain readable without producing root-owned worktree output. An explicit operator `user` remains authoritative.

Container isolation is defense-in-depth. Post-execution HEAD, symlink containment, declared write scope, commit ownership, and serial integration checks remain mandatory. `custom-unconfined` still requires explicit operator opt-in and remains blocked for high/critical/broad-write tasks.

## Durable state contracts

Veteran now has three explicit internal state-backend contracts:

- `veteran-state-backend-v1`: base runtime state surface;
- `veteran-state-transaction-v1`: opaque revisions plus `readSnapshot()` / `compareAndCommit()`;
- `veteran-state-durability-v1`: durable commit-outcome reconciliation plus `reconcilePendingAudit()`.

`createVeteranApp` fails closed unless an injected backend satisfies all three contracts.

### Local JSON

Local JSON remains the default backend. It retains cross-process locking, atomic state-file replacement, backup recovery, append-only audit hash chain, requestId idempotency, commit/audit reconciliation, and startup conversion of orphaned `started` request outcomes to `unknown`.

A state mutation carries a durable `stateCommitId`. If state replacement succeeds but audit append/acknowledgement becomes ambiguous, Veteran reports an unknown durable outcome rather than pretending normal success or failure. Startup and the next mutation reconcile the latest state commit against the verified audit chain. Missing audit is repaired exactly once; an already-appended entry is accepted without duplication; malformed/tampered/mismatched history fails closed.

### PostgreSQL hosted backend

PostgreSQL is the first hosted transactional backend. It is opt-in; Local JSON remains the default.

Select it with either programmatic `stateBackendConfig` or these environment variables:

```bash
export VETERAN_ENGINEER_STATE_BACKEND=postgres
export VETERAN_ENGINEER_POSTGRES_URL='postgresql://user:password@host/database'
export VETERAN_ENGINEER_STATE_INSTANCE='stable-runtime-instance-key'
# optional, 1..32; default 4
export VETERAN_ENGINEER_POSTGRES_POOL_MAX=4
```

The hosted backend requires the exact runtime capability `pg@8.23.0`. The base package/lock graph deliberately remains the already-verified MCP dependency graph; operators enabling PostgreSQL must install that exact driver in the shared runtime before launch. CI proves the hosted path by installing `pg@8.23.0`, starting a digest-pinned real PostgreSQL container, running backend conformance/durability/concurrency tests, then running the real modern MCP handshake with PostgreSQL selected.

PostgreSQL state and audit append commit in one SQL transaction. Each durable state identity is serialized at the database boundary, state rows use `FOR UPDATE`, CAS revisions remain explicit, and post-COMMIT acknowledgement loss is reconciled by durable commit identity before Veteran decides whether replay is safe. Integration proof includes two independent backend instances/connection pools targeting the same `instanceKey` without lost updates or audit divergence.

## Request idempotency and unknown outcomes

Every mutating MCP operation requires a `requestId`. Reuse with a different operation/payload is rejected. Completed requests replay their recorded result; failed requests replay failure; `unknown` outcomes are never replayed blindly. New request identities store a SHA-256 payload fingerprint rather than the raw request JSON, so idempotency does not become a durable copy of goals, paths, repository URLs, or future sensitive arguments. Legacy raw fingerprints remain replay-compatible.

Admission carries an internal attempt identity. If request admission itself becomes ambiguous, only the invocation that owns the durable reservation may continue after reconciliation. If a handler mutation may already have committed, the request becomes `unknown`, not falsely `failed`. If only completion acknowledgement is ambiguous, Veteran returns success only after durable state proves the request is already `completed`.

## Cross-surface runtime profiles

Veteran Engineer now separates the engineering core from the product surface through `veteran-surface-capabilities-v1`. The built-in runtime profiles are:

- `local-stdio`: direct local hosts; local repository paths and remote Git takeover are available;
- `remote-mcp`: hosted/remote MCP; caller-local paths and `file://` URLs are rejected and project takeover must use a network `repoUrl`;
- `secure-tunnel`: the runtime remains on a developer/private-network machine but is reachable through a secure MCP tunnel, so paths on that runtime machine remain valid.

`runtime_health` reports the effective surface profile. Unknown profiles fail closed. Generic MCP descriptors can select a topology with `--surface-profile`, including `secure-tunnel`. Tunnel provisioning itself remains an external OpenAI/workspace control rather than an undocumented command embedded in Veteran.

Distribution is now profile-aware. `export_plugin_bundle.py --profile desktop|codex|web` builds all surfaces from the same Skill source. Desktop/Codex profiles include the local runtime and `.mcp.json`; the Web profile intentionally excludes local MCP/runtime files so it is not made Desktop-only by its package contents. A Web package may reference a complete caller/workspace-supplied `.app.json`, but Veteran never invents app IDs, OAuth settings, remote MCP URLs, or tunnel configuration.

## Cross-host installation

The default shared runtime root is `~/plugins/veteran-engineer`. Durable runtime state is separate at `~/.veteran-engineer/state`, and installer ownership metadata lives at `~/.veteran-engineer/installer.json`.

For a fresh machine, download `veteran-engineer-bootstrap.mjs` from the desired stable GitHub Release (or the latest release) and run it directly with Node 20+:

```bash
node veteran-engineer-bootstrap.mjs install generic
# local host integrations
node veteran-engineer-bootstrap.mjs install codex
node veteran-engineer-bootstrap.mjs install hermes
# pin the bootstrap to an exact stable release when required
node veteran-engineer-bootstrap.mjs install generic --release v0.4.0
```

The bootstrap refuses to overwrite an existing runtime. Before promotion it self-verifies against the selected GitHub Release asset digest, verifies the release manifest and canonical runtime checksum, validates every runtime file, prepares the pinned base dependency graph with `npm ci --include=optional --omit=dev --ignore-scripts`, verifies the required MCP SDK packages actually installed, and only then atomically promotes the runtime and binds the selected host. Network, digest, bundle, or dependency failures leave no active runtime. If host binding itself fails after promotion, the verified runtime is deliberately left in place for explicit repair rather than being removed underneath a potentially partial host-side mutation.

For an existing installation, use the lifecycle CLI:

```bash
node bin/veteran-engineer.mjs hosts
node bin/veteran-engineer.mjs status
node bin/veteran-engineer.mjs doctor
node bin/veteran-engineer.mjs upgrade --release latest
# or pin an exact stable release
node bin/veteran-engineer.mjs upgrade --release v0.4.0
```

Codex, Hermes, generic MCP, and trusted external adapters bind the same shared runtime; hosts do not fork the engineering core. Local repair still re-synchronizes the caller's distribution. Remote upgrade resolves only a public, non-prerelease GitHub Release, requires an exact release commit, verifies GitHub asset SHA-256 metadata plus the release manifest/checksum, validates every file in the canonical runtime bundle, stages it outside the active runtime, then atomically swaps the shared runtime and rebinds every recorded host. Existing `node_modules` capabilities are preserved only when the target dependency graph is identical; dependency-graph changes fail closed instead of reusing stale packages. Downgrades are rejected.

The canonical runtime and standalone bootstrap release assets are separate from the Desktop/Codex/Web plugin archives, so lifecycle management does not depend on a product-specific ZIP layout or an external unzip/tar binary.

## Development validation

Base gate:

```bash
npm ci --include=optional
npm run check
```

Real container worker proof:

```bash
VETERAN_CONTAINER_SMOKE_IMAGE='registry/image@sha256:<digest>' npm run test:container-smoke
```

Real PostgreSQL backend proof requires `pg@8.23.0` plus `VETERAN_TEST_POSTGRES_URL`:

```bash
npm install --no-save --package-lock=false pg@8.23.0
VETERAN_TEST_POSTGRES_URL='postgresql://...' npm run test:postgres
```

Protocol checks:

```bash
node scripts/mcp-handshake.mjs --mode legacy --force-fallback
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
node scripts/mcp-handshake.mjs --mode auto --require-sdk --force-fallback
```

Fallback results are never counted as modern-protocol proof.

## Convergence status

The current architecture has been reviewed across Mission finalize, worker isolation/process ownership, adaptive Mission execution, provider boundaries, interruption/restart reconciliation, durable state, remote onboarding, cross-host packaging, and real Docker/PostgreSQL execution boundaries.

The convergence pass has closed concrete authority and lifecycle defects rather than expanding the public surface:

- root/runtime-starter synchronization is executable CI policy, not a documentation promise;
- remote project onboarding no longer requires a manual local clone, while managed checkout refresh remains credential-safe and fast-forward-only;
- hosted PostgreSQL has cross-instance concurrency and durable-outcome evidence, not only same-process/same-pool coverage;
- adaptive Mission strategy now preserves explicit risk intent through planning and execution-capacity policy without growing the 36-tool surface;
- planner/reviewer provider configuration fails fast and provider evidence redacts allowlisted secret values before durable persistence;
- interruption recovery preserves unresolved task authority across repeated resume and partial retry;
- Mission status/readiness cannot outrun authoritative execution task state: failed/cancelled/interrupted work stays blocked, while admitted/dispatched/executing/cancelling work keeps next-transition readiness false;
- current capacity/lease and multi-Mission contention behavior remains unchanged where existing reservation/reconciliation tests already prove the contract.

No convergence review found a reason to weaken the 36-tool compatibility surface, change state schema 3, relax fail-closed behavior, or move merge/push/deploy authority into the runtime.

## Deliberate deferrals

`v0.3.0` was the first durable public release; the latest public release is `v0.4.0`, and `0.5.0` is the current development line. Packaging the PostgreSQL driver into the base dependency graph remains a separate distribution/versioning decision; today it is an explicit hosted capability prerequisite. Managed database migrations beyond the current v1 schema bootstrap and automatic operator merge/push remain intentionally out of scope.
