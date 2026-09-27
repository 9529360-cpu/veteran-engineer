# Architecture decisions and evolutionary refactoring

## Contents

- Recover architecture before redesigning it
- Distinguish policy from mechanism
- Decide with forces and evidence
- Use ADRs for consequential decisions
- Prefer reversible boundaries
- Refactor by seam and vertical slice
- Prefer deep modules over shallow indirection
- Scale large refactors mechanically
- Modernize incrementally
- Avoid abstraction and rewrite traps
- Validate architectural changes
- Mature references

## Recover architecture before redesigning it

Do not impose a favorite architecture vocabulary on an unfamiliar repository.

Recover the real boundaries first:

- entry points and public contracts;
- domain decisions and invariants;
- authorization policy;
- persistence/transaction owners;
- external adapters;
- async/job owners;
- runtime/process boundaries;
- presentation/state projections;
- deploy/configuration boundaries.

Trace active callers. A directory named `services`, `domain`, or `core` does not prove it owns the behavior.

## Distinguish policy from mechanism

Separate decisions that express product/business policy from mechanisms that implement them.

Examples:

- "only tenant admins may rotate keys" is policy;
- middleware, DB predicates, and RPC guards are mechanisms;
- "job is processed at most once from the user's perspective" is a product invariant;
- queue visibility timeout and dedupe table are mechanisms.

Keep policy centralized enough to reason about, but do not create a universal abstraction that hides important mechanism differences.

## Decide with forces and evidence

For a non-trivial architecture decision, state:

- context/problem;
- constraints and invariants;
- forces/trade-offs;
- serious alternatives;
- chosen option;
- compatibility/migration plan;
- operational/security consequences;
- what evidence would cause reevaluation.

Useful forces include latency, consistency, blast radius, data ownership, deploy independence, team ownership, observability, failure isolation, cost, portability, and rollback complexity.

Do not pick an architecture because it is fashionable or because a framework makes it easy.

## Use ADRs for consequential decisions

Use a short Architecture Decision Record when a choice is long-lived, crosses teams/components, changes a public/data/runtime contract, or would otherwise be hard to reconstruct later.

Keep the ADR concise. Record the decision, context, meaningful alternatives, consequences, status, and superseding decision when it changes.

Do not rewrite accepted ADR history to make the current architecture look inevitable. Supersede old decisions explicitly.

Martin Fowler's current ADR guidance emphasizes short records, decision context, alternatives, ramifications, status, and supersession:
https://martinfowler.com/bliki/ArchitectureDecisionRecord.html

## Prefer reversible boundaries

When uncertainty is high, prefer designs that preserve options:

- adapter behind a narrow interface;
- additive schema/API evolution;
- feature exposure separate from deploy;
- versioned event payloads;
- explicit ownership and state transfer;
- immutable artifacts plus mutable promotion metadata;
- strangler/parallel-change seams around legacy behavior.

Reversibility is not free. Do not add indirection merely to claim flexibility. Add it where rollback or migration risk is real.

## Refactor by seam and vertical slice

Refactoring should preserve behavior while improving a real design pressure.

Good sequence:

1. characterize current observable behavior;
2. identify the seam and owner;
3. add tests/telemetry at the boundary that must remain stable;
4. move one responsibility at a time;
5. keep old/new paths compatible where coexistence is required;
6. remove the old path only after callers/data have migrated;
7. verify no second source of truth remains.

Do not mix broad formatting, dependency churn, schema redesign, and behavioral changes unless they are inseparable.

## Prefer deep modules over shallow indirection

Use **module depth** as a diagnostic lens, not as a reason to rename the repository's existing architecture vocabulary.

A useful module gives callers **leverage**: substantial behavior, policy, invariants, failure handling, or coordination behind an interface that is smaller and simpler than the implementation knowledge it hides. It also creates **locality**: when the behavior changes, callers do not all need to relearn or duplicate the mechanism.

Treat the interface as everything callers must know to use the module correctly: operations and types, invariants, ordering, errors, configuration, ownership, and material performance/failure characteristics. A tiny type signature can still be a large interface if every caller must understand hidden sequencing or state rules.

Use these checks before adding or preserving an abstraction:

