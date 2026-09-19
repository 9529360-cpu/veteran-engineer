# Feature flags and progressive delivery


## Contents

- Delivery contract
- Define the flag before writing branches
- Choose evaluation authority deliberately
- Stable subject identity and stickiness
- Version configuration and stale reads
- Progressive ramping
- Kill switch semantics
- Flag dependencies and precedence
- Mixed-version clients and services
- Server/client divergence
- Experiments versus rollout safety
- Overrides and support controls
- Observability
- Verification
- Lifecycle and deletion
- Boundaries

Use this when a feature, behavior, migration, operational control, experiment treatment, or compatibility path is exposed gradually through a flag/config control plane rather than switched globally in one atomic release.

Product analytics owns whether a measured change improved outcomes. This reference owns the runtime delivery semantics: **who gets what behavior, from which authority, at what version, under what failure mode, how exposure changes safely, and how the temporary control is eventually removed.**

A feature flag is production control-plane state, not a harmless boolean.

## Delivery contract

Model the flow as:

`flag definition -> eligible subject -> authoritative evaluation -> versioned assignment/config -> application behavior -> guardrail observation -> ramp/pause/rollback -> full adoption -> flag cleanup`

For experiment-backed rollouts, keep assignment/exposure analysis in `product-analytics-experimentation.md`. For deployment/control-plane safety, also use `operability-control-plane-contract.md` and `release-promotion-patterns.md` when relevant.

## Define the flag before writing branches

For every material flag record:

- stable flag id/name;
- purpose: release, experiment, ops kill switch, migration, permission-like entitlement proxy, or temporary compatibility seam;
- authoritative owner and mutation path;
- value type and allowed variants/config schema;
- default/failure behavior;
- evaluation subject: user, tenant, workspace, device, request, region, cohort, or another stable unit;
- tenant/account isolation boundary;
- stickiness requirement;
- rollout/version identity;
- lifecycle state and removal owner;
- whether changing the flag can trigger irreversible or externally visible effects.

Do not use a feature flag as a second authorization or entitlement system unless the product explicitly defines it that way and the trusted server-side authority enforces it. UI visibility is not permission.

## Choose evaluation authority deliberately

The same flag evaluated in multiple places can produce contradictory product behavior.

Choose the authority from the invariant:

- server/domain evaluation when the flag controls authorization-sensitive, billing-sensitive, durable mutation, data-shape, workflow, or cross-client behavior;
- client evaluation for presentation-only behavior that cannot create unauthorized or incompatible durable state;
- edge/gateway evaluation when routing itself is the controlled behavior and downstream semantics are compatible;
- build-time configuration only when runtime variation is intentionally impossible.

If server and client both need the result, define which side is authoritative and how the other receives/version-checks the decision. Do not let a stale client recompute a materially different answer from old local config.

## Stable subject identity and stickiness

Percentage rollout is deterministic assignment, not random sampling on every request.

Define:

- stable subject key;
- namespace/salt/version used by the bucketing function;
- exact percentage or cohort rule;
- whether assignment must remain sticky across sessions/devices/workers;
- what happens when subject identity changes or anonymous identity becomes authenticated;
- whether re-bucketing is allowed when rollout rules change;
- how team/workspace products avoid members of one shared object seeing incompatible variants.

A request-level random decision is usually wrong for user-visible behavior because the same user can oscillate between variants.

Changing the hash salt, flag id, subject key, or allocation algorithm can silently reshuffle cohorts. Treat those as rollout-semantic changes, not refactors.

## Version configuration and stale reads

Flag systems are distributed configuration systems. Assume evaluations can be stale, delayed, duplicated, or temporarily unavailable.

Carry an evaluation/config version or generation when stale work can matter. Define:

- cache TTL or streaming-update semantics;
- startup behavior before fresh config arrives;
- stale-config acceptance window;
- last-known-good policy;
- fail-open/fail-closed/default behavior per flag class;
- how invalid configuration is rejected;
- whether a worker/job captures the flag decision at enqueue time or reevaluates at execution time;
- how long-lived clients learn that a rollout or kill switch changed.

Do not choose one global default such as “flags fail open.” A cosmetic UI flag and a destructive migration flag can require opposite behavior.

## Progressive ramping

A ramp is a state machine, not “change 10 to 25 to 100.”

Useful states include:

`off -> internal -> canary cohort -> small percentage -> larger percentage -> full -> cleanup`

Exceptional states include:

`paused`, `rolled-back`, `killed`, `degraded`, `config-invalid`, `provider-unavailable`.

For each stage define:

- eligible cohort and percentage;
- minimum observation/evidence needed before advancing;
- health guardrails;
- product guardrails when relevant;
- data/schema compatibility constraints;
- maximum acceptable error/latency/support burden or other stop signal;
- who/what may advance, pause, or reverse the rollout;
- rollback or kill-switch effect and expected propagation time.

Do not auto-advance solely because time elapsed. Time can be a minimum observation condition, not proof of safety.

## Kill switch semantics

A kill switch must be engineered as a real recovery control.

Define:

- trusted mutation owner;
- propagation target and expected convergence time;
- behavior for cached/offline/partitioned clients;
- whether already-started work may finish;
- whether durable writes made under the enabled state remain valid;
- how stale workers are fenced from continuing destructive/new behavior;
- observability proving the switch took effect across the relevant fleet/cohort.

