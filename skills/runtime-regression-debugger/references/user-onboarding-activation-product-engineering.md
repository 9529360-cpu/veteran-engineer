# User onboarding and activation product engineering

Use this when a product must guide a new, returning, invited, migrated, or newly entitled user from entry to a meaningful first successful outcome.

Onboarding is not a slideshow, checklist, or one-time modal. It is a product lifecycle that coordinates product state, education, prerequisites, permissions, persistence, recovery, analytics, and eventual removal of temporary guidance.

The central contract is:

`eligible user/context -> understandable first task -> required prerequisites -> meaningful product action -> authoritative success -> durable progress/completion -> next useful state`

Activation is the product outcome. Completing UI steps is only evidence when those steps actually produce that outcome.

## Start from first value, not tutorial completion

Define what the user should be able to accomplish after onboarding.

Examples of product outcomes include:

- create and successfully use the first project;
- connect a required data source and see useful data;
- invite a teammate and complete the first shared workflow;
- configure the minimum settings required for a successful run;
- publish or deliver the first real artifact;
- understand enough of the product to make a confident next decision.

Do not define activation as “clicked through all onboarding screens” unless clicking through is itself the real product outcome.

Record:

- target population and context;
- first-value outcome;
- prerequisites that genuinely block that outcome;
- optional education that should not masquerade as a prerequisite;
- authoritative completion fact;
- next useful destination after success.

## Separate setup, education, and activation

These are different concerns:

- **setup** changes durable product/account/workspace state;
- **education** explains how or why to use the product;
- **activation** is the meaningful user/product outcome;
- **progress UI** is a projection of what remains.

Do not persist tutorial UI state as the source of truth for setup or activation.

A user can know how to use a feature without having configured it. A user can complete required setup without reading every tip. A user can become activated through an alternate valid path that never touches a checklist item.

## Model onboarding as a lifecycle

Use explicit states rather than one `hasSeenOnboarding` boolean when the product can distinguish material conditions.

A common conceptual lifecycle is:

`eligible -> not-started -> in-progress -> blocked/needs-action -> first-value-achieved -> completed`

Additional product-specific states may include:

`skipped`, `dismissed`, `paused`, `expired`, `reset`, `reopened`, `migrated`, `not-applicable`.

Do not invent these states merely because they are common. Model only states that change user-visible behavior or durable product semantics.

For every material transition define:

- actor or system trigger;
- authoritative state owner;
- durable versus ephemeral state;
- retry/idempotency semantics;
- visible feedback;
- recovery/re-entry path.

## Choose the authority for progress and completion

Progress often spans UI, backend, account/workspace state, integrations, permissions, and asynchronous jobs.

Choose authority from the product invariant:

- server/domain state for prerequisites or accomplishments that must be durable, shared, permission-safe, or cross-device;
- client-local state for purely local education or transient presentation that can safely disappear;
- URL/navigation state for resumable step identity when appropriate;
- derived progress when durable product facts already prove completion and a second stored checklist would drift.

Prefer deriving checklist completion from authoritative product facts when those facts are reliable.

Examples:

- `workspace_created` should come from the workspace/domain owner, not a client checkbox;
- `integration_connected` should reflect the real validated connection state, not “user clicked Connect”;
- `first_report_generated` should reflect the completed domain artifact, not the submit event;
- “tour tooltip 3 dismissed” can remain local if it has no product meaning.

Do not create a second source of truth merely to render a progress bar.

## Stable identity, scope, and version

Define what onboarding belongs to:

- user;
- tenant/workspace/account;
- role;
- product/module;
- entitlement/plan capability;
- device only when onboarding truly is device-specific.

A user can belong to several workspaces with different setup states. Never reuse one global user flag when the product invariant is tenant-scoped.

Version onboarding when material semantics change. Define:

- stable onboarding program/version id;
- progress/completion identity;
- whether old completion remains valid after a new version;
- migration rules for existing progress;
- whether new capabilities cause re-entry;
- how old clients interpret a newer progress version.

Avoid resetting all users merely because copy or layout changed.

## Eligibility and re-entry

Eligibility should be a product rule, not “first login ever.”

Consider:

- new users in a new workspace;
- invited users joining an existing configured workspace;
- existing users who receive a new role or permission;
- customers gaining a new module/entitlement;
- migrated users whose old state satisfies some prerequisites;
- users returning after a long absence;
- users who previously skipped or dismissed guidance;
- users whose required integration or setup was later removed/broken.

