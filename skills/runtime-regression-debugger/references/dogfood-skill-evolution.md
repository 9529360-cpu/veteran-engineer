# Dogfood Skill Evolution

Use this when Veteran Engineer is maintaining its own Skill/runtime, or when the user explicitly asks to improve the Skill from evidence gathered during real repository work.

## Keep the live task primary

Treat real engineering work as the primary evaluation surface. Do not stop productive repository work merely to invent a separate synthetic benchmark phase.

Use this loop:

`real task -> observed friction or mistake -> classify the owner -> fix the real owner -> capture a minimal regression -> continue real work`

Synthetic benchmark runs are comparison tools, not a replacement for dogfooding. Run them when a Skill change needs controlled before/after evidence, not as ceremony after every repository task.

## Classify before changing the Skill

Every painful outcome is not a Skill-policy defect. Classify the observation first:

- **product/runtime bug**: active implementation violates its contract; fix runtime/source/tests at the owning layer;
- **test-oracle or fixture defect**: the validation itself lies, leaks state, or fails to isolate scenarios; repair the test rather than teaching the Skill the wrong product rule;
- **tool/environment limitation**: connector, sandbox, network, credential, or host capability caused the failure; adapt tooling or report the boundary;
- **project-specific fact**: ownership, release topology, generated source, or compatibility rule is useful only for this repository; keep it in project evidence/memory;
- **Skill-policy gap**: the reasoning/routing/authorization/evidence policy is reusable across repositories and the current instructions made the wrong behavior materially more likely.

Only the last category is a direct candidate for changing `SKILL.md` or a general reference. Do not encode one repository's accident as universal engineering law.

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

## Bind evaluation to the loaded Skill identity

A running ChatGPT instance may still be using the Skill version that was loaded before the repository edit.

Therefore:

- use the current session as evidence for the pre-change behavior;
- validate repository structure, references, packaging, and benchmark artifacts immediately;
- do not claim the new behavior is model-validated until a fresh session/instance loads the updated Skill bundle and exercises the regression case;
- keep source revision, packaged Skill identity, and evaluation result distinct.

## Keep regression pressure proportional

When a Skill change is small and mechanism-specific, run a targeted regression first. Use the broader deterministic benchmark sample only when the change can affect general routing, autonomy, authorization, or validation behavior.

Read `references/veteran-engineer-benchmark.md` when performing controlled Skill comparisons. Use `scripts/benchmark_plan.py` and `scripts/benchmark_score.py` only when they improve the decision.

## Promotion rule

Do not add a permanent Skill rule merely because a single task was awkward. Promote a dogfood lesson when it changes a reusable engineering decision and survives review against counterexamples, existing mechanism owners, and current benchmark coverage.

Prefer strengthening an existing rule over adding another overlapping checklist.