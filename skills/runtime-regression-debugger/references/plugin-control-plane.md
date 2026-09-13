# Plugin Control Plane

Use this when this engineering Skill is paired with a plugin/app/MCP backend, or when designing that backend. The Skill remains the judgment and policy kernel; the plugin provides durable state, controlled repository/runtime access, orchestration, and optional UI.

Before implementing a ChatGPT-facing app, verify the current OpenAI Apps SDK and MCP documentation and official examples. Product APIs, metadata keys, permission UX, and submission rules can change faster than this Skill.

The bundled executable V2 lives at `assets/plugin-runtime-starter/`. Read `references/plugin-runtime-v2.md` before modifying its state model or tool contracts, and use `scripts/export_plugin_bundle.py` to produce a plugin bundle containing the current Skill plus the runtime.

## Contents

- Separate policy kernel from execution control plane
- Prefer a small public tool surface
- Use mission-oriented tools rather than shell-shaped tools
- Persist project state explicitly
- Model state transitions and freshness barriers
- Bound repository and runtime mutation
- Design approvals around consequence
- Support resumable multi-agent execution
- Build an engineering cockpit UI only when it improves decisions
- Keep tool outputs compact and evidence-addressable
- Degrade cleanly when plugin capabilities are unavailable
- Avoid plugin anti-patterns

## Separate policy kernel from execution control plane

Keep responsibilities distinct.

**Skill / policy kernel owns:**

- contract compilation;
- engineering judgment;
- mechanism selection;
- risk classification;
- validation strategy;
- compatibility and lifecycle reasoning;
- delegation packet quality;
- calibrated completion claims.

**Plugin control plane owns:**

- authenticated access to repositories and external systems;
- durable project/mission/task state;
- workspace/worktree or sandbox lifecycle;
- command execution and artifact capture;
- worker/agent orchestration if supported;
- evidence storage and exact source/build identities;
- approvals and mutation gates;
- resumability after conversation/session loss;
- UI projections over this state.

Do not put long-lived secrets, raw credentials, or broad infrastructure mutation logic inside Skill files.

## Prefer a small public tool surface

Do not expose every internal script, Git command, CI operation, filesystem primitive, database query, and worker action as a separate model-facing tool.

Expose a small set of intention-level tools and keep implementation fan-out behind the server. A practical initial surface is roughly 6-10 tools, for example:

- `project_open` - bind an authorized repository/project and return current source/runtime identity;
- `project_snapshot` - refresh authoritative project, branch, dirty-tree, build, dependency, and delivery signals;
- `mission_plan` - create/update the dependency-aware mission graph from a compiled contract;
- `mission_execute` - execute or dispatch ready low-risk tasks within declared scope;
- `mission_status` - return task states, blockers, conflicts, approvals, and evidence summary;
- `evidence_query` - fetch targeted logs/tests/diffs/history/artifacts by stable evidence ID;
- `experience_query` - retrieve scoped prior project lessons relevant to the current mechanism;
- `experience_commit` - store reviewed project-level lessons or failed-attempt fingerprints;
- `handoff_export` - produce worker packets or a resumable mission bundle.

Names are examples, not a frozen API. Keep the semantic shape stable even if implementation names differ.

Prefer one mission operation that internally chooses the correct deterministic helper over dozens of model-visible helper tools. Large tool catalogs increase routing ambiguity, permission complexity, and maintenance cost.

## Use mission-oriented tools rather than shell-shaped tools

A generic `run_any_command` or unrestricted filesystem tool is powerful but weak as the primary app contract. It pushes authorization, scoping, idempotency, and semantic validation back onto prompt text.

Prefer operations with explicit scope and postconditions:

`intent -> authorized project -> bounded target -> action -> evidence -> resulting identity`

Examples:

- "run affected tests for task T12" is safer and more auditable than "run arbitrary shell";
- "apply patch to reserved files for task T12" is safer than "write any file";
- "create isolated worktree for worker W3" is safer than "git command";
- "refresh release state" is safer than ad hoc API calls that may mutate release state.

The backend can still use shell/Git/CI APIs internally. Keep that implementation detail behind consequence-aware contracts.

## Persist project state explicitly

Durable state is the main capability that turns the Skill from a good one-shot engineer into a continuing project operator.

Use explicit entities such as:

**Project**
- project ID and authorized repository identifiers;
- default branch and current tracked source identity;
- stack/build/runtime fingerprints;
- key project instructions and protected paths;
- active architecture/authority summaries with evidence and freshness.

**Mission**
- mission ID;
- user/operator contract;
- done definition;
- non-goals;
- base source identity;
- status and current phase;
- risk/authorization envelope;
- compatibility/migration phase;
- evidence level.

**Task**
- task ID and mission ID;
- dependencies;
- owner/boundary;
- expected/reserved write set;
- worker assignment;
- state;
- validation oracle;
- resulting patch/commit/artifact identity.

**Evidence**
- evidence ID;
- type (test, trace, log, diff, runtime, history, plan, artifact, screenshot, benchmark);
- source/build/runtime identity;
- timestamp and freshness scope;
- bounded summary;
- durable pointer to raw artifact when allowed.

