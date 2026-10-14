# Engineering Experience Governance

Use this when prior attempts, repeated project failures, or a plugin-backed durable store are available and the system should learn without turning stale guesses into permanent truth.

## Contents

- Define learning as evidence reuse, not autonomous self-rewriting
- Use three memory scopes
- Store negative knowledge as first-class evidence
- Discover repeated proven workflows without silently changing Skills
- Normalize an experience record
- Promote lessons conservatively
- Decay and revalidate stale lessons
- Retrieve by mechanism and scope
- Prevent memory from overriding current truth
- Protect privacy and secrets
- Evaluate whether learning actually helps

## Define learning as evidence reuse, not autonomous self-rewriting

"Learning from mistakes" means future investigations can reuse validated evidence about mechanisms, failed assumptions, project-specific ownership, validation commands, and recurring compatibility constraints.

It does **not** mean:

- silently editing `SKILL.md` after every task;
- treating one successful patch as a universal pattern;
- remembering unverified natural-language conclusions forever;
- preferring memory over current code/runtime state;
- storing raw private data because it may be useful later.

The safest learning loop is:

`experience -> structured candidate -> scope + evidence -> repeated confirmation -> promotion -> expiry/revalidation -> supersession/removal`

## Use three memory scopes

### 1. Run memory

Task-local and temporary. Store hypotheses, attempts, evidence, decisions, and blockers for one investigation or mission.

Use `scripts/engineering_journal.py` when helpful.

Run memory can be detailed because it is short-lived. It should not be mistaken for cross-session memory unless persisted explicitly.

### 2. Project memory

Durable only for one repository/product/tenant-safe project scope.

Good project memories:

- authoritative generator for a generated client;
- release trigger and version owner;
- known dangerous migration ordering;
- repository-specific command that reliably reproduces a bug class;
- a cache/projection that repeatedly looks authoritative but is not;
- a failed approach fingerprint that should not be repeated without new evidence;
- a hidden consumer or compatibility boundary confirmed multiple times;
- a flaky test classification with an identified root mechanism.

Project memory must carry source/evidence identity and freshness conditions.

### 3. General engineering pattern candidate

Cross-project and much harder to promote. These candidates may influence the Skill only after repeated independent evidence and deliberate review.

Most runtime lessons should never leave project scope. Generalization is expensive because superficially similar symptoms can have different owners.

## Store negative knowledge as first-class evidence

Failed attempts often carry more reusable information than successful edits.

Record:

`attempt -> assumption -> equivalence class -> observed contradiction -> scope where this approach is forbidden -> evidence IDs`

Examples:

- "Increasing client timeout does not fix this project’s duplicate-charge path; provider may commit before timeout."
- "Editing generated client files is non-durable; source schema + generator own these outputs."
- "This repository’s release is merge-triggered; a manual tag after merge duplicates publication."

Do not store "never use retries" or similarly broad prohibitions when only one scoped retry design failed.

Use `scripts/experience_compactor.py` to turn one or more journals into candidate records. The output is candidate memory only; it does not auto-promote anything.

## Discover repeated proven workflows without silently changing Skills

When a genuine multi-step process has succeeded and carries stable proof, reuse the **existing engineering journal** rather than constructing another runtime/memory subsystem. Record at most the decision-relevant steps as short, lowercase action slugs with exact evidence pointers. Omit customer text, proprietary source, shell payloads, credentials, and volatile implementation trivia. This is opt-in instrumentation for useful repeated work, not a requirement to log every command.

For each actual step during a long mission:

~~~bash
python3 scripts/engineering_journal.py /tmp/run1.json workflow-step \
  --workflow repo-validation --step inspect-head --outcome passed --evidence-id commit:abc123
python3 scripts/engineering_journal.py /tmp/run1.json workflow-step \
  --workflow repo-validation --step run-focused-tests --outcome passed --evidence-id test:unit-green
python3 scripts/engineering_journal.py /tmp/run1.json close --evidence-level focused-validated
~~~

When three **independent task journals** record the same verified sequence, analyze them without altering the Skill or the journals:

~~~bash
python3 scripts/experience_compactor.py /tmp/run1.json /tmp/run2.json /tmp/run3.json \
  --scope-id repo:owner/name --include-workflows --min-workflow-runs 3
~~~

### Optional post-tool observation, without a host-global listener

For a host that actually exposes post-tool callbacks, a consenting bridge may translate
**outcomes and immutable proof receipts only** into allowlisted semantic events. The
Skill cannot subscribe to ChatGPT's private tool stream, install invisible hooks, or
observe sessions where no bridge exists.

