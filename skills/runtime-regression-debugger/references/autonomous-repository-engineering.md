# Autonomous Repository Engineering Loop

Use this for implementation, repair, refactor, migration, or review tasks where the engineer is expected to carry work across a real repository without needing step-by-step user direction.

## Contents

- Convert the request into an executable contract
- Exercise proactive product stewardship under broad ownership
- Recover the active path and execution environment
- Create a bounded implementation plan
- Implement in evidence-producing increments
- Update the model when reality disagrees
- Run a pre-commit adversarial review
- Preserve continuity and treat tool failure as evidence
- Use a completion claim ladder
- Prefer completion over commentary

## 1. Convert the request into an executable contract

Before choosing files, write the smallest useful contract:

`actor -> intent -> authority -> state transition -> externally visible postcondition`

Add only material non-functional constraints: authorization, consistency, latency, durability, compatibility, accessibility, operability, or rollback.

Do not ask the user for facts the repository, issue, tests, schemas, runtime, or current documentation can answer cheaply. Ask only when ambiguity changes product semantics, authorization, risk acceptance, or irreversible business behavior.

## Exercise proactive product stewardship under broad ownership

When the user delegates broad product ownership with instructions such as "continue improving", "make the product better", "use your judgment", "you decide what to do next", or equivalent language, do not behave like a passive ticket executor. Treat that scope as authorization for ordinary reversible repository-local product improvements inside the authorized project, while preserving the separate authorization boundary for consequential actions.

Before choosing the next self-directed change, run a bounded product-quality sweep over the active product surface and the few adjacent seams that can materially affect it. Consider user-visible correctness, workflow completeness, interaction friction, visual hierarchy, spacing/density/alignment, responsive behavior, accessibility, copy/terminology, loading/error/empty/recovery states, user-visible performance/reliability, and repeated maintainability defects that cause product regressions.

When a frontend exists, do not consistently choose invisible backend work merely because it is easier to test. Inspect representative rendered surfaces when the environment permits. If a UI or UX defect is evidence-backed, high-leverage, and safely reversible, fix it even when the user did not enumerate that pixel, component, or screen explicitly.

Rank candidates by `user harm/frequency -> contract completeness -> evidence confidence -> reversibility -> implementation cost`. Severe correctness, security, data, billing, durability, accessibility, or reliability risk still outranks cosmetic polish.

Do not redesign a coherent interface from subjective taste alone. Preserve established brand/design-system conventions unless they are the defect, and do not invent product policy under the label of polish. An evidence-backed no-change decision is valid when a surface is already coherent or the proposed change would be aesthetic churn.

Read `references/proactive-product-stewardship.md` for the product-quality sweep and `references/frontend-product-patterns.md` for UI/design execution. Use `scripts/product_stewardship_gate.py` when a structured sweep record materially improves a broad self-directed mission.

## 2. Recover the active path

Establish:

- repository identity, instructions, and local constraints;
- branch/base/working-tree state;
- active entrypoint and caller chain;
- authoritative state owner;
- API/event/schema boundary;
- persistence and async owners;
- deployed/version coexistence when relevant;
- tests that claim to protect the behavior;
- runtime evidence if the symptom is production-only.

Before the first write, reconcile the user's explicit current repository target with the active checkout or connector identity using the strongest available root, remote/repository ID, and default-branch evidence. If they disagree, switch or reopen the correct repository and discard inherited branch, PR, SHA, CI, and file-ownership assumptions until they are re-established for that target. Read `project-takeover-engineering.md` for the detailed identity gate when multiple repositories or checkouts are in play.

Never infer liveness from file existence alone. Old code often survives after authority moved elsewhere.

Treat repository truth as versioned by a state epoch. After any successful remote mutation or automation trigger - merge, push, tag, workflow dispatch, release-bot/version commit, release publication, promotion, or deployment - consider the previous branch/release snapshot stale. Before the next consequential action, refresh the relevant remote HEAD/merge SHA, version/tag/release/workflow state, and any publication/deployment identity that can change the decision. A successful merge or tool call does not update the local checkout or cached model by implication.

Treat pull-request ancestry as another versioned authority. If a stacked PR's base branch is merged, rebased, force-updated, or squash-merged, do not infer that the child PR now contains only its intended delta. Re-fetch the live target, child head, and merge-base; compare the child against the new target; and re-establish the intended write set from that current diff. Squash/rebase can preserve semantics while rewriting commit ancestry, so old parent SHAs, merge refs, and CI attached to them are historical evidence only. Rebuild, rebase, or retarget the child cleanly when needed, then validate the new exact head/base combination before relying on it.

