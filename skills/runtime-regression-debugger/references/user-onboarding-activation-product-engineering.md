# User onboarding and activation product engineering

Use this when a product must guide a new, returning, invited, migrated, or newly entitled user to a meaningful first successful outcome.

Onboarding is not a slideshow or checklist. The product contract is:

`eligible user/context -> required prerequisites -> meaningful product action -> authoritative success -> durable progress/completion -> next useful state`

Activation is the product outcome. UI-step completion is evidence only when it proves that outcome.

## Start from first value

Define the smallest real outcome that makes the product useful to the target user. Examples include a successful first project run, a validated integration that produces useful data, or completion of the first real collaborative workflow.

Record only what changes implementation:

- eligible population and subject scope;
- first-value outcome and authoritative completion fact;
- prerequisites that genuinely block it;
- optional education that does not block it;
- next useful destination after success.

Do not define activation as “finished the tour” unless the tour itself is the product outcome.

## Keep setup, education, activation, and progress separate

- **setup** changes real product/account/workspace state;
- **education** explains the product;
- **activation** is the meaningful outcome;
- **progress UI** is a projection of what remains.

Prefer deriving progress from authoritative product facts. Do not create a second checklist truth merely to render a progress bar.

Examples: a connected integration comes from validated integration state, not from clicking Connect; a completed first run comes from the domain result, not from submitting the form. Presentation-only tips may remain local when losing them has no product consequence.

## Scope identity and re-entry correctly

Choose the subject from the product invariant: user, tenant/workspace/account, role, module/entitlement, or device only when truly device-specific. Never use one global user flag when setup is workspace-scoped.

Version onboarding only when material semantics change. Define whether old completion remains valid, how existing progress maps forward, and whether a new role/capability or a lost prerequisite causes re-entry.

Eligibility is not synonymous with first login. Invited users, migrated users, newly entitled users, role changes, and already-configured workspaces may enter at different points or need no onboarding at all.

## Model only states that change behavior

Use explicit lifecycle states when one boolean cannot represent real product semantics. A common shape is:

`eligible -> not-started -> in-progress -> blocked/needs-action -> first-value-achieved -> completed`

Add skipped, dismissed, paused, reset, migrated, or not-applicable only when those states change product behavior.

For each material transition know the actor, authoritative owner, durable effect, retry behavior, visible feedback, and re-entry path.

## Make every step earn its place

A step should either remove uncertainty or enable first value. For each material step determine:

- required, optional, conditional, or skippable;
- authoritative completion signal;
- prerequisite/dependency;
- alternate valid path elsewhere in the product;
- failure and recovery behavior.

Skip, dismiss, pause, reset, verification, pricing, and role rules are product policy. Do not invent them as generic UI behavior. Resetting onboarding must never delete real user work.

Prefer just-in-time guidance and meaningful empty states over long upfront questionnaires or modal tours. Distinguish truly empty, not configured, permission denied, loading, filtered-to-zero, failed load, and data-not-yet-produced when those states lead to different actions.

## Preserve continuity and safe recovery

Durable onboarding progress must survive the boundaries the product promises: refresh, process restart, another device, tenant switching, or returning later.

Use server/domain authority for progress that must be shared, permission-safe, cross-device, or durable. Keep presentation-only state local when appropriate.

Exercise the failure modes that can duplicate or hide real work:

- duplicate submit;
- timeout after authoritative success;
- refresh/back/forward during setup;
- async prerequisite accepted but not completed;
- stale tab or device;
- two users completing a shared prerequisite;
- exit and later resume.

Reconcile from authoritative product state before asking the user to repeat an action that may already have succeeded. For async prerequisites, accepted/queued is not completed.

Use `async-edge-job-patterns.md`, `security-multitenancy-patterns.md`, and the relevant identity/membership owner when those mechanisms are active.

## Existing users and migration

A new onboarding flow lands into existing state. Define:

- who is already complete from current product facts;
- how old progress or product state maps to the new model;
- whether old/new clients can coexist;
- whether incomplete old setup requires re-entry;
- when deprecated steps and compatibility paths can be removed.

Do not reset everyone because a checklist, copy, or layout changed.

## Measure activation, not clicks

Analytics should explain the path to value, not become the authority for completion.

Useful measures include eligible population, onboarding version, time-to-first-value, abandonment/resume, decision-useful progress events, and guardrails such as setup errors, permission failures, support burden, cancellations, or accessibility failures.

The authoritative activation event or derived fact must come from the product outcome. Use `product-analytics-experimentation.md` when experiment assignment or causal analysis is material.

## Quality and verification

Validate the real flow with representative identity, permissions, content, and device/session boundaries. Use the dedicated accessibility, globalization, visual-quality, async, auth, or notification references only when those mechanisms are active instead of duplicating their rules here.

Choose scenarios that can falsify the active onboarding contract. Common high-value cases are:

- first-time user reaches first value;
- exit and resume;
- duplicate submit or timeout-after-success;
- invited user in an existing workspace;
- cross-tenant isolation;
- permission/role change;
- async prerequisite failure;
- existing-user migration;
- empty versus not-configured;
- re-entry after prerequisite loss.

Do not force irrelevant scenarios into every product.

## Lifecycle cleanup

Onboarding often creates temporary tours, progress versions, migration flags, sample data, experiments, compatibility code, and extra analytics. Give temporary mechanisms an owner and removal condition. Keep permanent contextual help only when users still need it after activation.

## Boundaries

- Do not equate tutorial completion with activation without a real product outcome.
- Do not create a second source of truth for progress when authoritative product state can derive it.
- Do not invent eligibility, skip, verification, pricing, role, or entitlement policy.
- Do not delete real user data to reset onboarding.
- Do not show unauthorized actions as if the user can complete them.
- Do not mark async setup complete before authoritative completion.
- Do not force experienced or already-configured users through irrelevant first-run steps.
- Do not let analytics events become hidden product-state authority.
