# Product requirements engineering

Use this when a product request, PRD, user story, customer ask, roadmap item, or vague feature idea must be turned into an implementation-ready product contract. Treat requirements engineering as the bridge between **Understand** and **Design / Build**, not as paperwork detached from delivery.

A useful workflow is:

`problem/opportunity -> actor and context -> desired outcome -> observable acceptance -> constraints/non-goals -> dependencies/risks -> delivery slices -> validation evidence`

The purpose is to remove ambiguity that changes product semantics while preserving implementation freedom where repository evidence can answer ordinary engineering details.

## Contents

- Requirements contract
- Separate facts from assumptions
- Problem and outcome framing
- Actors, scope, and permissions
- Functional requirements
- Acceptance criteria
- Non-functional requirements
- Non-goals and boundaries
- Failure and recovery requirements
- Compatibility and rollout
- Data and lifecycle requirements
- Dependencies and external systems
- Ambiguity and decision log
- Slice the work for delivery
- Validation mapping
- Change control
- Reporting contract
- Boundaries

## Requirements contract

For each material requirement, capture enough to answer:

`who -> in what state -> does what -> under what validation/authorization -> what authoritative change occurs -> what the user observes -> what happens on failure`

A requirements package is implementation-ready when:

- the user/problem context is explicit;
- success is described as observable behavior;
- material failure/recovery states are covered;
- product-sensitive unknowns are isolated;
- compatibility and lifecycle obligations are visible;
- non-goals prevent accidental scope expansion;
- validation evidence can be derived without guessing.

Do not translate prose directly into files or tickets before the behavioral contract is stable enough to implement safely.

## Separate facts from assumptions

Keep four categories distinct:

1. **Explicit requirement** - directly stated by the user, product owner, spec, issue, policy, or contract.
2. **Repository-derived requirement** - active precedent recovered from routes, schemas, tests, neighboring flows, compatibility contracts, and current product behavior.
3. **Assumption** - a provisional interpretation needed to proceed but not yet proven.
4. **Product decision** - an unresolved choice that materially changes user-visible semantics, privacy, money, authorization, data loss, destructive behavior, or public compatibility.

Repository-derived facts should usually be resolved by inspection rather than sent back as questions. Product decisions should not be silently guessed when evidence cannot safely determine them.

Useful assumption shape:

`assumption -> why needed -> evidence -> risk if false -> cheapest falsifier -> owner/status`

Retire assumptions as soon as evidence resolves them.

## Problem and outcome framing

Start from the user or operator problem, not from a requested implementation artifact.

Weak:

- add a modal;
- add a queue;
- add an endpoint;
- add a toggle.

Stronger:

- users need to recover an unfinished setup without losing prior valid input;
- operators need to stop new work while preserving in-flight state;
- account admins need to revoke access without exposing whether hidden resources exist.

Define the intended outcome and how it will be observed. If a specific implementation is mandatory for compatibility, policy, migration, or integration reasons, record that separately as a constraint.

## Actors, scope, and permissions

For every material flow identify:

- actor / principal;
- tenant, account, workspace, project, or object scope;
- entry state and required preconditions;
- allowed action;
- denied action and concealment semantics when relevant;
- shared-object implications;
- ownership transfer or role-change behavior when applicable.

Do not write acceptance criteria that assume UI visibility equals authorization. Authorization belongs at a trusted boundary and should be testable independently of presentation.

## Functional requirements

Write functional requirements in observable product language.

A useful form is:

`Given <valid starting state>, when <actor action>, then <authoritative/visible postcondition>`

Add only the reachable branches that matter:

- valid path;
- invalid input;
- unauthorized/forbidden scope;
- empty or first-use state;
- conflict/stale state;
- duplicate/retry behavior;
- cancel/timeout when relevant;
- partial external failure;
- recovery/resume.

Avoid implementation trivia such as internal class names, hooks, table names, or HTTP codes unless those are themselves public/compatibility requirements.

## Acceptance criteria

Acceptance criteria are the executable boundary between product intent and validation.

Good acceptance criteria are:

- observable;
- deterministic enough to test;
- scoped to one behavior;
- explicit about actor and preconditions;
- clear about success/failure result;
- independent of incidental implementation details.

Prefer criteria such as:

- after a successful save, refreshing the page shows the persisted value;
- retrying the same request after a timeout does not create a duplicate object;
- a user from another tenant receives the same not-found behavior as for a missing object;
- cancelling a long-running operation leaves it in a terminal cancelled state and prevents later completion from becoming visible.

Avoid criteria such as:

- add a React hook;
- use PostgreSQL;
- endpoint returns 200;
- write unit tests.

Those may be implementation/validation details, not product acceptance.

## Non-functional requirements

Add non-functional requirements only when they materially constrain design or acceptance.

Common categories:

- latency / responsiveness;
- throughput / scale;
- availability / degraded mode;
- durability / recovery point;
- privacy / consent / retention;
- security / tenant isolation;
- accessibility;
- localization/timezone;
- compatibility / supported clients;
- observability / supportability;
- cost / resource limits;
- portability / host/runtime support.

