# Desktop product experience

Use this for user-facing desktop workspace design or redesign when the product has persistent navigation, panes, inspectors, editors/canvases, command surfaces, native window constraints, or dense long-session workflows. Pair it with `frontend-product-patterns.md` for product flow/layout/interaction, add `frontend-visual-system-patterns.md` only for visual-system or responsive decisions, and use `host-shell-platform-patterns.md` only when OS/Electron/native-shell mechanisms are involved.

Desktop UI is not a wide website. Treat the window as a spatial work environment whose regions compete for persistent attention and screen area.

## Contents

- Reason in design terms before pixels
- Model the workspace around the user's task
- Give every persistent region a job
- Define pane sizing and collapse behavior
- Make focus, selection, and command routing legible
- Design density for long sessions
- Budget persistent attention and reveal detail on intent
- Match command/search scope to placement
- Design agentic work as scoped background-capable sessions
- Separate workspace UI from native shell integration
- Inspect the live renderer when layout evidence matters
- Validate realistic window and state matrices

## Reason in design terms before pixels

When a desktop surface feels wrong, name the product/design failure before changing CSS.

Use this chain:

`felt problem -> violated value/principle -> structural or system move -> token/pixel implementation`

Useful felt problems include:

- **noisy** - too much permanent chrome, borders, labels, badges, or competing emphasis;
- **flat** - primary work, navigation, status, and secondary tools have the same visual weight;
- **cramped** - persistent regions consume task space or spacing does not communicate grouping;
- **drifting** - comparable controls and panes use inconsistent typography, spacing, radius, or interaction rules;
- **cryptic** - icons, status, hierarchy, or command affordances require guessing;
- **fragile** - resizing, long labels, empty/error states, focus, or panel toggles break the composition.

Do not begin with `make the radius 8px` or `add blur`. First identify what principle the change should restore. One principled owner-level fix is stronger than many pixel patches.

## Model the workspace around the user's task

Start from the repeated user loop, not from a fashionable shell.

Write the core workspace contract as:

`choose/locate context -> perform primary work -> inspect/adjust secondary context -> observe result/status -> switch or continue`

Then decide which spatial regions are justified. Common roles include:

- **navigation/context rail** - chooses project, section, resource, or thread;
- **primary work surface** - editor, canvas, conversation, terminal, table, document, or main task view;
- **secondary inspector/tool pane** - properties, details, evidence, files, diagnostics, history, or controls tied to the current selection;
- **transient surface** - command palette, quick pick, popover, dialog, or contextual action layer;
- **status/feedback surface** - compact progress, connection, validation, or background-work state.

Do not create a region merely because desktop apps often have one. Each persistent pane must answer: `what recurring user decision becomes faster or clearer because this remains visible?`

The primary work surface gets the attention and space budget. Persistent chrome should recede at rest and become prominent when it carries state, selection, risk, or action.

## Give every persistent region a job

For each sidebar, rail, toolbar, header, footer, inspector, tab strip, status bar, or panel, record:

`role -> information/actions -> relationship to selection -> persistence -> collapse rule -> keyboard/focus path`

Reject duplicate chrome. If two regions communicate the same context or expose the same action hierarchy, consolidate unless they serve materially different frequencies or modes.

Prefer contextual disclosure over permanent boxes for low-frequency information. A pane that is useful only occasionally should usually collapse, appear on demand, or move behind a command/context action instead of taxing every session.

Avoid web-dashboard reflexes in desktop workspaces: hero regions, metric-card bands, marketing headers, giant page titles, repeated card containers, and oversized whitespace often waste high-value working area unless the product genuinely needs them.

## Define pane sizing and collapse behavior

A desktop layout needs constraints, not a single screenshot.

For every material pane define when relevant:

- minimum usable size;
- preferred/default size;
- maximum or natural size;
- which region absorbs extra space;
- which region compresses first;
- snap/collapse threshold;
- whether the user can resize it;
- whether user-chosen size/visibility persists;
- behavior when the window is compact, normal, or wide.

Prefer split/grid ownership over arbitrary absolute widths when regions genuinely share space. Fixed widths are appropriate for controls or panes with a natural measure; flexible growth belongs to the primary work surface more often than to navigation chrome.