Define whether onboarding is one-time, contextual, resumable, repeatable, or re-openable.

Do not force an experienced invited user through workspace-creation steps that another member already completed.

## Step design and progressive disclosure

Each step should earn its place by reducing uncertainty or enabling first value.

For every step identify:

- user question or product prerequisite it resolves;
- whether it is required, optional, skippable, or conditional;
- authoritative completion signal;
- prerequisite/dependency;
- expected failure/recovery path;
- whether the step can be performed elsewhere in the product;
- whether the user needs explanation before or after the action.

Prefer progressive disclosure and just-in-time guidance over a long upfront questionnaire when information is not needed yet.

Do not ask for configuration merely because the backend has a field. Delay choices until the user has enough context to make them.

## Skip, dismiss, pause, and reset semantics

These controls are product policy inputs, not generic UI decisions.

If the product allows them, define:

- what can be skipped versus what is a hard prerequisite;
- whether skip changes progress or only hides guidance;
- whether dismissed guidance can be reopened;
- whether progress expires;
- whether a user can reset/restart onboarding;
- whether admins/support can reset another user's onboarding;
- how reset interacts with already-created durable product state.

Never delete real user work just because onboarding was reset.

## Empty states as onboarding surfaces

The first empty state is often more important than a modal tour.

A strong empty state can explain:

- what this area is for;
- what a useful completed state looks like;
- the next meaningful action;
- prerequisites or permissions;
- a safe example/template/sample when appropriate;
- where to get help.

Do not show “No data” when the product knows the user has never configured the thing required to produce data.

Distinguish:

- truly empty;
- not configured;
- permission denied;
- loading;
- filtered-to-zero;
- failed to load;
- data not yet produced.

Each state may require a different onboarding/recovery action.

## Sample data, templates, and demo mode

Examples can reduce time-to-value, but they must not blur into real user state.

When providing samples/templates:

- label sample/demo content clearly;
- define whether it is copied, referenced, or disposable;
- prevent sample state from contaminating real analytics/billing/notifications;
- preserve tenant/privacy boundaries;
- let users transition from sample to real work without an unexplained dead end;
- define cleanup when sample data is no longer needed.

Do not fabricate “success” by counting a demo artifact as the user's real activation unless product policy explicitly defines it that way.

## Permissions, identity, and invitations

Onboarding must respect real authorization and collaborative context.

Handle:

- email/identity verification when required by the product;
- users invited before account creation;
- expired/revoked invitations;
- users whose role cannot perform a shown step;
- admin-only prerequisites;
- role changes during onboarding;
- tenant switching;
- multi-user race conditions such as two admins completing the same workspace setup.

Do not show a primary onboarding action that the current user is not authorized to complete without explaining the dependency and next path.

Use `account-identity-lifecycle-product-engineering.md`, `organization-membership-product-engineering.md`, and `security-multitenancy-patterns.md` when those owners are material.

## Asynchronous prerequisites

Some first-value steps include imports, provisioning, indexing, verification, background jobs, or provider callbacks.

Model meaningful states such as:

`not-started -> requested -> accepted -> processing -> succeeded`

with exceptional states such as:

`needs-user-action`, `retryable-failure`, `terminal-failure`, `partial-success`, `stale`.

Do not mark onboarding complete when an asynchronous prerequisite was merely accepted by a queue/provider.

Keep the user oriented while work continues:

- explain what is happening;
- allow safe navigation away when possible;
- provide resume/re-entry;
- surface retry or corrective action;
- avoid indefinite spinners;
- notify the user later only when notification policy supports it.

Use `async-edge-job-patterns.md` and `notification-delivery-product-engineering.md` when relevant.

## Error recovery and idempotency

First-run workflows are especially sensitive to partial completion because users do not yet understand the system.

Test:

- double click / duplicate submit;
- refresh/back/forward during a step;
- client timeout after server success;
- provider timeout after external acceptance;
- process restart during setup;
- lost network/offline transition;
- user closes and reopens the product;
- stale tab submits an older step;
- two devices continue the same onboarding;
- another member completes the shared prerequisite first.

Preserve one logical setup action across retries when the operation is idempotent. Reconcile from authoritative product state rather than making the user repeat a successful hidden action.

## Cross-device and cross-session continuity

Decide what should follow the user.