Make them measurable where practical. "Fast" is weaker than "search results begin rendering within the established product SLO under the expected workload." Do not invent numeric targets when the product has none; derive from repository/operator contracts or mark the target unresolved.

## Non-goals and boundaries

State non-goals when nearby work is plausible enough to cause scope creep.

Examples:

- no redesign of unrelated settings pages;
- no schema migration beyond additive fields needed for this slice;
- no support for cross-tenant transfer in this release;
- no new billing semantics;
- no replacement of the existing job framework.

A non-goal should protect a real boundary, not become a dump of arbitrary excluded ideas.

## Failure and recovery requirements

Any durable, async, or external effect should have explicit failure semantics.

For each material boundary ask:

- what if validation fails before mutation?
- what if local commit succeeds but the response is lost?
- what if an external provider succeeds but local bookkeeping fails?
- what if the process crashes mid-transition?
- what if stale work completes after cancel/replacement?
- what if retry occurs after an unknown outcome?

Choose product-visible recovery requirements before implementation details. Possible requirements include retry, resume, reconciliation, compensation, rollback, explicit unknown state, operator intervention, or terminal failure.

Do not specify "retry on error" until replay safety is known.

## Compatibility and rollout

When multiple versions may coexist, requirements must describe the compatibility window.

Capture, when material:

- old client -> new server;
- new client -> old server;
- old worker -> new data;
- new worker -> old data;
- schema expand/contract order;
- flag/default behavior;
- rollback vs forward-repair behavior;
- deprecation/removal condition.

Assume independent deployables overlap unless the system truly has one atomic deployment boundary.

## Data and lifecycle requirements

For data-bearing features define:

- authoritative owner;
- create/update/delete lifecycle;
- identity and uniqueness;
- retention/expiration;
- soft delete vs irreversible delete;
- audit/history expectations;
- migration/backfill needs;
- read-after-write expectations;
- cache/search projection freshness;
- export/deletion/privacy obligations when relevant.

Do not let a cache, analytics store, search index, or client state accidentally become a second authority unless the product explicitly intends that model.

## Dependencies and external systems

For each external dependency capture only what affects the product contract:

- action performed;
- timeout/cancel behavior;
- idempotency/retry characteristics;
- authentication/authorization scope;
- rate/usage constraints;
- degraded behavior;
- failure mapping visible to the user;
- reconciliation after ambiguous outcomes.

Do not copy a vendor API document into the requirements package. Record the dependency behavior the feature actually relies on.

## Ambiguity and decision log

Keep unresolved issues bounded and decision-relevant.

Useful decision entry:

`question -> alternatives -> product impact -> evidence -> chosen decision -> owner/date -> reevaluation trigger`

Do not ask the user to choose filenames, libraries, component names, queue names, test frameworks, or other reversible engineering details the repository can answer.

Ask or escalate only when the choice changes product semantics or a consequential external commitment.

## Slice the work for delivery

Convert the contract into vertical slices by authority and visible outcome, not by department.

Prefer:

`one user flow -> stable API/domain owner -> durable state -> projection/UI -> validation`

rather than:

`frontend ticket -> backend ticket -> database ticket`

A useful slice should:

- prove one complete behavior;
- cross the riskiest real boundary early;
- preserve compatibility;
- have a clear validation oracle;
- be reversible or forward-repairable;
- avoid introducing temporary architecture without an owner/removal condition.

For broad missions, record dependencies between slices before parallelizing work.

## Validation mapping

Every acceptance criterion should map to evidence capable of falsifying it.

Examples:

- persisted state -> integration/E2E with reload;
- tenant denial -> negative authorization test;
- idempotent retry -> duplicate/timeout-after-commit test;
- responsive UI -> browser validation at representative viewports;
- migration compatibility -> mixed-version or migration fixture;
- rollback/degraded mode -> failure injection or controlled fallback test.

If a criterion cannot be mapped to an evidence boundary, it is probably too vague or the validation plan is incomplete.

## Change control

Requirements can change after implementation begins, but drift must be explicit.

When new evidence changes the contract:

1. identify which requirement/assumption changed;
2. identify affected slices/interfaces/data/rollout;
3. update acceptance criteria;
4. invalidate stale implementation/test evidence where necessary;
5. re-plan only the affected work.

Do not silently reinterpret acceptance criteria after seeing a failing test or inconvenient implementation constraint.

## Reporting contract

A concise implementation-ready requirements handoff should include:

1. problem/outcome;
2. actors and scope;
3. functional requirements;
4. acceptance criteria;
5. material non-functional constraints;
6. failure/recovery behavior;
7. compatibility/rollout obligations;
8. non-goals;
9. assumptions and unresolved product decisions;
10. delivery slices/dependencies;
11. validation mapping.

The handoff should be small enough that engineers can execute from it and specific enough that reviewers can determine whether the delivered behavior satisfies the request.

## Boundaries

- Do not turn requirements work into a speculative architecture rewrite.
- Do not invent product semantics that repository evidence or the user has not established.
- Do not encode reversible implementation choices as immutable product requirements without reason.
- Do not omit authorization, failure, recovery, compatibility, or lifecycle behavior when they are reachable and material.
- Do not call a feature implementation-ready while acceptance criteria remain ambiguous or untestable.