Also discover the execution environment actually available now: source/search/history access, mutation access, shell/compiler/test/browser/runtime, public network, external systems such as CI/cloud/observability, and the authorization boundary. Do not infer web, desktop, Codex, IDE, connector, or CI capabilities from product names or prior sessions. Prefer the least consequential tool that can produce the needed evidence: read/search -> local inspect/test -> local edit -> isolated branch/commit -> remote PR -> staging mutation -> production mutation.

## 3. Create a bounded implementation plan

A good plan names boundaries, not every edit.

For each step record:

- invariant or user-visible behavior preserved/changed;
- owner being modified;
- validation that can falsify the step;
- compatibility dependency on preceding/following steps;
- rollback or forward-repair path when state is durable.

Prefer one thin vertical slice through the riskiest real boundary before broad implementation.

For consequential actions keep three questions separate: **capability** (can the tool do it), **authorization** (was this action class authorized), and **advisability** (does current evidence justify it). A powerful token or connector is not permission. Explicit authorization is required for production traffic/deployments, destructive data changes, credential/access-policy changes, monetary effects, external publication/release, or remote merge/push when not implied by the request. Finish every safe lower-boundary step before surfacing the smallest remaining authorization blocker.

## 4. Implement in evidence-producing increments

After each meaningful increment, run the cheapest check that could prove the idea wrong. Do not wait until the end to discover that the active path, schema assumption, framework behavior, or failure model was wrong.

A useful sequence is often:

`characterization -> smallest owner change -> focused test -> integration boundary -> wider regression -> complete diff review`

Do not mechanically follow this order when another probe is cheaper or stronger.

## 5. Update the model when reality disagrees

When a test, runtime probe, or real client contradicts the plan:

1. name the assumption that failed;
2. record the new evidence;
3. retire or rewrite the affected hypothesis;
4. identify behaviorally equivalent fixes that are now unsupported;
5. choose a new discriminator before another patch.

Do not preserve sunk-cost architecture because code has already been written.

## 6. Run a pre-commit adversarial review

Before claiming implementation complete, ask only the relevant questions:

- What happens if the client retries after an unknown outcome?
- What happens if the old and new versions coexist?
- What happens if work is duplicated, delayed, reordered, or canceled?
- What happens if the process crashes between durable steps?
- What happens if the caller selects another tenant/resource?
- What happens if the dependency returns slowly, partially, or not at all?
- What happens if rollback occurs after a durable schema/data transition?
- What state becomes stale after this mutation?
- What temporary compatibility mechanism now needs an owner/removal trigger?
- What resource grows without a bound?

Do not invent failure modes unrelated to the changed mechanism.

## 7. Preserve continuity and treat tool failure as evidence

For long investigations, checkpoint only material state: contract, phase, next evidence-producing action, disproven assumptions, and real blockers. Use `scripts/engineering_journal.py` when that prevents repeated work; never record secrets or unnecessary user data.

If a connector, runner, browser, registry, network, or production boundary is unavailable, continue valid lower-boundary work, name the unavailable evidence boundary, and lower the completion claim rather than pretending a weaker substitute passed. A tool call being accepted proves only that the call was accepted; verify the actual diff, exit status, artifact, runtime state, or external effect.

## 8. Use a completion claim ladder

Report the strongest state actually proven:

- **implemented**: source changes are complete enough for review;
- **focused-validated**: focused tests/checks for the changed owner passed;
- **integration-validated**: real boundary semantics were exercised;
- **end-to-end-validated**: critical user-visible flow passed in a representative environment;
- **package/release-candidate-validated**: exact artifact/build candidate passed relevant gates;
- **deployed**: deployment occurred, without implying user-visible correctness;
- **production-verified**: black-box and critical invariant evidence confirm the live contract.

Never collapse these into a single word such as "done" or "fixed" when the distinction matters.

## 9. Prefer completion over commentary

When authorized to implement, spend effort on repository inspection, code, tests, and evidence rather than producing a large speculative plan for the user. Surface blockers and material discoveries, but do not require the user to drive ordinary engineering steps.

Stop only for:

- missing authorization for a consequential action;
- product semantics that cannot be recovered safely;
- unavailable secrets/credentials/environment that are required for the next evidence boundary;
- destructive/irreversible choices whose risk acceptance belongs to the user/owner;
- evidence showing the requested change would violate a higher-priority invariant.
