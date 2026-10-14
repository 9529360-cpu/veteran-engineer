# Semantic-first code navigation and surgical refactoring

Load only for material cross-file code comprehension, call-graph investigation, symbol rename, or refactor/debug work where a semantic tool can reduce blind search. A graphical IDE is **optional**; the same engineering contract works with an LSP, compiler/typechecker, AST tooling, repository-native commands, or plain source search.

## Choose the strongest currently exposed oracle

Use capabilities the active host can actually invoke, in descending order of semantic precision for the current question:

1. Language server / compiler index: go-to-definition, find-references, implementations, type/diagnostic data, call hierarchy, rename preview.
2. Repository-native typed/compiler/AST queries or existing code generation and symbol tooling.
3. Bounded text search and exact file inspection to reconstruct registrations, dynamic dispatch, generated edges, or language-server blind spots.
4. Runtime traces and targeted tests when source structure alone cannot settle behavior.

An installed IDE, desktop app, LSP extension, or coding agent is not a capability unless this session has a callable tool or authorized executor for it. Do not spawn a replacement agent or redesign the execution architecture just to get semantic navigation. If the best tool is unavailable, fall back immediately to targeted search and tests.

## Navigate a live behavior slice, not the repository wholesale

Bind the repository, branch, HEAD, working tree, language roots, and build ownership. For the observed symptom:

- start at the actual entry/registration or failing test/stack frame;
- follow definition -> references/callers -> typed dependencies -> effect owner -> tests and public contracts;
- distinguish source of truth from generated, vendored, fixture, snapshot, stale, or dead code;
- keep a compact symbol-to-file map only for the current edit. Do not cache an entire project index in the context window.

When diagnostics disagree with the running system, ask whether the LSP uses the same workspace, generated sources, build flags, and dependency versions as the authoritative checkout. A green IDE pane is not a runtime oracle.

## Change the smallest semantic owner

Prefer structured rename/codemod/AST edits over regex for symbol-aware changes, but **preview the full write set** and compare the diff before acceptance. Semantic tools may miss dynamic strings, reflection, configuration paths, SQL, templating, external consumers, serialization keys, or generated bindings; search and validate those compatibility surfaces explicitly.

For bugs, hold at most three falsifiable hypotheses and run the cheapest test that separates them. After one failed patch, revisit the evidence; repeated edits to the same symptom without a changed hypothesis are not progress. Preserve the old behavior contract unless the user approved a behavior change.

Use this iteration:

source-backed symbol location -> concrete invariant/failure hypothesis -> smallest edit -> type/compile/lint gate -> targeted test -> affected integration/runtime oracle -> final diff and exact-HEAD review.

Reuse passing evidence only for the same inputs and revision. Re-evaluate diagnostics/tests after generated-code or dependency changes; do not claim completion from navigation, a successful rename command, or a green typechecker alone.

## Failure-pressure examples

- A mock-import failure after an entrypoint move: inspect the actual import graph and mock export boundary before changing production logic or broadening mocks.
- A cross-file API rename: inspect callers and external/string-based consumers; apply a semantic rename if available, then search unresolved string references and test compatibility.
- A dynamic JavaScript registration: type/LSP references may be incomplete; inspect registration wiring and execute the contract oracle rather than treating zero references as dead code.