**Experience**
- scoped lesson/fingerprint;
- supporting evidence IDs;
- counterexamples/anti-scope;
- freshness/expiry conditions;
- status: candidate, active, superseded, rejected;
- promotion history.

The model should be able to resume from compact structured state without trusting an old natural-language summary as sole authority.

## Model state transitions and freshness barriers

Use explicit mission/task state transitions. Example mission states:

`planned -> ready -> executing -> integrating -> validating -> blocked | completed | cancelled`

Example task states:

`planned -> ready -> claimed -> executing -> candidate -> validated -> integrated -> done`

Include `failed`, `blocked`, and `superseded` as explicit states. Do not encode failure by leaving work "in progress" indefinitely.

Every consequential mutation must produce a new source/runtime identity or an explicit statement that identity did not change.

Invalidate stale snapshots after:

- commit/merge/push/rebase;
- schema/code generation;
- dependency or lockfile update;
- migration creation/application;
- CI/release/deployment mutation;
- worker patch integration;
- production/config/flag change;
- external side effect that changes the contract.

Before a dependent mutation, refresh the authority required for that decision.

## Bound repository and runtime mutation

Require the backend to enforce, not merely narrate:

- project/repository allowlists;
- branch/worktree isolation;
- path scopes or reserved write sets when practical;
- command timeouts and output limits;
- secret redaction;
- network egress policy;
- dependency-install policy;
- protected branch/release rules;
- destructive operation gates;
- exact base identity for patch application;
- audit trail linking mutation to mission/task/user authorization.

Do not rely on an AI worker to remember every permission rule under long context.

## Design approvals around consequence

Separate ordinary engineering autonomy from consequential external actions.

Low-risk/reversible repository-local work can often be pre-authorized at mission scope:

- inspection;
- creating isolated worktrees;
- editing allowed files;
- running focused tests/builds;
- temporary diagnostics;
- producing patches and handoff artifacts.

Require explicit or policy-backed approval for actions such as:

- merge/push when not already authorized;
- production deployment or traffic change;
- destructive data mutation;
- schema/data migration with irreversible effects;
- secret/credential/access-policy changes;
- package/public release;
- real monetary or external customer effects.

The server should expose consequence in the tool contract so the host can present meaningful approval UX.

## Support resumable multi-agent execution

If the backend can spawn or coordinate workers, treat workers as bounded executors, not independent project managers.

The control plane should:

- freeze the mission-level contract before broad fan-out;
- create isolated worker contexts/worktrees;
- attach a compact worker packet;
- reserve or predict write sets;
- prevent simultaneous conflicting integration;
- collect structured worker results;
- detect base drift before accepting a patch;
- reroute tasks when evidence invalidates assumptions;
- integrate in dependency waves;
- revalidate combined state after each wave.

Do not require every worker to receive the full Skill library. Give workers the minimum mechanism-specific references plus mission constraints.

## Build an engineering cockpit UI only when it improves decisions

A ChatGPT widget or plugin UI is useful for state that is easier to scan than narrate repeatedly.

A compact cockpit can show:

- current mission and completion definition;
- source/base identity;
- task DAG/waves;
- tasks ready/running/blocked;
- write conflicts/reservations;
- approvals waiting;
- failed attempt equivalence classes;
- evidence level per task;
- integration/validation status;
- residual risk and rollback/forward-repair controls.

Prefer UI actions that map to bounded server tools: inspect evidence, approve a consequential action, retry after a changed assumption, export a handoff packet, or refresh project state.

Do not build a dashboard that merely duplicates chat prose or tempts users to treat green badges as proof without evidence identity.

## Keep tool outputs compact and evidence-addressable

Return the model the smallest structured result needed for the next decision. Large logs, diffs, test reports, and repository maps should be stored as artifacts and referenced by stable IDs.

A useful tool result shape includes:

- operation/task ID;
- status;
- exact source/build/runtime identity;
- bounded summary;
- evidence IDs;
- changed assumptions;
- blockers/approval requirements;
- next safe actions.

Avoid injecting megabytes of logs into conversation context. Let `evidence_query` retrieve targeted slices.

## Degrade cleanly when plugin capabilities are unavailable

The Skill must remain useful without its plugin.

When durable backend state is unavailable:

- use repository truth and current-session evidence;
- use `engineering_journal.py` for long investigations when helpful;
- emit worker packets instead of pretending to dispatch them;
- state when continuity cannot survive a new session;
- never claim a remembered project lesson that was not actually loaded.

When a capability becomes unavailable mid-mission, checkpoint what can be proven, report the execution boundary reached, and continue with the least consequential supported path rather than fabricating tool success.

## Avoid plugin anti-patterns

Do not:

- expose 50-100 model-facing tools because internal helpers already exist;
- make the Skill self-modify its own instructions after every run;
- persist raw secrets, customer payloads, or noisy logs as "memory";
- treat stored memory as more authoritative than current repository/runtime evidence;
- let a stale project summary authorize a release or destructive mutation;
- use one universal dangerous tool when bounded semantic tools can cover the workflow;
- couple correctness to one conversation remaining alive;
- let worker branches drift for long periods before integration;
- call a mission complete from worker self-reports without integration evidence;
- turn every engineering concept into a UI control.

The plugin should make the engineer more stateful and operational, not more ceremonious.
