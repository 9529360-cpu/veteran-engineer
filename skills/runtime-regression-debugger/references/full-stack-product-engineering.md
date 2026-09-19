# Full-stack product engineering

Use this for feature/product work, especially sparse requests or changes that cross UI, API, auth, data, async, runtime, or delivery boundaries. Own one product contract across every specialist layer.

## Contents

- Compile the product contract
- Separate requirement sources
- Advance only the decision frontier needed now
- Recover active repository truth
- Build the thinnest complete vertical slice
- Control scope and companion responsibilities
- Plan failure, recovery, and compatibility
- Switch specialist roles without losing ownership
- Keep architecture boundaries explicit
- Shape validation to risk
- Finish at the visible boundary
- Evidence-backed no-change

## Compile the product contract

Do not translate a ticket directly into files. Express the behavior first:

`actor -> trigger -> validation -> authorization -> authoritative transition -> durable/external effect -> projection -> visible result`

Add recovery when failure can cross a durable or network boundary:

`failure point -> retry/rollback/compensation/reconciliation -> visible state -> operator evidence`

Capture only what changes the engineering decision:

- actor and tenant/account scope;
- success plus reachable invalid/unauthorized/conflict/partial states;
- authoritative state and invariants;
- async/external effects and completion semantics;
- retry, duplicate, concurrency, stale-work, and cancellation behavior when material;
- old/new client, worker, schema, data, or artifact compatibility;
- material latency, accessibility, privacy, durability, operability, or cost constraints.

Acceptance criteria describe observable behavior, not implementation trivia. "Return 200" or "add a hook" is insufficient when the user-visible contract extends beyond it.

### Preserve request semantics before simplifying implementation

Compress implementation complexity, not user intent. Parse explicit conjunctions and qualifiers into separate material rows before choosing the smallest implementation.

Examples:

- `Codex-style workspace layout + OS-style liquid-glass theme` contains at least a **structure/layout** requirement and a **visual-system/theme** requirement. A palette or opacity change can satisfy neither layout by itself nor the full theme system.
- `add search and make results keyboard navigable` contains a **functional retrieval** requirement and an **interaction/accessibility** requirement. Shipping search alone is incomplete.
- `replace the legacy sync flow and keep old clients working` contains a **behavioral migration** requirement and a **compatibility** requirement. New-path correctness alone is incomplete.

Translate language into the product dimension it actually names:

- layout/workspace/shell/navigation -> composition, hierarchy, panels, routing, sizing/resizing, persistence, responsive/window behavior as repository precedent requires;
- theme/style/material/visual language -> tokens, surfaces/materials, elevation/borders, blur/transparency where supported, typography/color roles, interaction states, overlays, contrast, and light/dark consistency as relevant;
- workflow/functionality -> reachable actions, state transitions, data/effects, failure/recovery, and visible completion;
- "like X" / "X-style" -> recover the reference's relevant interaction/layout/visual principles from available current evidence; do not reduce the reference to its most obvious color.

Do not invent unrelated features to make a request sound bigger. The rule is complete semantic coverage of what was asked, not maximal scope.

## Advance only the decision frontier needed now

Do not confuse a detailed plan with a proven design. Early in a task, decide only what must be stable for the next safe action. Leave reversible mechanics open until repository/runtime evidence can answer them.

Use this split:

- **must settle now** - user-visible semantics, public/schema contracts, authorization policy, migration/cutover meaning, accepted design dimensions, or another choice that downstream work would otherwise guess differently;
- **can defer** - filenames, helper structure, library-local mechanics, test placement, or other reversible details the active repository can answer later;
- **must reopen** - a previously frozen clause contradicted by fresh evidence. Reopen only that clause, record the evidence and downstream consequence, then re-freeze it before dependent work continues.

A planner that cannot inspect the real implementation should define outcomes, constraints, and acceptance evidence rather than inventing low-level mechanisms that later workers are forced to honor without evidence. Implementation difficulty is not evidence that product intent changed.

