# Product analytics and experimentation

Use this when the engineer must improve a product through trustworthy product metrics, event instrumentation, funnels/cohorts, experiments, or measured rollouts. Treat this as the **Improve** stage of the same full-stack workflow:

`Understand -> Design -> Build -> Validate -> Improve`

Do not confuse product analytics with infrastructure observability. Product analytics asks whether users reach intended outcomes and whether a product change improves them. Operational telemetry asks whether the system is healthy and why it fails. A mature change may need both, but they have different identities, retention needs, and decision contracts.

## Contents

- Product-improvement contract
- Start from a decision, not an event list
- Metric contracts
- Event and exposure contracts
- Authority and delivery semantics
- Funnels, cohorts, and retention
- Experiment design
- Rollouts and feature flags
- Data quality and trust
- Privacy, consent, and minimization
- Implementation across the stack
- Verification and evidence
- Interpret results without overclaiming
- Close the improvement loop
- Reporting contract
- Boundaries

## Product-improvement contract

Start from a decision the product team may actually make:

`product question -> measurable outcome -> instrumentation/exposure authority -> trustworthy data -> analysis -> decision -> engineering action -> follow-up evidence`

For experiments, extend the contract:

`hypothesis -> eligibility -> stable assignment -> exposure -> outcome/guardrails -> analysis -> ship/stop/iterate -> cleanup`

Capture only details that can change the decision:

- user or account population being measured;
- exact product behavior or outcome under study;
- metric definitions, units, denominators, windows, and segments;
- event/exposure identity and authoritative emission point;
- late, duplicate, missing, offline, bot/test, and retry behavior when material;
- experiment eligibility, randomization unit, variants, exposure semantics, and stop/rollback rules;
- privacy/consent/retention constraints;
- data-quality checks that would invalidate the result;
- the action to take for the plausible result classes.

Do not create instrumentation merely because a field or click exists. Every durable event or metric should have a decision, product insight, experiment, audit, or support use that justifies its cost and privacy surface.

## Start from a decision, not an event list

A useful analytics request is not "track everything on this page." Reduce it to one or more questions such as:

- Do new workspaces reach first successful project creation?
- Where do eligible users abandon onboarding?
- Does the new search flow improve successful task completion without increasing error rate?
- Does the redesigned checkout reduce completion time while preserving payment success and support contacts?
- Does a feature rollout degrade retention or increase destructive reversals?

For each question define the intended decision before implementation. Examples:

- ship to 100% if the primary outcome improves and guardrails remain inside bounds;
- iterate if activation improves but downstream retention does not;
- stop the rollout if failures or support burden cross the rollback threshold;
- gather more evidence when event quality or exposure identity is unreliable.

Avoid vanity metrics whose movement would not change product action.

## Metric contracts

Treat a product metric as a versioned semantic contract, not a dashboard label.

For every material metric define:

- stable metric id/name;
- role: primary outcome, guardrail, or diagnostic;
- population/eligibility;
- numerator and denominator when it is a rate;
- unit of analysis: user, account, workspace, session, order, project, etc.;
- aggregation: count, distinct count, sum, mean, percentile, rate, ratio, retention, time-to-event;
- observation window and cohort anchor;
- timezone/calendar semantics when time boundaries matter;
- inclusion/exclusion rules, including staff/test/bot traffic;
- segmentation rules that are allowed for decisions;
- source events/tables and freshness expectation;
- known failure modes or interpretation limits.

Keep one definition authoritative. If a dashboard, experiment engine, warehouse model, and application each encode the same metric differently, reconcile or version them rather than calling the disagreement noise.

Primary metrics should represent the intended user/product outcome. Guardrails protect important adjacent outcomes such as reliability, latency, abuse, support burden, cancellations, refunds, accessibility failures, or downstream retention. Diagnostics explain *why* a primary/guardrail moved but should not become post-hoc success criteria.

## Event and exposure contracts

Events should describe meaningful state transitions or product facts, not implementation trivia.

Prefer semantic names such as:

- `project_created` after authoritative creation commits;
- `onboarding_completed` after the product accepts the final step;
- `search_result_opened` when a result is intentionally selected;
- `experiment_exposed` when the user actually receives behavior capable of affecting the outcome.

Avoid coupling durable analytics to DOM selectors, component names, route implementation details, or button text when the product meaning is stable across UI refactors.

For each material event define:

- event id/name and version;
- semantic trigger and authoritative emitter;
- actor/object/tenant scope;
- event timestamp and server-receipt timestamp when late delivery matters;
- idempotency/dedupe identity when retries can duplicate delivery;
- required properties and allowed enums;
- privacy classification and purpose;
- retention expectation;
- schema evolution rules;
- whether offline/batched delivery is allowed;
- expected loss/duplication semantics.