For durable onboarding progress define:

- storage authority;
- synchronization delay;
- generation/version;
- conflict policy;
- last completed durable milestone;
- safe resume destination.

Do not store server-owned setup progress only in localStorage when the product promises cross-device continuity.

Conversely, do not make every dismissed tooltip a durable backend record without a product reason.

## Accessibility and content

Onboarding often concentrates complex explanation, forms, dialogs, step indicators, and focus movement.

Validate:

- semantic step/progress indication;
- keyboard completion of the entire flow;
- focus on step transitions and errors;
- clear labels/instructions;
- errors associated with fields/actions;
- reduced-motion behavior for tours/animated guidance;
- zoom/text scaling and responsive layouts;
- screen-reader understandable progress and completion;
- content that explains user outcomes rather than implementation nouns.

Avoid patronizing copy or unnecessary celebration that delays the next useful action.

Use `accessibility-product-engineering.md`, `globalization-product-engineering.md`, and `visual-ui-quality-assurance-product-engineering.md` when material.

## Localization and regional differences

Account for:

- longer translated labels and explanations;
- locale/timezone/number/date input semantics;
- RTL layout;
- region-specific product availability or policy;
- translated screenshots/help content when included;
- content versioning when guidance changes independently from product state.

Do not encode region rules into presentation when they belong to product policy or eligibility authority.

## Measurement and activation analytics

Onboarding analytics should measure user outcomes and valid funnel transitions, not manufacture a success metric from UI clicks.

Define:

- eligible population;
- onboarding version;
- step/progress events only when useful for decisions;
- authoritative activation event or derived fact;
- abandonment/resume semantics;
- time-to-first-value;
- guardrails such as errors, support contacts, cancellations, accessibility failures, or setup reversals;
- treatment/exposure identity when experimenting with onboarding.

Do not let analytics events become the authority for onboarding completion.

Use `product-analytics-experimentation.md` for experiment and metric contracts.

## Existing-user and migration behavior

A new onboarding system often lands in a product with existing users.

Define:

- who is grandfathered as complete;
- how existing product state maps to new progress;
- whether incomplete old setup requires re-entry;
- whether old clients can coexist with new progress fields;
- how deprecated steps are retired;
- whether users are re-onboarded for a materially new capability.

Avoid resetting everyone because a new checklist was added.

## Lifecycle and cleanup

Onboarding creates temporary UI and state that easily becomes permanent debt.

Plan cleanup for:

- one-time modals/tours;
- deprecated step definitions;
- experiment variants;
- old progress versions;
- migration flags;
- sample/demo data;
- redundant analytics events;
- compatibility code after the old client/version window closes.

Keep permanent contextual help only when users still need it after activation.

## Verification scenarios

Test the states most likely to invalidate the onboarding contract. Useful scenario classes include:

- first-time-user;
- resume-after-exit;
- duplicate-submit;
- skip-or-dismiss;
- cross-device-resume;
- cross-tenant-isolation;
- invited-existing-workspace;
- permission-or-role-change;
- async-prerequisite-failure;
- timeout-after-success;
- existing-user-migration;
- long-localized-content;
- empty-vs-not-configured;
- re-entry-after-prerequisite-loss.

Do not force irrelevant scenarios into every product. Use the deterministic gate for the core scenario classes that protect progress, identity, recovery, migration, and first-value truth.

## Product contract record

For material onboarding work, record:

- experience outcome and first-value definition;
- eligibility and scope;
- progress/completion authority;
- version/generation identity;
- required/optional step semantics;
- resume/re-entry/skip policy sources;
- recovery and async behavior;
- role/tenant/cross-device behavior;
- existing-user migration;
- activation measurement;
- accessibility/localization expectations;
- lifecycle cleanup;
- falsifying test scenarios.

Use `scripts/onboarding_activation_gate.py` when this structure improves implementation or review discipline.

## Boundaries

- Do not equate tutorial completion with activation without a real product outcome.
- Do not store a second checklist truth when authoritative product state can derive progress.
- Do not invent skip, trial, pricing, verification, role, or eligibility policy.
- Do not reset or delete real user data merely to restart onboarding.
- Do not show unauthorized setup actions as if the user can complete them.
- Do not mark async setup complete before authoritative completion.
- Do not force existing experienced users through irrelevant first-run steps.
- Do not collect onboarding analytics that become a hidden authority for product state.