- **Deletion test** - imagine deleting the module. If its complexity simply disappears, it may be a pass-through. If the same knowledge and branching would spread back across many callers/tests, the module is earning its keep.
- **Interface-as-test-surface** - important behavior should normally be provable through the same interface real callers use. If every meaningful test must bypass the public seam and reach deeply into internals, reconsider the module shape or the chosen test boundary.
- **Real variation test** - a new adapter/seam needs current evidence: multiple real implementations/callers, a concrete migration/cutover/recovery boundary, or another present variation pressure. A hypothetical future adapter by itself is weak evidence.
- **Locality test** - one policy change should not require shotgun edits across callers that conceptually ask for the same outcome.
- **Leverage test** - adding a method/parameter/type should buy materially more capability or clarity than the caller knowledge it adds.

Do not optimize for implementation-lines/interface-lines ratios, raw file count, or fewer functions. A deep module may have a complex implementation; the point is that callers and tests do not carry that complexity.

For consequential new interfaces, design materially different interface shapes before committing when the decision is cheap to explore. Compare them on caller knowledge, locality, testability, compatibility, error clarity, and migration cost. Do not manufacture alternatives for a tiny private helper or mechanically require multiple designs when the existing project contract already determines the seam.

## Scale large refactors mechanically

For changes across tens or hundreds of call sites, separate the semantic decision from the mechanical rewrite.

Prefer this sequence:

`define old/new contract -> characterize behavior -> introduce compatible seam -> transform callers -> compile/typecheck -> search residuals -> validate representative boundaries -> remove seam`

Use repository-native rename/refactor support, typed compiler diagnostics, or AST/codemod tooling when the transformation depends on syntax or semantics. Use regex only for transformations that are provably textual.

For generated code, change the schema/generator/source-of-truth and regenerate; never scale a hand edit across derivative output. Preserve public compatibility when clients or packages deploy independently.

Batch a large migration when blast radius or reviewability is material. Keep each batch behaviorally equivalent, rerunnable when practical, and easy to bisect. After the transform, search for old symbols/contracts, dynamic/reflection usages, configuration strings, templates, tests/fixtures, docs/examples that execute in CI, and consumers outside the obvious language boundary.

Do not keep a compatibility shim forever. Give it an owner and removal condition, then delete it after all supported callers have moved and evidence proves the old contract is no longer required.

## Modernize incrementally

For legacy replacement, prefer a staged strangler-style approach when the old system must remain live.

Typical phases:

`route one capability -> prove parity -> move state ownership -> shift traffic -> retire old owner`

Choose seams based on product capabilities and data ownership, not arbitrary file/module boundaries.

A strangler migration fails when both old and new systems become authoritative writers indefinitely. Define the cutover owner and reconciliation strategy explicitly.

Martin Fowler's updated Strangler Fig discussion remains a useful modernization anchor:
https://martinfowler.com/articles/2024-strangler-fig-rewrite.html

## Avoid abstraction and rewrite traps

Treat these as warning signs:

- new generic layer with one speculative consumer;
- abstraction whose only purpose is reducing line count;
- repository-wide interface rewrite for one feature;
- duplicate caches/stores that require constant synchronization;
- microservice split without an independently owned data/operational boundary;
- "clean architecture" restructuring that changes names but not ownership;
- big-bang rewrite with no production parity checkpoints;
- hidden compatibility break justified by "all clients should upgrade".

Prefer boring, explicit contracts over clever indirection.

## Validate architectural changes

Architecture is proven through behavior and operability, not diagrams.

Validate:

- ownership is singular and enforceable;
- contracts are versioned/compatible where required;
- failure domains behave as intended;
- security boundaries remain intact;
- observability crosses the new boundary;
- data migration is correct and resumable;
- performance is not materially worse without an accepted trade-off;
- rollback/cutover works;
- deleted owners/callers are actually gone.

For long-lived legacy modernization where compatibility windows, organizational ownership, deprecation horizons, and multi-year deletion risk dominate, load `references/legacy-modernization-longevity.md` rather than bloating ordinary refactor context.

## Mature references

- Martin Fowler Architecture Decision Record: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Martin Fowler Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- Martin Fowler Strangler Fig modernization: https://martinfowler.com/articles/2024-strangler-fig-rewrite.html
- Google API Improvement Proposals: https://google.aip.dev/
- AWS Builders' Library: https://aws.amazon.com/builders-library/