When space becomes constrained, preserve the primary task and critical actions first. Collapse or transform secondary context deliberately; do not let flexbox accidents decide which controls disappear.

Treat text pressure as part of layout. Long project names, paths, tabs, localized labels, status messages, and identifiers need intentional wrap/truncate/tooltip/scroll policy.

## Make focus, selection, and command routing legible

Desktop workspaces often have multiple simultaneously visible interaction owners. The user must be able to tell:

- which pane has keyboard focus;
- which resource/item is selected;
- which context global or local commands will act on;
- whether a shortcut is global, pane-local, or selection-dependent;
- where focus goes after opening/closing a transient surface;
- which work continues in the background after switching context.

Selection and focus are related but not identical. Do not use one styling cue ambiguously for hover, selection, active pane, keyboard focus, and processing state.

For keyboard-heavy or professional tools, design command access as a first-class path. Common actions should have discoverable keyboard equivalents when the product convention supports them; command palette/search/quick-open surfaces should preserve context and return focus predictably.

Menus, inspectors, and side panels should operate on an explicit selected subject rather than whichever object happens to be visually nearby.

## Design density for long sessions

Desktop productivity tools are used repeatedly, often for hours. Optimize for scanability and task throughput rather than landing-page drama.

Use a density hierarchy:

- generous spacing between major regions or unrelated groups;
- compact spacing inside repeated high-frequency rows and controls;
- clear typography roles for titles, body, labels, metadata, code/numeric content, and status;
- restrained borders/elevation so persistent chrome stays quiet;
- one or two dominant attention cues, not accents everywhere.

A calm surface is not necessarily sparse. Dense tables, trees, terminals, timelines, and inspectors can be calm when alignment, rhythm, grouping, and state styling are consistent.

Do not shrink text, targets, or focus indicators merely to fit more chrome. Remove or collapse low-value chrome first.

## Budget persistent attention and reveal detail on intent

Treat attention as a scarce desktop resource. Persistent fill, border, badge, animation, glow, label, and toolbar density all spend that resource even when the user is not interacting.

For each persistent cue ask:

`what decision does this help at rest -> why must it be always visible -> what can appear only on hover/focus/selection/activity/error?`

Prefer a quiet resting state with deliberate reveal-on-intent when the cue is contextual rather than continuously important. Examples include low-frequency row actions, secondary metadata, drag affordances, inspector controls, and transient progress detail. Preserve discoverability and accessibility: keyboard focus, selected state, errors, destructive risk, and critical background status must not disappear merely to look clean.

Use one leading attention owner per local view when possible. Secondary regions can remain visible without competing through equal saturation, border weight, elevation, type scale, or animation. If everything looks active, nothing is legibly primary.

Motion must explain a transition, confirm an action, preserve spatial orientation, or expose state change. Decorative perpetual motion in a long-session workspace is attention debt; remove it unless it earns its cost.

## Match command/search scope to placement

Desktop tools frequently expose global, project, pane, resource, selection, and transient scopes at the same time. Placement and labeling must make the action subject legible before execution.

For every high-frequency search, command, create action, filter, or destructive control, define:

`visual placement -> active subject -> scope -> resulting surface -> focus return`

A control that visually belongs to a project panel should not secretly operate on the whole application; a global command should not look like a row-local action. If the same command can operate at different scopes, make the active subject explicit through context, label, breadcrumb, selection, or invocation surface rather than relying on hidden state.

Treat project/thread/resource switching as an authority transition. Preserve the workspace state that truly belongs to that subject, and do not leave stale selection, inspector content, search filters, or command targeting from the previous subject visible as if still authoritative.

## Design agentic work as scoped background-capable sessions

An agentic desktop should not turn background execution into a second application mode or a wall of process chrome. Model each substantial agent task as a scoped work unit whose identity remains stable while the user moves elsewhere:

`session/task identity -> workspace/subject -> execution state -> user control -> result/evidence -> review/integration`

The session/task owns its project or workspace context, conversation/history, changes/artifacts, execution state, and review evidence. The foreground window owns the user's current attention. Keep those authorities distinct.

### Protect foreground attention