## Separate requirement sources

Keep three sources distinct:

1. **Explicit** - directly requested by the user/spec/issue.
2. **Repository-derived** - active precedent in routes, tests, schemas, neighboring flows, public contracts, or conventions.
3. **Product-sensitive unknown** - a choice that materially changes user-visible semantics, security/privacy, money/value, irreversible data behavior, or a public compatibility promise.

Resolve repository-derived details yourself. Ask only for product-sensitive unknowns that evidence cannot safely answer.

Repository-answerable examples: which existing component/envelope to reuse, naming/pagination/error conventions, whether similar work already uses an async operation resource, and where generated clients originate.

Product-sensitive examples: whether deletion is reversible, partial success is acceptable, a role may see previously private history, or a billing rule changes charges/entitlements.

For non-trivial work, build only the acceptance rows the mechanism can actually reach: happy path, invalid input, unauthorized scope, empty/partial state, retry/duplicate, concurrency/staleness, compatibility, recovery, and observability.

## Recover active repository truth

Before implementation, inspect only what the contract requires:

- repository/maintainer instructions and branch/working-tree state;
- active entrypoints, registrations, and callers;
- frontend routing/state/data-fetching boundaries;
- API/RPC/event contracts and auth/tenant middleware;
- DB schema/migrations plus queues, jobs, cron, or workflow owners;
- object/file storage and external adapters;
- generated-source authority;
- CI/release topology and relevant runtime/version markers;
- tests that claim to protect the behavior.

Prefer live source/config/runtime evidence over stale architecture prose. File existence or a familiar class name is not proof that the path is active.

## Preserve process handoffs for user-facing work

When a feature's success is materially visual, navigational, or interaction-driven, do not jump directly from product intent to component implementation. Keep explicit handoff artifacts, even when each artifact is compact:

`experience/design contract -> technical slice -> implementation -> requirement/spec review -> code-quality review -> rendered product review`

The experience/design contract is owned by `frontend-product-patterns.md`; rendered closure is owned by `visual-ui-quality-assurance-product-engineering.md`. Platform references such as desktop runtime, mobile, browser-extension, or host shell are secondary specialists unless the requested outcome is primarily a platform/runtime mechanism.

This is composition, not ceremony. Reuse context already recovered by an earlier phase; do not make every specialist rediscover the same product facts or re-ask answered questions. A downstream phase may challenge stale or contradictory evidence, but should otherwise consume the prior phase's accepted contract.

Treat each material handoff as a small validated interface. Name the minimum required artifact identity, contract/acceptance rows, state or schema shape, and proof needed by the downstream owner. Before work starts, the downstream owner should check those preconditions rather than silently invent missing values. If a required input is absent, stale, ambiguous, or incompatible, return the gap to the upstream owner that has authority to produce or revise it; do not let a downstream implementation, review, or release stage manufacture product semantics just to keep the pipeline moving. Optional context may be omitted without blocking when the downstream contract remains complete.

Use the lightest stage outputs that make the next owner deterministic:

- **outcome contract** - material clauses, non-goals, authority, decision frontier, and clause-to-proof rows;
- **experience contract** when user-facing - accepted hierarchy/workflow/state/visual dimensions plus a revision or other freshness identity when stale implementation is plausible;
- **technical change contract** - authoritative code/data/runtime owners, interfaces/seams, compatibility and failure/recovery rules, and validation boundaries;
- **implementation candidate** - exact source/diff/artifact identity plus changed owners and known residuals;
- **delivery state** when shipping - exact promoted artifact/environment plus public/runtime verification and rollback or forward-repair status.

Do not create a detached review artifact that silently competes with the thing it reviewed. A pre-implementation product/design/engineering review that changes intent should repair or version the owning contract/plan so downstream work consumes one accepted source. A post-implementation review may keep a findings record, but every finding must bind to the exact candidate it inspected and return unresolved gaps to convergence rather than redefining requirements from the review report.