Initialize the existing task journal. After a real tool result, a bridge can pass a
small newline-delimited JSON stream to the optional importer:

~~~bash
python3 scripts/engineering_journal.py /tmp/run1.json init --contract "repo change"
python3 scripts/workflow_observer.py /tmp/run1.json --source local-bridge --events /tmp/observed.jsonl
~~~

Example sanitized `/tmp/observed.jsonl` (one JSON object per event):

~~~jsonl
{"event_id":"tool-001","workflow":"repo-validation","activity":"repo.inspect","outcome":"passed","evidence_ids":["commit:abc123"]}
{"event_id":"tool-002","workflow":"repo-validation","activity":"checks.focused","outcome":"passed","evidence_ids":["test:focused-green"]}
{"event_id":"tool-003","workflow":"repo-validation","activity":"review.diff","outcome":"passed","evidence_ids":["review:diff-reviewed"]}
~~~

The bridge must map tool results to these activities: `repo.inspect`,
`source.change`, `checks.focused`, `review.diff`, `pr.create`,
`checks.ci`, `release.verify`. It must only report `passed` after the
tool's own outcome and proof were inspected, not from a planned command or a
model's optimistic narration. The importer permits **only** event ID, workflow,
activity, outcome and short proof IDs. Extra fields (arguments, output, source
content, prompts, identities, credentials) fail the entire batch; raw event IDs
are hashed before storage. There is no external network send or background
process. Serialize bridge writes with other journal writers.

Each journal remains task-scoped. Duplicate event IDs replay idempotently;
contradictory replays fail closed. Different outcomes, repeated non-identical
steps, or mixed manual and observed capture in one workflow count against
automatic promotion. The importer only records asserted receipts: it cannot
independently verify a test or CI run. Confirm exact identities on review.
Without real host hooks, use the existing manual `workflow-step` command.

#### Built-in optional Veteran MCP producer

Veteran's own MCP server (official SDK and standalone fallback) provides an actual **post-result callback**.
It observes only returned, typed runtime results from `project_snapshot`, `task_result_commit`,
`validation_run`, and `review_run`, then delivers the same bounded JSONL schema
to `scripts/workflow_observer.py`. No result or returned proof means **no event**.
Explicit failed validation/review with durable evidence becomes a negative observation.

This is **disabled by default**. For each actual task, initialize a dedicated
journal with its own contract, then set the following variables in the MCP server
environment before launch:

~~~bash
python3 /absolute/skill/scripts/engineering_journal.py /absolute/task.json init --contract "Current task"
export VETERAN_WORKFLOW_OBSERVER=1
export VETERAN_WORKFLOW_JOURNAL=/absolute/task.json
export VETERAN_WORKFLOW_OBSERVER_IMPORTER=/absolute/skill/scripts/workflow_observer.py
# Optional: VETERAN_WORKFLOW_OBSERVER_PYTHON=/absolute/python3
~~~

On Windows set the variables with PowerShell and point the optional Python setting
at a reachable Python interpreter. Use the importer from the **installed matching
Veteran Skill**. The separately bundled runtime starter may not include the Skill
scripts, so no implicit relative importer path is guessed.

Only a hashed request identifier, stable activity slug, passed/failed outcome,
Git commit hash and runtime-generated opaque evidence IDs reach the importer.
Prompts, arguments, commands, tool output, file paths, credentials and arbitrary
result properties are excluded. Child execution uses an argument vector plus
JSONL stdin, never a shell-escaped command. Delivery is serialized within the
MCP process and awaited; it does not persist beyond that host session.
Own each journal in **one** MCP process; concurrent producers or manual writers
on the same journal need external serialization. If Python, script or journal is
unavailable, the MCP tool result is unchanged and one bounded stderr warning
is emitted. A disabled producer has no journal reads or subprocesses.

This hook applies to Veteran's **own MCP tool calls only**. It cannot capture
ordinary ChatGPT conversations, IDE tools, external GitHub connector calls,
third-party tools, or sessions when the MCP runtime is not running.
Candidate extraction remains opt-in and produces review-required proposals;
there is no automatic Skill rewrite, promotion, installation or background agent.
The compactor groups by workflow and **ordered steps**, ignores copied/replayed task identities, and emits project-scoped `repeated-workflow` candidates with proof references and a counterexample count. A failed, incomplete, open, or materially different run blocks promotion until reconciled. Multiple records from one task never satisfy independence; the threshold is a heuristic for useful candidates, not evidence of generality or benefit. Without journal capture or an exposed executor, the Skill can only identify a pattern from explicitly supplied evidence; it cannot secretly observe all conversations, run a background learner, or modify loaded instructions.

