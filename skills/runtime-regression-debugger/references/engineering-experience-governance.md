# Engineering Experience Governance

Use this when prior attempts, repeated project failures, or a plugin-backed durable store are available and the system should learn without turning stale guesses into permanent truth.

## Contents

- Define learning as evidence reuse, not autonomous self-rewriting
- Use three memory scopes
- Store negative knowledge as first-class evidence
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