## Build the thinnest complete vertical slice

Trace one chain rather than independent layer tickets:

`entry/UI -> client state -> API -> auth -> domain owner -> transaction -> async/dependency -> projection/cache -> visible completion`

For each material boundary record only what matters:

`owner -> contract -> authority -> timeout/cancel -> retry/idempotency -> auth scope -> compatibility -> evidence`

Prefer the first slice that crosses the riskiest real boundary and produces an authoritative or visible postcondition. A layer can be locally correct while the slice remains broken.

Useful safe sequencing patterns include:

`expand schema/contract -> deploy compatible readers -> deploy writers -> migrate/backfill -> cut over -> remove old path`

`establish authoritative server behavior -> expose stable API -> wire client -> verify visible result`

`add idempotent consumer -> enable producer -> observe -> retire legacy retry path`

Sequence by authority, dependency, compatibility, and reversibility rather than "frontend first, backend second".

## Control scope and companion responsibilities

Classify discovered work:

- **required for contract** - omission makes requested behavior wrong/incomplete;
- **required companion** - created by the mechanism, such as auth, migration, consumer update, cache invalidation, config, observability, rollout, or cleanup;
- **useful follow-up** - worthwhile but not required now;
- **unrelated modernization** - keep out of the change.

Inspect only companions implied by the mechanism:

- public/API/event/schema consumers;
- tenant/authorization scope;
- DB constraints, migration/backfill, read compatibility;
- job identity, dedupe, retry, cancellation, terminal/reconciliation state;
- cache key/invalidation/freshness/read-after-write;
- dependency timeout/idempotency/degraded behavior;
- config/flags/secrets references/runtime limits/deployment manifests;
- changed-transition observability;
- mixed-version rollout and rollback/forward repair;
- removal of temporary flags, adapters, dual paths, or diagnostics.

Do not turn a focused feature into a framework migration, dependency upgrade, naming cleanup, broad refactor, or service split unless the contract actually requires it.

## Plan failure, recovery, and compatibility

For every durable or externally visible action, ask what happens if execution stops immediately after each boundary:

- DB committed but response timed out;
- provider succeeded but local status write failed;
- event published but consumer crashed before ack;
- client navigated away while old work completed;
- old worker processed data emitted by new code;
- flag/control plane or dependency became unavailable.

Choose transaction boundaries, idempotency, outbox/inbox, compensation, resumable state, fencing, or reconciliation from the real invariant. Do not add retries before deciding whether replay is safe.

Assume independently deployed actors overlap in old/new combinations. Prefer additive evolution and parallel change. A flag day is valid only when the system actually has one atomic deployment boundary.

## Switch specialist roles without losing ownership

Choose one primary engineering mode, then switch perspective only when the next decision depends on a different real owner or failure mechanism:

`frontend -> API -> auth -> DB -> async -> runtime -> release/SRE`

Keep stable across role switches:

- actor and intent;
- authoritative product state;
- material invariants;
- success/error postconditions;
- compatibility obligations;
- authorization boundary;
- strongest completion evidence.

After specialist work, return to integration ownership and verify neighboring layers still agree on schema, authority, retry semantics, compatibility, and visible completion. Do not descend into kernel, consensus, sharding, or other deep systems merely because a technology name appears.

## Keep architecture boundaries explicit

Prefer boundaries around real ownership:

- pure domain decisions;
- authorization/policy;
- persistence/transaction;
- external dependency adapter;
- async job/workflow owner;
- runtime/process owner;
- presentation/projection;
- deployment/runtime configuration.

Do not force clean/hexagonal/DDD terminology onto every repository. Strengthen the weakest real boundary with the smallest compatible change. Reuse an existing owner rather than creating a second source of truth.

## Shape validation to risk

Risk comes from semantics, not diff size.