A candidate becomes a genuine Skill improvement only after confirming the current repository, source/package identity, scope and false positives; checking prior rules for duplicates; comparing old-versus-new behavior on representative and held-out tasks; and shipping a reviewable, regression-covered repository PR. For automatic reuse **before** general promotion, a human-reviewed, scope-bound project playbook may be recorded in the project's existing authorized memory store; freshness is checked each run. Do not turn a candidate into a global rule solely because its steps repeat.

## Normalize an experience record

A durable experience record should be small and machine-comparable.

Suggested fields:

- `experience_id`;
- `scope_type`: run/project/general-candidate;
- `scope_id`;
- `mechanism`;
- `statement`;
- `kind`: failed-assumption, invariant, ownership, validation, compatibility, release, performance, operability;
- `equivalence_class` when relevant;
- `evidence_ids`;
- `source_identity` or source range;
- `applies_when`;
- `does_not_apply_when`;
- `confidence` or status;
- `created_at` and `last_confirmed_at`;
- `expires_when` or freshness trigger;
- `supersedes` / `superseded_by`;
- `review_status`.

Prefer one sharp claim over a paragraph of narrative.

## Promote lessons conservatively

Promotion changes how future work is routed, so require stronger evidence than ordinary task-local reasoning.

Suggested project-memory promotion rules:

- direct repository/runtime evidence, not analogy alone;
- the statement changes a future engineering decision;
- scope is explicit;
- a falsifier or expiry condition exists when the fact can drift;
- no secret/PII/raw customer payload is required;
- the lesson is not just a temporary implementation detail already obvious from current code.

Suggested general-pattern promotion rules:

- repeated independent examples, preferably across different projects/stacks;
- mechanism is stable across examples;
- counterexamples and anti-scope are documented;
- measurable benefit on benchmark or real task quality;
- no existing Skill reference already owns the same lesson;
- human/reviewer approval before modifying the Skill package.

Never let runtime code automatically rewrite or publish the Skill bundle.

## Decay and revalidate stale lessons

Project facts drift. Attach expiry triggers such as:

- default branch or release pipeline changed;
- owning package/service moved;
- schema version changed;
- major dependency/framework upgrade;
- migration completed and old compatibility path removed;
- test command or workspace graph changed;
- enough time passed that runtime topology may differ.

On retrieval, classify a memory as:

- fresh enough to use directly as a navigation hint;
- stale but useful as a hypothesis;
- contradicted and requiring supersession;
- no longer relevant and removable.

A stale memory may suggest where to look. It must not silently authorize a consequential action.

## Retrieve by mechanism and scope

Rank retrieval by:

1. exact project + same contract/owner;
2. exact project + same mechanism/equivalence class;
3. same repository subsystem + compatible source identity;
4. general pattern candidate with strong evidence;
5. broad analogy only as a probe.

Retrieve a few high-signal experiences, not a dump of everything remembered about the project.

Return both supporting and contradictory prior evidence when available. Avoid confirmation bias from only retrieving successful precedent.

## Prevent memory from overriding current truth

Use this precedence order:

`current runtime/repository evidence -> current tests/schemas/manifests -> current authoritative external state -> fresh project memory -> general pattern -> analogy`

If memory conflicts with current evidence, current evidence wins and the memory should be marked stale, contradicted, or superseded.

Do not use old project memory as proof that:

- a branch is current;
- a migration is unapplied;
- a release has not happened;
- an auth rule still exists;
- a service still owns a write;
- a dependency is still on a particular version.

## Protect privacy and secrets

Never persist as experience:

- credentials, API keys, private tokens;
- raw customer/user payloads;
- unnecessary personal data;
- full production logs when a redacted mechanism summary is sufficient;
- proprietary source excerpts when a stable symbol/path/evidence pointer is enough.

Prefer fingerprints, bounded summaries, stable IDs, and redacted evidence pointers.

## Evaluate whether learning actually helps

A memory system that merely grows is not improving.

Track whether prior experiences:

- reduce repeated failed equivalence classes;
- shorten time to authoritative owner;
- reduce redundant repository exploration;
- improve first-pass validation selection;
- prevent repeated release/migration mistakes;
- improve batch-plan stability;
- avoid stale-memory regressions.

Add regression scenarios when a new learning rule is introduced. Remove or narrow memories that increase false routing or ceremony.