Background progress may update badges, compact status, notifications, cached data, or a review-ready marker. It must not automatically navigate to another project/thread, replace the foreground transcript, open a diff, move keyboard focus, or expand a panel merely because work completed or a tool result arrived. Offer the result; do not hijack the user's current subject.

If the user explicitly enables a follow mode, live-follow behavior can be stronger because the attention transfer is intentional and reversible. Treat that as an interaction state, not the default semantics of background work.

### Keep execution state separate from visibility

Hiding a pane, switching threads, or collapsing a panel is presentation state. It should not implicitly cancel a stateful terminal, tool, stream, or agent task unless the product contract explicitly couples those actions. Conversely, cancellation/stop controls must target a clear session/task and communicate what actually stops. One generic close icon should not ambiguously mean hide, detach, cancel, and destroy.

Distinguish meaningful agent states instead of reducing everything to `running` versus `done`. Depending on the product, useful states include `queued`, `starting`, `running`, `waiting-for-input`, `degraded/reconnecting`, `blocked`, `completed`, `review-ready`, `integration-conflict`, and `failed/exhausted-recovery`. Each state that changes what the user can do should have honest copy and a clear next action.

### Make review a first-class surface

A chat summary such as "12 files changed, tests passed" is useful orientation but weak review evidence. When the agent mutates project state, provide a review path tied to the same scoped session/task: changed files or artifacts, meaningful diffs/hunks when applicable, current validation evidence, unresolved conflicts, and the resulting integration state.

Keep aggregate outcome primary. Internal worker/subagent traces are usually secondary evidence that can be revealed when diagnosing ownership, conflicts, or failures; do not make the user supervise every worker just because orchestration exists. Parallel agents/worktrees should expose enough identity and integration status to prevent overlapping ownership or accidental review of the wrong change set.

### Show operational truth without turning orchestration into the product

Use progressive disclosure for agent internals. The default surface should answer the user's operational questions with minimal noise:

`what is this task -> what state is it in -> does it need me -> what changed/resulted -> what can I review or do next?`

Keep compact progress/status visible enough that long-running work does not look dead, but do not permanently expand every tool call, worker event, command output, retry, or internal orchestration step. Detailed activity belongs behind an explicit details/follow/debug affordance unless the information changes a current user decision.

Do not require raw model reasoning to make the product controllable or trustworthy. When a rationale matters, surface a concise user-facing decision/explanation and the inspectable evidence that supports it. Tool activity, logs, traces, and worker ownership can remain available for diagnosis without becoming the primary reading order.

Preserve spatial stability while work streams. A progress disclosure that continuously expands, collapses, or reflows the primary transcript can be worse than a compact stable status. Prefer bounded regions, summarized activity, and user-controlled expansion for high-volume detail.

Allow detail density to vary when the product serves both ordinary and expert users, but keep the underlying task/session state and review evidence identical. A "technical" or verbose presentation may reveal more diagnostics; it must not create a different product contract or a separate mode required to perform the work.

### Make control and approval surfaces tell the truth

Agentic desktop controls must reflect the actual executor contract, not a cosmetic interpretation of it. For actions that can mutate project, account, system, or external state, keep the session/task identity and affected subject visible enough that the user knows what is being approved or stopped.

A consequential approval should answer, at the decision point: **what will act, on what, what will change, with which material scope/parameters, and what recovery exists**. A generic `Allow tool?` dialog is weaker than an action-specific preview and should not be the only product explanation when the effect is meaningful. Preserve the same approval subject if the request originates from a background worker or subagent; do not let delegation erase provenance.

A visible Stop/Cancel control must correspond to a real runtime transition. Distinguish:

- **stop/interrupt** - request the active executor to reach a safe boundary and cease current work;
- **cancel** - terminate a cancellable operation and fence late results from becoming current state;
- **detach/background** - leave execution running while removing it from the foreground attention path;
- **undo/revert** - perform a separate compensating/reversal action only when the product can actually restore the relevant state.

If the UI can only detach or stop rendering, label that honestly instead of calling it Stop. If an external or durable effect may have completed before interruption, show a reconciling/unknown-outcome state until current authority proves the result. Never let a reassuring icon, disabled composer, or vanished spinner imply stronger cancellation than the runtime provides.

