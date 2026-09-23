# Product UI Pattern Library

Use this reference when the repository's existing UI is weak, no accepted visual target exists, or a dense product surface needs stronger structural design guidance before implementation.

This is a pattern vocabulary, not a component package and not a visual authority. Reuse the target product's real components/tokens first. Use these patterns to improve information architecture, task framing, composition, and interaction before styling.

## Core rule

Choose patterns from the product's operating model, not from fashion.

First identify:
- primary objects: projects, tasks, threads, files, documents, agents, runs, records;
- primary action: create, inspect, edit, compare, monitor, approve, execute;
- persistence model: what remains across sessions;
- parallelism: what can run independently;
- context: what is global, selected, temporary, or derived;
- evidence: where progress, output, errors, diffs, and completion live.

Do not start with "sidebar/topbar/cards". Start with the object/task relationships.

## Desktop engineering and agent workspaces

### Project rail + thread list + work surface

Use when users repeatedly switch between repositories/projects and long-lived task threads.

Structure:
- compact project selector or rail;
- thread/task list scoped to the selected project;
- one dominant work surface;
- contextual secondary panel only when selected content needs it.

Avoid permanently allocating three equal columns. Secondary context should earn its space.

### Command center

Use when several agents/tasks can run in parallel.

Structure:
- queue or run list showing durable identities and state;
- active run gets the primary canvas;
- compact progress/evidence stream;
- explicit paused/blocked/completed states;
- inspectable outputs/diffs without replacing the task narrative.

Do not turn every run into a rounded status card. Prefer rows, timelines, lists, split views, or a focused canvas.

### Editor + evidence split

Use when the main work is code/content editing with execution evidence nearby.

Structure:
- editor/canvas is primary;
- terminal, diff, preview, browser, logs, or test evidence are switchable secondary surfaces;
- tabs or mode switches preserve one dominant workspace;
- contextual inspector appears only for the selected artifact.

Avoid showing editor, terminal, browser, diff, and chat all at full size simultaneously.

### Thread + artifact workspace

Use when conversation drives creation of files, code, documents, or designs.

Structure:
- thread explains intent/decisions;
- artifacts are first-class and reopenable;
- changes/diffs attach to the relevant step;
- artifact inspection can temporarily take over the main canvas.

Do not bury all outputs inside chat bubbles.

## Navigation patterns

### Stable global vs scoped local navigation

Separate:
- global: account, settings, plugin/device status;
- project-scoped: tasks, files, environments;
- task-scoped: plan, run, changes, evidence.

Do not mix all three levels in one sidebar.

### Progressive disclosure

Keep the default surface focused. Reveal:
- inspector for selected object;
- details on demand;
- advanced controls near the mechanism they affect;
- terminal/logs only when execution context matters.

Persistent secondary panes should be justified by repeated simultaneous use.

## Information density

Dense professional tools should feel compact, not cramped.

Prefer:
- rows over cards for repeated homogeneous items;
- separators and whitespace over nested containers;
- typographic hierarchy over badges;
- monospace only for code/data identifiers;
- small metadata near the object it qualifies;
- clear selected/active states without glow.

Avoid:
- card around card;
- every label as a pill;
- identical padding everywhere;
- fake metrics;
- oversized empty chrome around operational content.

## Task and execution patterns

### Durable task identity

Long-running work should expose:
- title/intent;
- project/repository;
- current state;
- active step;
- meaningful elapsed/updated time;
- outputs or changed artifacts;
- recovery/resume state when relevant.

### Execution timeline

Use a timeline or ordered step list when sequence matters.

Show:
- completed steps quietly;
- current step clearly;
- blocked/error state with cause and recovery;
- evidence attached to the step that produced it.

Do not render every step as a separate large card.

### Diff/change review

Prefer:
- file list + selected diff;
- additions/deletions as secondary metadata;
- accept/reject only when the product supports that action;
- changed-file grouping by purpose when the set is large.

Do not invent fake changed files or metrics to make the UI look technical.

## Search and command patterns

Use command palette/search when users know what they want and object count is high.

Support:
- fuzzy object search;
- recent items;
- action commands;
- keyboard-first navigation;
- scoped search when context matters.

A search bar should not exist merely as decoration.

## Empty, loading, error, and recovery states

A professional workspace needs designed non-happy states:
- first-use empty state explains the next meaningful action;
- loading preserves layout when possible;
- recoverable error explains retry or fallback;
- terminal failure explains what remains safe;
- disconnected/offline state distinguishes unavailable capability from missing data;
- resumed work restores task identity and evidence.

Do not use generic illustration/filler to hide missing product decisions.

## Reference translation

When a user names a product such as Codex, Linear, VS Code, Figma, Notion, or another mature tool:
1. identify the operating model and first-class objects;
2. identify composition and disclosure strategy;
3. identify density and typography behavior;
4. identify interaction/state patterns;
5. translate only the relevant properties into the target product.

Do not copy branding, proprietary text, or superficial chrome.

## Component-library relationship

A component library solves implementation consistency, not product design by itself.

Prefer in order:
1. existing app-level patterns;
2. existing repo component library/design system;
3. installed mature primitives;
4. composition from existing primitives;
5. a new local primitive only when a proven gap exists.

Do not add a new UI dependency merely because this pattern library mentions a structure.

## Structural anti-patterns

Reject or redesign:
- generic permanent three-column layout with no simultaneous-use justification;
- sidebar + topbar + dashboard cards as a default answer;
- inspector always open even when no object is selected;
- chat as the only container for durable artifacts;
- terminal/diff/browser panels shown as decorative tech props;
- repeated rounded surfaces replacing hierarchy;
- cloning another product's visual chrome without its operating model;
- "redesign" that changes only theme, radius, shadow, or spacing.
