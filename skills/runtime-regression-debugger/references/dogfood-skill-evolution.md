# Dogfood Skill Evolution


## Contents

- Keep the live task primary
- Classify before changing the Skill
- Prove capability delta before keeping generic guidance
- Converge before expanding
- Place each rule in the cheapest correct owner
- Treat model-era scaffolding as provisional
- Distinguish prohibited self-rewrite from authorized evolution
- Capture the smallest useful regression
- Keep a maintenance authority map
- Evaluate discipline under pressure, not only comprehension
- Keep behavior and trigger regressions separate
- Bind evaluation to the loaded Skill identity
- Capture dogfood telemetry from one journal
- Keep regression pressure proportional
- Promotion rule

Use this when Veteran Engineer is maintaining its own Skill/runtime, or when the user explicitly asks to improve the Skill from evidence gathered during real repository work.

## Keep the live task primary

Treat real engineering work as the primary evaluation surface. Do not stop productive repository work merely to invent a separate synthetic benchmark phase.

Use this loop:

`real task -> observed friction or mistake -> classify the owner -> fix the real owner -> capture a minimal regression -> continue real work`

Synthetic benchmark runs are comparison tools, not a replacement for dogfooding. Run them when a Skill change needs controlled before/after evidence, not as ceremony after every repository task.

When external Skill repositories or authoring systems inform an edit, consult `references/skill-evolution-sourcebook.md` as the maintained source/evidence inventory. Synthesize the mechanism; do not import another host's loader limits, tool names, directory layout, or permission model into the cross-host core without evidence that the active host needs it. Before adding or reviving a structural mechanism, also scan the sourcebook's rejected/no-change ledger; revisit a rejected idea only when new evidence changes the mechanism or trade-off, and record why the previous rejection no longer applies.

## Classify before changing the Skill

Every painful outcome is not a Skill-policy defect. Classify the observation first:

- **product/runtime bug**: active implementation violates its contract; fix runtime/source/tests at the owning layer;
- **test-oracle or fixture defect**: the validation itself lies, leaks state, or fails to isolate scenarios; repair the test rather than teaching the Skill the wrong product rule;
- **tool/environment limitation**: connector, sandbox, network, credential, or host capability caused the failure; adapt tooling or report the boundary;
- **project-specific fact**: ownership, release topology, generated source, or compatibility rule is useful only for this repository; keep it in project evidence/memory;
- **Skill-policy gap**: the reasoning/routing/authorization/evidence policy is reusable across repositories and the current instructions made the wrong behavior materially more likely.

Only the last category is a direct candidate for changing `SKILL.md` or a general reference. Do not encode one repository's accident as universal engineering law.

## Prove capability delta before keeping generic guidance

Treat permanent Skill context as scarce. A rule earns its place only when it changes a reusable decision, closes an observed shortcut, supplies project-independent domain knowledge the base model does not reliably recover, or encodes a deterministic/tool workflow that would otherwise be rediscovered repeatedly.

When fresh model runners are available, use an ablation or baseline comparison before retaining generic-looking guidance:

`prior/no-skill behavior -> candidate skill behavior -> discriminating expectation -> cost in tokens/time/complexity`

If the baseline already produces the same important decision and evidence consistently, the new prose has little capability delta. Cut it, narrow it to the actual missing boundary, or move non-runtime maintenance detail out of the loaded path. Do not reward an edit merely because both versions pass an easy assertion.

Look especially for generic coaching that sounds wise but does not change action: "write clean code", "consider accessibility", "use best practices", "test thoroughly", "be user-centered", or long explanations of concepts the model already handles. Keep concrete routing, authority, failure, evidence, and anti-shortcut rules instead.

Do not over-apply ablation where a rule exists for rare but high-consequence safety/correctness boundaries that a small sample may not exercise. In those cases, judge the retained mechanism from the risk and pressure-case evidence, not only average benchmark frequency.

## Converge before expanding

Treat Skill surface area as a cost. Before adding a reference, script, gate, route, specialist, or runtime layer, prove that the existing owner cannot express the mechanism cleanly.

Prefer this order:

`strengthen existing owner -> consolidate overlap -> delete superseded material -> add a new module only if a distinct reusable contract remains`