Keep approval/control surfaces compact but inspectable. The default layer should show the decision and stakes; technical tool ids, raw payloads, and worker traces may sit behind details unless they are needed to distinguish the action safely.


If foreground chat, background tasks, delegated workers, or scheduled runs have different capabilities, make that difference a product state rather than a hidden implementation accident. Do not show the same enabled affordance if one surface lacks the tool/context needed to honor it. Surface intentional limitations as unavailable/degraded/read-only/needs-handoff states and preserve task context when handing work to a more capable surface.

When a high-impact agent action depends on inferred scope, the desktop should provide a compact intent-handshake surface before execution: target/subject, intended outcome, material scope, and the few consequences or exclusions that change the decision. Reuse the normal approval/review surface where possible instead of spawning a second confirmation language.

### Reconcile task authority after restart or reconnect

Treat a process/window restart, machine sleep/wake, daemon reconnect, or renderer reload as a projection-recovery boundary. The desktop must re-resolve durable task/session identity and current executor state before reusing the last visible `running`, `stopped`, `failed`, or `completed` label. Client memory is not task authority.

Preserve the reason a task stopped when it changes what may happen next. At minimum distinguish:

- **user-explicit stop/cancel** - a durable user intent that must not be silently resurrected by attach, refresh, or a later message;
- **host/supervisor/resource suspension** - execution ceased for lifecycle/resource reasons and may be resumable under the product's recovery policy;
- **transient disconnect/degraded state** - authority is temporarily unknown or unreachable; reconcile before declaring permanent failure;
- **terminal completion/failure** - the run has a durable terminal outcome and any resume/fork creates a clearly defined continuation rather than pretending the old process is still active.

If restoring work creates a new process, worker, or session generation, keep continuity explicit: either preserve the durable task identity and advance its generation, or show that a fork/new task was created. Never respawn duplicate work behind a surface that still appears to reference the original run.

On recovery, reconcile `task identity -> workspace/subject -> durable transcript/artifacts -> executor generation -> effects already committed -> current controls`. Disable or qualify actions whose target cannot yet be proven. A stale green `running` badge after restart and a stale red `failed` badge while work is actually resumable are both product defects.

### Define input semantics while work is active

If the user sends new input while a task is running, decide whether that means `queue`, `steer current work`, `interrupt/cancel`, or `start another scoped task`. Do not make one message composer silently change meaning based on hidden runtime state. Preserve the user's subject and make consequential transitions visible.

Treat busy input as a delivery contract, not only a composer affordance:

`input -> intended mode -> target session/run -> accepted/pending state -> delivery checkpoint -> fallback/cancel -> visible acknowledgement`

- **queue** preserves the current run and schedules a future turn; pending entries should be visible, editable/removable when safe, and bound to an explicit session/task;
- **steer** redirects the current run at a safe checkpoint while preserving already-completed work when the runtime supports it; if the live turn has already settled, fall back explicitly to queue/new-turn semantics rather than dropping the message;
- **interrupt/cancel** stops the targeted active work and must communicate what completed effects remain;
- **new scoped task** creates independent identity/workspace ownership rather than overloading the current turn.

Do not display a pending/steering state merely because the client enqueued text locally. Distinguish local acceptance from runtime delivery/acknowledgement when that boundary can fail. A message that races with turn completion, reconnect, provider refresh, or session replacement must end in an observable delivered, queued/fallback, cancelled, or failed state; silent loss and infinite pending spinners are product defects.

For agentic workspace redesigns, include these acceptance questions:

- Can the user switch projects/threads while work continues without losing or confusing task identity?
- Can background completion become visible without stealing focus?
- Can the user find what changed and what evidence supports completion without reading raw tool logs?
- Can the user distinguish waiting-for-input from ordinary background progress?
- If multiple tasks run in parallel, is ownership/integration scope legible enough to prevent accidental collision?
- Do task progress and review surfaces respect the same attention-budget and scope-to-placement rules as the rest of the desktop?

## Separate workspace UI from native shell integration

Keep two contracts distinct:

1. **workspace experience** - panes, tabs, editor/canvas, navigation, selection, commands, responsive window composition;
2. **host/OS shell** - native title bar/menu, tray/dock/taskbar, notifications, file dialogs, deep links, window lifecycle, system permissions, packaging identity.

