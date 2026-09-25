# Design Session Ledger

Use this reference for long, multi-tool, or cross-surface design work where design intent, component mappings, source authority, or visual evidence may outlive one model turn.

The ledger is a compact continuation record, not a second design source of truth. Repository code, accepted design sources, design-system authorities, and real runtime renders remain authoritative. The ledger only binds their identities and current status so later work does not guess.

## Record only decision-bearing state

Keep:

```text
session_id
phase
surface
accepted_design_source
runtime_surface
design_system_sources
component_mappings
token_mappings
open_decisions
open_mismatches
latest_structural_evidence
latest_visual_evidence
last_verified_revision
next_safe_action
```

Every identity should be exact enough to reacquire: repository revision/path, Figma file/node, Storybook story, component import, token file, screenshot/render identity, or provider artifact ID.

Do not store secrets, large dumps, screenshots, source files, or generic conversation summaries in the ledger.

## Authority before continuation

Before resuming after interruption, context compaction, another host, or another model:

1. Reacquire the current repository/design/runtime identities named by the ledger.
2. Mark evidence stale when its source revision, node, token owner, component API, or rendered runtime changed.
3. Preserve still-fresh settled decisions; do not rediscover the whole project.
4. Reopen only the affected design frontier.
5. Continue from the next safe action.

A stale ledger entry is a cache miss, not permission to recreate or overwrite design work.

## Component and token mapping

For each material mapped element, record a small relation:

```text
design entity -> code entity -> authority -> mapping status -> evidence
```

Examples:

```text
Figma Button set -> src/ui/Button.tsx -> code API -> connected -> Code Connect mapping
color/surface/default -> tokens.css --surface -> token file -> aligned -> light/dark render
Dashboard/SummaryCard -> Card + Metric composition -> code components -> adapted -> runtime screenshot
```

Use exact mapping when Code Connect or equivalent exists. When no exact mapping exists, distinguish `reuse`, `wrap`, `compose`, and `new`; do not silently treat a visual approximation as a mapped component.

## Write discipline

For design-tool mutations, keep exact returned entity IDs when the provider exposes them. Prefer deterministic names for reacquisition, but never authorize destructive cleanup from fuzzy names alone.

For repository mutations, keep the exact branch/revision and authoritative source paths. If another host has the repository write lease, do not fork design implementation into a competing source branch.

## Visual evidence lifecycle

Track the latest accepted visual target separately from the latest implementation render.

A visual target can be:
- accepted Figma frame/component;
- approved screenshot/mockup;
- selected generated concept;
- captured live reference when faithful recreation is explicitly authorized.

Implementation proof must come from the real code-native runtime when available.

When a relevant mutation occurs, invalidate only the evidence it can affect. Do not retake screenshots or rerun design discovery when nothing relevant changed.

## Completion

A design phase can hand back to the full-stack owner when:
- the active design source is identified;
- component/token reuse decisions are explicit;
- in-scope open decisions are closed or genuinely blocked;
- the real implementation has the required structural/runtime evidence;
- remaining visual mismatches are either fixed or explicitly recorded.

The ledger should make continuation cheaper, not turn design work into bureaucracy.
