# Product analysis engineering

Use this when the engineer must understand an existing product before designing, building, comparing, or improving one. Treat Product Analysis as the **Understand** stage of the same full-stack workflow, not as a detached research product.

## Contents

- Product-analysis contract
- Scope and authorization
- Evidence classes
- Surface inventory
- User journeys and state transitions
- Behavioral experiments
- Network and API behavior
- Data-model inference
- Technical fingerprinting
- Product comparison and version diff
- Convert analysis into design and engineering
- Browser and evidence workflow
- Reporting contract
- Quality checks
- Boundaries

## Product-analysis contract

Start from one bounded question:

`target -> authorized observable scope -> evidence -> product model -> tested inference -> opportunity/constraint -> design or engineering handoff`

Do not begin with a conclusion such as "they use X" or "we should copy Y" and search backward for supporting details.

For a meaningful analysis, capture:

- target product and exact surface being studied;
- user goal or engineering question;
- environment, account/role, viewport/device, and date when behavior can vary;
- observable evidence;
- claims separated into observed, inferred, and unknown;
- product flows and state transitions;
- capabilities, constraints, and failure/recovery behavior;
- implications for the product being built;
- unresolved questions whose answers could change a design or implementation decision.

The desired output is not a pile of screenshots or requests. It is a compact model of how the product behaves and which conclusions are supported by which evidence.

## Scope and authorization

Analyze only surfaces the operator is authorized to access or that are intentionally public.

Product analysis may inspect normal user-visible behavior, public documentation, browser-rendered structure, accessibility semantics, static assets, and network traffic produced by authorized interactions when the available tooling exposes them.

Do not turn product analysis into a bypass workflow. Do not:

- bypass authentication, authorization, paywalls, access controls, or rate limits;
- obtain credentials, session tokens, private account data, or protected content that the operator is not authorized to access;
- defeat DRM, licensing, anti-tamper, or technical protection mechanisms;
- exploit a vulnerability merely to learn hidden implementation details;
- persist secrets from headers, cookies, query strings, local storage, or provider output into reports/evidence;
- represent private or accidental implementation details as a stable public contract.

When a requested observation would require crossing one of those boundaries, mark the question unresolved and use safer public/authorized evidence instead.

## Evidence classes

Every material claim should have one of three statuses.

### Observed

Directly supported by current evidence from the studied surface.

Examples:

- clicking `Create project` opens a modal rather than navigating;
- the browser issues a POST to a visible API endpoint after submit;
- keyboard focus moves into a dialog;
- a failed save leaves the draft editable.

Observed does **not** mean universally true. Bind volatile observations to environment/date/account/version context.

### Inferred

A reasoned explanation consistent with observations but not directly proven.

Examples:

- several responses suggest a `Workspace -> Project -> Task` domain model;
- an interaction likely uses server-side search because every query change produces a network request;
- navigation behavior suggests a client-side router.

An inference must cite the observations that motivated it and name a cheap falsifier when the conclusion matters.

### Unknown

Evidence is insufficient or contradictory.

Keep unknowns explicit. Do not silently upgrade a plausible guess into an observed product fact.

Useful claim shape:

`claim -> status -> evidence ids -> confidence -> falsifier/next observation`

## Surface inventory

Map the smallest surface needed for the question before exploring broadly.

Useful inventory fields include:

- entry points and navigation hierarchy;
- routes/views/screens;
- primary actions and secondary actions;
- dialogs, drawers, menus, command palettes, tables, forms, editors, dashboards;
- loading, empty, error, offline, conflict, permission-denied, and success states;
- desktop/mobile/responsive variants;
- keyboard and accessibility behavior;
- account/role/tenant-dependent variation;
- integrations and external transitions visible to the user.

Prefer semantic structure over pixel cataloguing. The goal is to understand product organization and behavior, not to recreate every decorative detail.

## User journeys and state transitions

Model important journeys as transitions, not screenshot sequences.

For each flow record:

`starting state -> user action -> validation -> async/external work -> visible intermediate state -> success/failure state -> recovery`

A flow analysis should answer:

- what the user is trying to accomplish;
- where the product asks for information or confirmation;
- which actions are reversible;
- what happens during latency;
- what happens on validation, authorization, network, conflict, and partial failure;
- where progress is preserved or lost;
- how the user gets back to a useful state.

When the goal is to improve another product, extract reusable interaction principles rather than copying surface styling blindly.

## Behavioral experiments

When implementation behavior is uncertain, design a small A/B that changes one variable.

Examples:

- search with network available vs offline to distinguish local filtering from server-backed search;
- repeat the same action to distinguish idempotent behavior from duplicate creation;
- refresh after a local-looking preference change to test persistence;
- switch account/role while keeping the same object to test scope-dependent presentation;
- change viewport width while keeping content constant to identify responsive priority rules;
- trigger slow/failing responses to expose loading, retry, and recovery states;
- use keyboard-only interaction to expose focus and shortcut behavior.

For each experiment state:

`question -> prediction -> controlled variable -> observation -> conclusion -> confidence`

Do not run destructive experiments against real user data when a reversible/synthetic alternative exists.

## Network and API behavior

Network inspection is useful only when it improves the product model.

For authorized browser interactions, useful fields include:

- request method and normalized endpoint shape;
- trigger/action that caused the request;
- response status/category and timing;
- request/response field shapes when non-sensitive and necessary;
- pagination/cursor behavior;
- polling, streaming, WebSocket, or SSE behavior;
- retry/backoff and duplicate-submission behavior;
- cache/revalidation behavior;
- error envelopes and recovery behavior;
- dependency/order relationships between requests.

Redact credentials, cookies, authorization headers, CSRF values, signed URLs, personal data, and opaque tokens before persistence.

Distinguish:

- **observed endpoint behavior** from
- **inferred public API contract** from
- **internal/private implementation detail**.

A browser request existing does not mean the vendor promises it as a supported third-party API.

## Data-model inference

Infer domain concepts only when they help explain product behavior.

Build a tentative entity/relationship map from repeated user-visible and network evidence, for example:

`Account -> Workspace -> Project -> Task -> Comment -> Attachment`

For each inferred entity or relationship record:

- supporting evidence;
- identity clues;
- lifecycle clues;
- ownership/scope clues;
- whether the relationship is observed or inferred;
- contradictions or alternate explanations.

Do not invent fields merely because a common SaaS product usually has them.

## Technical fingerprinting

Technical fingerprints are hints, not the main deliverable.

Legitimate observable clues can include:

- framework/runtime markers intentionally exposed to the browser;
- route/navigation behavior;
- asset naming/build metadata;
- service workers/PWA manifests;
- public SDK or API documentation;
- GraphQL/REST/WebSocket/SSE patterns;
- analytics/error-monitoring integrations visible in normal client behavior;
- cache/CDN behavior;
- accessibility/DOM patterns.

Use fingerprints to choose better experiments or compatibility strategies. Do not overstate them as proof of server architecture.

## Product comparison and version diff

Compare products by one user goal or capability at a time.

Useful comparison dimensions:

- time/steps to complete a goal;
- information architecture and discoverability;
- keyboard and accessibility support;
- loading/error/recovery behavior;
- collaboration and concurrency behavior;
- customization and defaults;
- responsive behavior;
- integration boundaries;
- observable API/update model;
- privacy/trust cues;
- friction intentionally added for safety or irreversible actions.

For longitudinal analysis, preserve an evidence snapshot and later compute semantic differences:

`old observed capability/state/flow -> new observed capability/state/flow -> user impact -> engineering implication`

Do not treat pixel drift alone as a meaningful product change.

## Convert analysis into design and engineering

Product Analysis should finish by reducing uncertainty for the next stage.

Translate evidence into:

1. user/problem insights;
2. product principles worth reusing;
3. anti-patterns or friction to avoid;
4. explicit requirements/acceptance criteria;
5. design constraints and opportunities;
6. technical hypotheses that still need local validation;
7. candidate experiments or implementation slices.

A useful handoff is:

`observed product behavior -> why it matters -> principle/constraint -> proposed local behavior -> acceptance evidence`

Do not produce "copy competitor X" as an engineering requirement. Preserve the local product's users, brand, constraints, architecture, and accessibility requirements.

## Browser and evidence workflow

Reuse existing Browser/Validation/Evidence capabilities when available rather than inventing a parallel capture stack.

Prefer a bounded session:

1. define the question and allowed scope;
2. capture the initial state and environment identity;
3. execute one user flow or experiment;
4. collect only the screenshots/DOM/accessibility/network evidence needed for the question;
5. redact sensitive values before persistence;
6. classify claims as observed/inferred/unknown;
7. run a falsifying observation when a high-impact inference remains uncertain;
8. hand the resulting product model to Product Design or implementation.

Screenshots prove rendered state, not hidden behavior. Network traces prove traffic was observed, not why the server implemented it that way. DOM snapshots prove current structure, not future stability.

## Reporting contract

A compact Product Analysis report should contain:

- **Target and question** - what was studied and why;
- **Scope/environment** - authorized surface, account/role/device/date context;
- **Evidence index** - bounded evidence ids and source types;
- **Capability map** - what the product visibly supports;
- **Flow/state map** - primary and recovery paths;
- **Observed facts** - evidence-backed statements;
- **Inferences** - confidence + evidence + falsifier;
- **Unknowns** - questions whose answers could change a decision;
- **Opportunities/constraints** - what should influence the local product;
- **Handoff** - design/engineering acceptance criteria or next experiments.

When comparing multiple products, keep the evidence provenance separate per target so one product's observation cannot silently support another product's claim.

## Quality checks

Before treating analysis as decision-ready, verify:

- every observed claim cites evidence;
- every inference cites evidence and is labeled as inference;
- sensitive values were excluded/redacted;
- volatile observations include environment/date/version context where material;
- comparison uses the same user goal and comparable states;
- a screenshot is not being used as proof of backend behavior;
- an observed browser endpoint is not mislabeled as a supported public API;
- destructive/bypass experiments were not used;
- design recommendations explain the local product rationale rather than copying appearance;
- unknowns that could change the decision remain visible.

Use `scripts/product_analysis_gate.py` when a structured analysis manifest helps enforce evidence/claim discipline.

## Boundaries

Product Analysis is a research and product-engineering capability inside Veteran Engineer.

It does not create a second mission/state/evidence system. It should reuse existing browser, validation, evidence, product-design, and engineering flows when those capabilities are available.

It also does not expand permission: analysis inherits the same authorization, credential, data-handling, and external-system boundaries as the rest of the runtime.