A workspace redesign should not accidentally mutate host-shell security or lifecycle behavior. A tray/deep-link bug should not trigger a visual workspace redesign. Load `host-shell-platform-patterns.md` for the second contract.

When custom title bars or window controls are used, include drag regions, platform button placement, full-screen/maximized behavior, and accessibility in the rendered validation matrix rather than treating title chrome as decoration.

## Inspect the live renderer when layout evidence matters

A screenshot proves visible output; it does not by itself identify the layout owner. When the desktop renderer exposes browser/Electron inspection through DevTools, CDP, a DOM bridge, or an equivalent runtime surface, combine visual evidence with live structure and computed layout before guessing from source CSS.

For material layout/rendering defects, inspect the smallest useful set:

- actual DOM/component region boundaries and the element that owns the bad geometry;
- computed width/height/min/max, overflow, display/grid/flex constraints, position/inset, transforms, and relevant inherited tokens;
- active theme/data attributes and CSS variables after runtime application;
- real font/assets/loading state when typography or measurement can shift layout;
- focus/selection/hidden/collapsed state that source markup alone cannot prove;
- host-specific viewport/device-scale/window state when the renderer differs from a standalone browser.

Treat `standalone browser looks correct` and `Electron/native shell looks wrong` as boundary evidence, not permission to patch CSS blindly. Reproduce both surfaces under comparable content/viewport inputs, identify the first meaningful computed/runtime divergence, then route to workspace styling, renderer configuration, host-shell, font/asset loading, or platform behavior according to evidence. Do not declare desktop visual validation from a browser preview when the requested product ships inside a desktop shell.

Runtime inspection is diagnostic evidence, not a replacement for design judgment. A DOM can be mechanically correct while hierarchy, density, or workflow is still poor; pair computed-state inspection with the experience/design contract and rendered QA.


### Escalate evidence tools by what they can prove

Choose the narrowest reliable observation or interaction surface for the question instead of defaulting to screenshots or pointer automation. For a debuggable desktop/web renderer, prefer this evidence ladder when applicable:

`authoritative source/runtime identity -> DOM or accessibility semantics -> computed geometry/style/runtime state -> screenshot/vision for visual judgment -> background computer-use/pointer automation only for interactions not exposed structurally`

Use DOM/accessibility structure to answer what an element is, what state/name/focus it exposes, and whether a semantic control is reachable. Use computed/runtime inspection to answer which owner actually produces size, overflow, positioning, theme, or visibility. Use screenshots/vision to judge hierarchy, density, optical balance, content clipping, and fidelity to the active design contract. Use computer-use for native or otherwise non-structured interaction, or as an end-to-end user-path check when the product cannot be driven through a more stable semantic surface.

Do not infer semantics, focus ownership, or CSS/layout cause from pixels alone when live structure is available. Do not use brittle coordinate clicks when a stable element token, DOM/AX target, command, or host API can perform the same probe. Conversely, do not claim visual quality from a text/DOM snapshot alone: semantic structure and rendered appearance prove different things.

## Validate realistic desktop matrices

For substantial desktop work, inspect the actual application, not only a browser-sized component preview.

Choose the smallest matrix that can falsify the contract:

- **window** - compact/minimum, ordinary working size, wide/large;
- **pane state** - primary-only, common secondary pane open, user-resized extremes, collapsed/restored;
- **content pressure** - empty, representative, long names/paths, many rows/tabs, error/loading/background activity;
- **interaction** - pointer and keyboard focus, selection changes, command palette/transient surface, drag/resize when supported;
- **appearance** - active themes/high contrast when the product supports them;
- **platform shell** - only the OS-specific states affected by the change.

Check that the primary task remains obvious at every size, resizing does not destroy hierarchy, focus and selection remain legible, important actions stay reachable, and secondary chrome does not dominate the work surface.

## Evidence sources to consult, not copy blindly

Mature desktop products such as VS Code and Zed are useful evidence for workspace mechanics: resizable SplitView/Grid-style regions, collapse priority, dense tokenized UI, command surfaces, project/thread context, and explicit design philosophy. Treat those as mechanism references rather than visual templates. Preserve the target product's own workflow, brand, and platform language.