A new module must buy a real boundary: materially different authority, failure model, routing need, or deterministic validation contract. One awkward task, one extra checklist, or one more domain label is not enough. A new gate should protect a fragile machine-checkable invariant; do not turn prose guidance into ceremony just because a script can validate its shape.

When an evolution increases file count, indirection, or parallel authorities, state why that complexity is cheaper than extending or simplifying the current owner. If that case is weak, converge instead of expanding.

When maintaining the optional runtime from the distributed Skill, materialize `assets/plugin-runtime-starter.zip` with `scripts/runtime_starter_archive.py`, edit and validate that materialized tree, then repack it deterministically. In a source repository that also has a root handwritten runtime, keep that root runtime as the single owner and derive the distribution archive from it; do not create a second handwritten runtime authority.

## Place each rule in the cheapest correct owner

Before adding guidance, classify where it belongs. The same correct idea can make the system worse when placed in the wrong always-loaded layer.

Use this placement order:

- **Kernel / `SKILL.md`** - cross-project process invariant that must be visible on most substantial tasks, changes an important decision, is not reliably inferable from base capability, and cannot be enforced more cheaply by code or project authority. Prefer rules likely to survive model generations.
- **Reference** - conditional specialist knowledge, branch-specific workflow, examples, or high-detail policy needed only when a mechanism is active.
- **Script/test/tool** - deterministic parsing, transformation, validation, accounting, graph checks, or other machine-checkable work.
- **Project truth** - repository-specific commands, owners, schemas, conventions, release topology, or design-system facts. Keep them with the project, not in the global Skill.
- **Eval-only hypothesis** - candidate rule, pressure case, model-specific weakness, or benchmark scenario that still needs capability-delta evidence.
- **Delete** - generic advice, duplicated prose, stale model workaround, or a rule whose removal does not worsen discriminating behavior.

Do not solve context bloat by merely moving every sentence into a new reference. A reference must have a distinct loading condition and decision owner; otherwise consolidate or delete it.

A candidate Kernel rule should normally satisfy all of these questions: Is it reusable across repositories? Likely to remain valid across model generations? Costly to miss? Needed in most relevant runs? Not already recoverable from project evidence? Not cheaper to enforce deterministically? Backed by a real failure, counterexample, or high-consequence boundary? If several answers are no, keep it out of the Kernel.

## Treat model-era scaffolding as provisional

Harness instructions often encode assumptions about what the current model cannot do. Mark such mechanisms as provisional unless they express a stable interface or safety/correctness invariant.

Examples include mandatory context resets, fixed numbers of planner/reviewer passes, unconditional independent evaluators, repeated self-critique loops, and rigid decomposition depth. Keep them only while current model/task evidence shows lift. Re-test after meaningful model/harness upgrades and prefer ablation one component at a time over wholesale rewrites so load-bearing structure remains visible.

Stable interfaces should outlive implementation details: outcome contract, authority, evidence identity, bounded mutation, handoff state, and completion proof are stronger Kernel candidates than one specific worker topology.

## Distinguish prohibited self-rewrite from authorized evolution

Runtime feedback must never automatically rewrite or publish the Skill.

A deliberate Skill change is allowed when all of these are true:

1. the user or maintainer explicitly authorized Skill evolution;
2. the observed behavior is backed by concrete task evidence;
3. the proposed rule is scoped to a reusable mechanism rather than one repository detail;
4. the change is reviewable as an ordinary repository diff;
5. a regression case is added or refreshed so the same failure can be detected later.

This is human-authorized engineering of the Skill, not autonomous self-modification.

## Capture the smallest useful regression

After a material Skill-policy failure, capture only the decision boundary that mattered:

- starting evidence/state;
- tempting but wrong action;
- expected veteran behavior;
- critical red flag if the wrong path is taken.

Prefer one sharp scenario over a transcript dump. Preserve mechanism, not names, secrets, or incidental repository details.

Examples:

- A deliberately invalid CommonJS fixture is loaded, then the same module path is overwritten for a positive control. The second case still sees the cached invalid module. Classify this as test isolation/module identity, not a PostgreSQL product regression or a new general runtime rule.
- While maintaining Veteran Engineer itself, the engineer proposes stopping live development to create a separate benchmark program even though the current task is already exercising the Skill. Treat the live task as the primary dogfood run; capture the process mistake as a regression after closing the active work.
- A remote mutation succeeds and the next action relies on the old default-branch snapshot. This is a reusable authority/freshness policy gap and belongs in Skill-level guidance if not already owned there.