- **Low** - local deterministic behavior without public contract/data/security/runtime impact.
- **Medium** - cross-module state, API behavior, cache, dependency, async timing, or visible workflow.
- **High** - auth/tenant isolation, data migration, billing/value, destructive operations, queue semantics, production config, cryptography/secrets, public compatibility, or irreversible side effects.

Use the lowest-cost test that can falsify the changed owner, then cross the real boundary where the risk lives. Before completion verify, where material:

1. the active caller reaches the intended owner;
2. authoritative state changes correctly;
3. invalid/unauthorized paths fail correctly;
4. retry/duplicate/concurrency behavior is safe;
5. old/new versions coexist for the rollout window;
6. async/external effects have terminal or reconciliation semantics;
7. projections/caches cannot silently contradict authority;
8. the visible result is observed;
9. durable changes have rollback or forward-repair semantics;
10. temporary compatibility/diagnostic code has a removal condition.

Use `scripts/delivery_slice_gate.py` only when a structured closure record reduces omissions. Within a delivery slice, `transition`, `companion`, and `consumer` names are trace-link identities: names must be unique inside each kind so a requirements-to-delivery link cannot ambiguously target multiple rows. The same text may appear in different kinds because the trace identity is the pair `(kind, name)`. Treat malformed scalar/container values in these deterministic delivery/trace manifests as structured validation failures rather than letting Python collection operations decide behavior or escape as tracebacks; a gate is useful to automation only when bad input still produces a stable fail-closed verdict.

## Finish at the visible boundary

For implementation-authorized work, the default handoff condition is observed outcome closure, not source mutation. Maintain a compact trace from each explicit clause to its visible/runtime proof. If the first run shows that a clause did not materially change, reopen that clause and continue. Do not reinterpret the user's request downward after seeing the cost of the real implementation.

When a user-visible contract can be exercised black-box, make the first acceptance pass **source-blind enough to avoid implementation bias**: start from the requested job, observable behavior, and runtime surface rather than using the code you just wrote to explain why the result should count. If the visible behavior fails or is ambiguous, then inspect source, DOM/runtime state, logs, and ownership to diagnose the cause. Source explains or repairs the outcome; it does not substitute for observing the outcome.

Do not force source-blindness onto backend-only invariants, security proofs, migrations, or debugging where source/authority inspection is the actual evidence. This is an acceptance-bias control for observable product behavior, not a ban on implementation evidence.

For UI work, distinguish at least these dimensions when requested: structure/layout, visual system/theme, interaction, responsive/window behavior, accessibility presentation, and functional wiring. One dimension cannot silently stand in for another.


A feature is not done because code exists, an endpoint returns success, a row commits, or one layer's tests pass.

Distinguish:

`code exists -> active caller wired -> focused behavior passes -> failure/compatibility passes -> integration/E2E passes -> release candidate passes -> deployed -> production-visible contract verified`

Re-check the compiled contract after implementation. If discovered evidence changed an inferred requirement, exposed a missing companion, or revealed a real product decision, resolve that drift before claiming completion.

## Evidence-backed no-change

No change can be correct when evidence shows the current system already satisfies the contract, the symptom belongs to another authority and a local workaround would be harmful, the harness is broken, or modernization has no measurable product/operational pressure.

A no-change decision still needs evidence, scope, and a reevaluation trigger. Do not use it to avoid repository work that can actually complete the contract.

## Mature references

Use as prior-art anchors, then re-check version-sensitive behavior live:

- Google API resource-oriented design: https://google.aip.dev/121
- Google long-running operations: https://google.aip.dev/151
- Martin Fowler Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- Google SRE monitoring/canarying: https://sre.google/sre-book/monitoring-distributed-systems/ and https://sre.google/workbook/canarying-releases/
- OWASP ASVS/Cheat Sheets: https://owasp.org/www-project-application-security-verification-standard/ and https://cheatsheetseries.owasp.org/