An **exposure** event is special. Emit it when an eligible unit actually receives a variant, not merely when assignment was computed or a flag was evaluated somewhere that cannot affect the user.

## Authority and delivery semantics

Choose the emission authority from the product invariant.

Use server/domain emission for facts such as successful creation, payment capture, permission changes, durable workflow completion, or other transitions whose truth belongs to authoritative state. Client events can describe visible interactions, impressions, navigation, abandonment, or UI-only states that the server cannot observe directly.

Do not let a client event overwrite authoritative business truth. When client and server events both describe one journey, model their relationship explicitly.

Analytics delivery is often at-least-once or best-effort. Decide what that means for each metric:

- duplicates should carry stable dedupe identity when they would materially bias a metric;
- late events need a defined watermark/backfill policy;
- offline events need ordering/timestamp semantics;
- retries must not fabricate new logical events;
- dropped diagnostic events may be acceptable while dropped exposure/outcome events can invalidate an experiment.

Instrument the user-visible transition, not just the code path that happened to execute today.

## Funnels, cohorts, and retention

A funnel is a sequence of semantic milestones under one eligibility definition.

For each step define:

- eligible population and starting anchor;
- whether steps must be ordered;
- allowed time between steps;
- whether repeated steps count once or multiple times;
- identity transitions such as anonymous -> authenticated;
- cross-device/session behavior;
- late-event handling;
- exclusion rules;
- whether the funnel is user-, account-, order-, or object-based.

Do not compare funnel percentages built on different denominators.

For cohorts and retention, define the cohort anchor and return condition precisely. Examples include account-created week, first-success week, paid-start month, or feature-first-use day. Distinguish product retention from mere login/activity when the intended outcome is more specific.

Before attributing a drop to product quality, check instrumentation changes, eligibility shifts, acquisition mix, outages, seasonality, and data freshness.

## Experiment design

Run an experiment only when randomization is feasible, the decision is worth the complexity, and the product can tolerate variant coexistence.

A useful experiment plan states:

- falsifiable hypothesis;
- eligible population;
- randomization unit;
- assignment authority and stickiness;
- control and treatment variants;
- exposure semantics;
- one primary metric chosen before reading results;
- guardrail metrics;
- intended segments, if any, chosen before analysis;
- expected effect direction and a practically meaningful effect size;
- analysis window and minimum runtime constraints when material;
- decision rule;
- operational rollback trigger;
- cleanup plan for assignment/flag/instrumentation after the decision.

Randomize at the unit that prevents harmful cross-contamination. For team/workspace features, user-level randomization may create mixed experiences inside one shared object. For network effects or marketplace systems, ordinary independent assignment may be invalid.

Do not call a feature flag an experiment merely because two values exist. An experiment needs controlled eligibility/assignment, trustworthy exposure, predeclared outcomes, and an analysis/decision contract.

Avoid changing eligibility, metric definitions, exposure semantics, or treatment behavior midway without versioning the experiment. If the experiment changes materially, start a new analysis identity or explicitly model phases.

## Rollouts and feature flags

Measured rollout can be preferable to an experiment when the main goal is safety rather than causal comparison.

A rollout plan should define:

- eligible scope and ramp sequence;
- authoritative flag/config owner;
- cohort stickiness where user experience requires it;
- health and product guardrails;
- rollback/kill-switch boundary;
- expected old/new coexistence;
- migration or data compatibility constraints;
- criteria to advance, pause, or reverse;
- flag removal condition after full adoption.

Do not leave permanent flags, duplicate event schemas, or experiment-only branches after the decision has been made.

## Data quality and trust

Treat product data as another production system with correctness failure modes.

Before trusting movement, check for:

- missing or duplicated events;
- schema/version drift;
- client/server clock skew;
- late-arriving data;
- bot, staff, test, or synthetic traffic;
- identity merge/split errors;
- missing exposures or outcomes;
- exposure before eligibility;
- sample-ratio mismatch in experiments;
- event volume discontinuities after deployments;
- broken joins or dimension cardinality explosions;
- backfills that changed historical comparability;
- warehouse/dashboard freshness lag.

A green application test does not prove analytics correctness. Verify emitted event shape and the receiving/aggregation boundary available in the environment.

When experiment assignment counts differ materially from the configured allocation, investigate assignment/exposure/data loss before interpreting treatment effects.

## Privacy, consent, and minimization

Product analytics is not an excuse to copy application state into telemetry.

Apply data minimization:

- collect only properties needed for defined product decisions;
- never persist credentials, auth headers, session tokens, signed URLs, secrets, or raw sensitive payloads;
- avoid free-form text when bounded enums or derived categories answer the question;
- prefer internal stable identifiers over email/phone/name when direct identity is unnecessary;
- classify personal/sensitive fields and record purpose/retention;
- respect product/region consent and opt-out behavior;
- keep analytics authorization/tenant boundaries aligned with the product;
- restrict who can query sensitive segments;
- define deletion/retention behavior where required.

Do not infer or create sensitive user attributes merely to improve segmentation.

## Implementation across the stack

Instrument the smallest complete path that owns the product fact:

`UI interaction -> client state -> API/domain transition -> event/exposure emission -> transport/ingestion -> modeled metric -> decision surface`

Choose only the layers required by the measurement contract.

For client instrumentation:

- keep event names semantic and centralized enough to avoid spelling drift;
- avoid emitting duplicate events from rerenders/effect replays;
- bind events to the actual completed interaction/state transition;
- include stable object/experiment ids, not volatile component identities;
- test navigation/unmount/retry behavior when delivery can be lost or duplicated.

For backend instrumentation:

- emit successful business facts only after the authoritative transition is known;
- distinguish requested/accepted/completed/failed states for async work;
- do not emit success before a transaction/external effect whose failure would make the fact false;
- preserve event identity across retries when the logical action is the same.

For analytics schemas and pipelines:

- evolve additively when old/new producers overlap;
- version incompatible semantic changes;
- update downstream models/dashboards/experiments before deleting old fields;
- make ownership and deprecation explicit.

## Verification and evidence

Validate the measurement mechanism where it can fail.

Useful checks include:

- unit/contract test for event schema and semantic trigger;
- integration test that the real product transition emits exactly the intended logical event;
- duplicate/retry test where replay is plausible;
- browser/E2E verification for client interaction/exposure events;
- ingestion or provider smoke check when accessible;
- query/model test for denominator, joins, cohort window, and exclusions;
- experiment assignment/exposure check across control/treatment;
- privacy test proving forbidden/sensitive values are absent or minimized;
- dashboard/query spot-check against a small known fixture.

Bind evidence to the exact event/metric/experiment version and source build when definitions can change.

For a structured product-improvement proposal or experiment handoff, use `scripts/product_improvement_gate.py` to check that the decision question, metric/guardrails, data-quality checks, experiment/rollout semantics, and follow-up action are explicit. Treat it as a completeness check, not a substitute for product judgment.

## Interpret results without overclaiming

Separate:

- **descriptive**: what happened in observed product data;
- **diagnostic**: evidence about where/for whom it happened;
- **causal**: what a valid experiment or other causal design supports;
- **unknown**: explanations not distinguished by the available evidence.

A pre/post dashboard change is not automatically caused by the release. Acquisition mix, seasonality, outages, pricing, concurrent changes, instrumentation drift, and novelty can move the same metric.

For experiments, do not promote exploratory subgroup wins into the primary conclusion after the fact. Mark them as hypotheses for follow-up unless the analysis plan predeclared them.

Statistical significance is not product significance. Consider effect size, uncertainty, guardrails, operational cost, long-term behavior, and whether the metric represents the intended user outcome.

## Close the improvement loop

The result should change the product or retire the measurement.

For each completed analytics/experiment cycle record:

`question -> evidence -> result -> confidence/limitations -> decision -> code/config/design action -> cleanup -> next check`

Possible outcomes include:

- ship/ramp the treatment;
- stop/rollback;
- keep current behavior;
- redesign and re-test;
- fix instrumentation before deciding;
- run a more discriminating experiment;
- remove temporary experiment/flag/event paths after they no longer serve a decision.

Do not accumulate dashboards, flags, and events forever. Product telemetry has lifecycle cost and privacy surface.

## Reporting contract

A concise product-improvement report should include:

1. product question and intended decision;
2. population/scope and date/version context;
3. metric/event/experiment definitions;
4. data-quality/privacy checks;
5. observed result with uncertainty/limitations;
6. guardrail outcomes;
7. decision and engineering action;
8. cleanup/rollback/follow-up condition.

When evidence is insufficient, say what is unknown and identify the smallest next measurement that can change the decision.

## Boundaries

- Do not replace operational monitoring/SLOs with product analytics.
- Do not claim causality from ordinary observational dashboards.
- Do not collect secrets or unnecessary personal/sensitive data.
- Do not create hidden experimentation that violates consent, policy, contractual, or regulatory requirements.
- Do not change billing, entitlement, safety, or other high-impact behavior merely to optimize a proxy metric without the real product constraint.
- Do not keep experiment flags, duplicate schemas, or temporary instrumentation without a removal condition.
- Do not make an analytics pipeline a second authority for product state.