## Keep a maintenance authority map

Keep runtime policy, specialist detail, deterministic machinery, and evaluation evidence under different owners:

- `SKILL.md` owns the compact cross-domain process and routing contract;
- specialist `references/` own branch-specific engineering/design knowledge;
  During structural reference maintenance, run `scripts/reference_owner_audit.py <skill-root> --strict` to derive reachability and exact task-route co-load groups from the actual router/stack/control surfaces. Treat exact co-loading as a consolidation prompt, not a lexical merge rule; preserve explicitly documented bundles only when the files own different decisions.
- `scripts/` own deterministic calculations/checks that are worth executing repeatedly;
  Use `scripts/orphan_reference_gate.py <skill-root>` and `scripts/orphan_script_gate.py <skill-root>` during structural maintenance so tests/evals cannot accidentally serve as the only discovery path for packaged references or executables.
  Use `scripts/context_router_integrity_gate.py --skill-root <skill-root>`, `scripts/specialist_reachability_gate.py --skill-root <skill-root>`, and `scripts/reference_link_integrity_gate.py --skill-root <skill-root>` after routing/reference edits to prove the active selectors still resolve valid owners.
  When the bundled plugin runtime changes, run `scripts/runtime_starter_identity_gate.py <skill-root>` so package/lock/plugin/runtime constants and user-facing starter handoff docs describe the same development version.
  Treat the source tree and final archive as separate hygiene authorities. Before packaging, run `scripts/package_hygiene_gate.py <skill-root>` so test caches, bytecode, editor swaps, and other transient local artifacts are absent. After the packager finishes, run the same gate on the produced ZIP: `scripts/package_hygiene_gate.py <skill.zip>`. The archive gate must also verify one Skill entrypoint and a single top-level directory whose name matches `SKILL.md` frontmatter; a valid source tree packaged from a staging folder with the wrong directory name is still the wrong distributable identity. A packager or validator can create new bytecode/cache files after the preflight, so a clean source-tree check never substitutes for archive inspection. When a Python-based packager imports Skill scripts during validation, prefer disabling bytecode writes for that packaging process when the host allows it, then still verify the final archive.
- `agents/openai.yaml` owns user-facing Skill metadata for supported ChatGPT surfaces; after a material identity/scope edit, run `scripts/metadata_alignment_gate.py <skill-root>` so display metadata does not drift from the packaged Skill;
- behavior/trigger eval fixtures own examples of what the Skill must or must not cause;
- repository-specific facts stay in project evidence rather than being promoted into the global Skill.

When a change can be expressed by strengthening an existing owner, do that instead of creating a parallel source of truth. This is the maintenance contract that prevents a mature Skill from turning into sediment.

## Evaluate discipline under pressure, not only comprehension

Design-before-code, evidence-before-completion, freshness barriers, and authorization boundaries are discipline rules. Academic prompts that ask the agent to explain the rule are weak evidence. Add pressure cases that make the shortcut tempting and check whether the loaded Skill still changes behavior.

Useful pressure dimensions include:

- **time** - deadline language makes the shortcut attractive;
- **sunk cost** - substantial implementation already exists before the missing stage is noticed;
- **platform framing** - a technology noun such as Electron or React tempts the agent to route around product design;
- **local green checks** - build/tests pass even though the visible contract is not closed;
- **authority** - a user, issue, or prior implementation appears to encourage skipping the discipline without actually changing the outcome requirement;
- **tool limitation** - a preferred design/browser tool is missing, tempting the agent to skip the stage rather than use a lower-fidelity oracle.

For a material policy edit, prefer a RED/GREEN comparison when the environment can run fresh agent instances: run the same realistic prompt against the old/no-skill baseline and the candidate Skill, then compare the decision path and final evidence. Preserve the exact rationalization the baseline used when it exposes a reusable loophole, and write the smallest counter that closes that loophole without overfitting the example.

## Keep behavior and trigger regressions separate

When a Skill edit changes routing, stage gates, or invocation scope, preserve two kinds of regression evidence:

- **behavior pressure cases** - prompts where the Skill is already loaded and the failure is about what the agent does, including combined time/sunk-cost/platform/local-green pressures, tempting shortcuts, and expected stage/order behavior;
- **trigger cases** - substantive should-trigger and should-not-trigger prompts that test whether the frontmatter description selects the Skill at all.

Do not confuse them. A perfect workflow cannot help if the Skill never loads, and a perfectly triggered Skill can still execute the wrong workflow. Keep deterministic routing fixtures when a local router exists, and keep a small positive/negative trigger set for fresh-session model evaluation when the description materially changes.

## Bind evaluation to the loaded Skill identity

Use `scripts/skill_identity.py <skill-root> --json` when a deterministic package/source content identity helps bind an evaluation, installer check, or handoff to exact Skill bytes.

A running ChatGPT instance may still be using the Skill version that was loaded before the repository edit.

Therefore:

- use the current session as evidence for the pre-change behavior;
- validate repository structure, references, packaging, and benchmark artifacts immediately;
- do not claim the new behavior is model-validated until a fresh session/instance loads the updated Skill bundle and exercises the regression case;
- record three identities separately: **source revision** (the edited repository state), **installed/package identity** (the bytes actually installed or selected, preferably with content hash/version/path), and **session-loaded identity** (the exact Skill/prompt generation the model instance received);
- treat a repository edit, installer copy, host index, prompt cache, thread checkpoint, and running session as separate freshness boundaries unless the host proves they are linked;
- when the host supports reload/invalidation, verify the post-refresh identity instead of assuming the command succeeded; otherwise start a fresh instance;
- classify any run whose loaded Skill bytes cannot be established as **stale/unknown evidence**, not evidence for the candidate;
- keep source revision, packaged Skill identity, session-loaded identity, and evaluation result distinct.

## Capture dogfood telemetry from one journal

For long-run Skill evaluation, do not maintain a second hand-written runtime diary that can drift from the actual mission state. Use the existing engineering journal as the compact evaluation source of truth, then generate/report from it. At evaluation start, initialize it with `--skill-root` when those bytes are observable; this records a deterministic **observed Skill-root content identity** without pretending the host exposed an immutable session identity.

Record routing snapshots with `route-event --router-json <router-output>` and record only decision-relevant/failing host-tool outcomes with `tool-event` or `host-event`; normal runs need not journal every tool call. `resume` counts its own invocations, and `stats` reports frontiers/checkpoints/decisions/evidence, preemptions, route working-set maxima/unmatched signals, journaled tool outcomes, host events, and current stall state. Label tool/host counts as **journaled events**, not host-global totals unless the host truly routes every action through the journal.

Prefer `journal -> stats/final evidence report` over a separate hand-written runtime-evaluation diary. This keeps late-stage activity from disappearing when the agent continues after the last manual observation. Keep secrets, raw customer content, and unnecessary PII out of telemetry.

## Keep regression pressure proportional

When a Skill change is small and mechanism-specific, run a targeted regression first. Use the broader deterministic benchmark sample only when the change can affect general routing, autonomy, authorization, or validation behavior.

Read `references/veteran-engineer-benchmark.md` when performing controlled Skill comparisons. Use `scripts/benchmark_plan.py` and `scripts/benchmark_score.py` only when they improve the decision.

## Promotion rule

Do not add a permanent Skill rule merely because a single task was awkward. Promote a dogfood lesson only after classifying its owner, checking counterexamples, and establishing enough capability delta or consequence-based evidence to justify its context cost. Cross-repository recurrence is stronger evidence than one incident when the same decision boundary appears across materially different stacks/products, but correlated repositories, shared prompts, or one operator can repeat the same habit; treat recurrence as promotion evidence, not automatic proof.

Prefer this lifecycle:

`observation -> failure classification -> candidate mechanism -> placement decision -> smallest regression -> candidate/prior comparison -> promote / keep experimental / demote / delete`

Promotion to Kernel is the highest bar. Prefer strengthening an existing owner over adding another checklist; prefer a reference over Kernel for conditional knowledge; prefer deterministic machinery over prose for machine-checkable rules; and remove stale model-era scaffolding when ablation shows no loss.