A dashboard toggle is not a proven kill switch until the active runtime path consumes it with the intended semantics.

Do not route irreversible data migrations or money/value movement through a kill switch unless disabling new execution plus repairing already-created effects is explicitly defined.

## Flag dependencies and precedence

Multiple flags create a configuration graph.

When flags depend on each other, define:

- dependency direction;
- precedence when parent/child values disagree;
- whether one flag is a prerequisite, override, or independent guardrail;
- cycle prevention;
- safe default when one dependency is stale or absent;
- whether evaluation is atomic for a related set of flags.

Avoid “flag soup” where the same behavior is controlled by several uncoordinated booleans in different services.

If a behavior needs a real state machine, model it as domain state instead of encoding every transition as combinations of flags.

## Mixed-version clients and services

Progressive delivery often means old and new actors coexist.

Model combinations that can occur:

- old client + new server;
- new client + old server;
- old worker processing data written by new code;
- new worker seeing old flag/config shape;
- flag on while a dependent schema/API is only partially deployed;
- flag off after new-format durable state already exists.

Prefer additive contracts before enabling the flag. Sequence schema/API compatibility before behavior exposure.

Do not use a flag to hide an otherwise incompatible deployment order. The disabled path must actually remain compatible.

## Server/client divergence

If a server-authoritative decision is projected to a client, make disagreement visible and recoverable.

Examples:

- include effective capability/config version in the response or bootstrap payload;
- invalidate stale client caches after identity/tenant changes;
- avoid rendering an enabled action that the server will reject because the client used stale flag state;
- handle a server-side kill while an old client still believes the feature is enabled;
- never let a client-supplied flag value authorize a protected server transition.

The UI should present the authoritative product state, not merely the last locally evaluated flag.

## Experiments versus rollout safety

A feature flag can carry an experiment treatment, but the two contracts are different.

Experimentation needs:

- eligibility/randomization;
- stable assignment;
- exposure semantics;
- primary/guardrail metrics;
- analysis and decision rules.

Progressive delivery needs:

- runtime evaluation authority;
- safe defaults and stale-config behavior;
- compatibility;
- ramp/pause/rollback control;
- kill switch;
- config audit;
- lifecycle cleanup.

Do not infer causal validity from a safe rollout, and do not infer rollout safety from a statistically valid experiment.

## Overrides and support controls

Manual tenant/user overrides can be useful for support, previews, or incident response, but they are durable policy inputs.

Define:

- who can create/remove an override;
- exact subject/tenant scope;
- expiry or review condition;
- precedence relative to percentage rules and kill switches;
- audit trail;
- whether the override survives flag version changes;
- how stale overrides are discovered and removed.

Do not leave one-off support overrides as undocumented permanent behavior.

## Observability

Correlate decisions across:

`flag id/version -> subject/cohort -> effective value -> evaluator/runtime -> source build -> visible/business outcome`

Useful signals include:

- evaluation counts by value/cohort/version;
- percentage distribution and unexpected skew;
- stale-config age;
- provider/control-plane errors;
- override counts and age;
- rollback/kill-switch propagation lag;
- old/new client or service versions by effective flag state;
- guardrail metrics used for advance/pause/reverse decisions.

Do not log secrets or unnecessary personal data merely to explain assignment. Prefer stable internal subject ids or aggregated cohort diagnostics.

## Verification

Test the flag mechanism where it can fail.

Useful scenarios include:

- stable assignment across repeated evaluations;
- tenant/user scope isolation;
- percentage ramp changes without accidental reshuffle when stickiness is required;
- stale config and provider outage;
- invalid config/schema;
- kill-switch propagation;
- old client + new server and new client + old server;
- server/client disagreement;
- flag dependencies/precedence;
- manual override expiry/removal;
- rollback after the new path created durable state;
- full rollout followed by removal of the flag and dead branch.

For user-visible behavior, verify representative rendered states when practical. For server/durable behavior, cross the real domain/API/storage boundary rather than asserting only the flag helper.

## Lifecycle and deletion

Every temporary flag needs an end state before it is created.

Record:

- success condition for full adoption;
- earliest safe deletion point;
- owner responsible for cleanup;
- code/config/schema/instrumentation branches to remove;
- old-client/version window that blocks deletion;
- how overrides are drained;
- which metrics/events become unnecessary after cleanup.

After full adoption, collapse the code to the final authoritative path. Delete flag evaluation, dead variants, temporary schema readers/writers, compatibility branches, and experiment-only instrumentation when no longer needed.

A permanent operational control is not “forgotten cleanup,” but it still needs explicit ownership, audit, safe defaults, tests, and runbook semantics.

## Boundaries

- Do not treat feature flags as authorization, billing entitlement, or durable domain state unless explicitly designed as that authority.
- Do not enable an incompatible code/schema combination merely because the feature is hidden from most users.
- Do not rely on request-level randomness for sticky user-visible behavior.
- Do not assume flag-provider availability or freshness.
- Do not call a dashboard toggle a kill switch without proving runtime propagation.
- Do not keep rollout/experiment flags indefinitely after the decision.
- Do not let analytics assignment data become a second runtime authority for the effective product behavior.
