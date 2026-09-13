# Accessibility product engineering

Use this when a product must remain perceivable, understandable, navigable, operable, and recoverable across keyboard, screen-reader, touch, switch/alternative input, zoom/text scaling, high-contrast, reduced-motion, and comparable accessibility modes. Treat accessibility as interaction correctness and product reachability, not a late visual checklist.

## Compile the accessibility contract

Start from a real user task rather than isolated attributes:

`user intent -> perceivable structure/control -> operable navigation/input -> understandable state/feedback -> authorized effect -> accessible completion or recovery`

Capture only what can change implementation:

- supported client surfaces and platform accessibility semantics;
- required input/assistive modes for the workflow;
- semantic structure, control identity, relationships, and state;
- keyboard/switch navigation and focus ownership;
- asynchronous updates, loading, validation, errors, and status announcements;
- zoom/reflow, text scaling, contrast, non-color cues, and motion behavior;
- pointer/touch precision, gesture alternatives, and timing constraints;
- form instructions/errors and media alternatives when applicable;
- automated and real assistive-technology validation;
- shared-component ownership, platform differences, rollout, and rollback.

Do not ask the user to select ARIA attributes, accessibility libraries, or test tools when repository/platform precedent already answers that. Recover the current component and platform semantics first.

## Prefer native semantics before custom emulation

Use the native semantic control that already owns keyboard, focus, name/role/state, disabled behavior, and platform accessibility mappings whenever it can express the interaction.

A custom visual element with copied click behavior is not equivalent to a button, link, input, disclosure, tab, dialog, menu, or other semantic primitive merely because it can be activated with a mouse.

When custom interaction is necessary, recover the complete behavioral contract before adding attributes:

- accessible name and description;
- role/type;
- current value/state (`selected`, `expanded`, `checked`, `pressed`, invalid, busy, disabled, etc. where applicable);
- ownership/relationship to labels, descriptions, groups, controls, tables, lists, and regions;
- keyboard and focus behavior;
- update/announcement behavior;
- pointer/touch behavior.

Do not add redundant or contradictory accessibility metadata to native controls. Semantic duplication can make the assistive representation less correct, not more.

## Structure and reading order are product state

Visual layout must not be the only source of hierarchy.

Preserve meaningful:

- headings and section hierarchy;
- page/region landmarks;
- lists and tables;
- labels/descriptions;
- grouping and relationships;
- DOM/accessibility order relative to the intended task order.

CSS position, flex/grid reordering, overlays, portals, virtualized content, and responsive breakpoints can make visual and assistive reading order diverge. Treat that divergence as a behavior change, not a styling detail.

Do not expose hidden, inert, offscreen, or background-modal content as active navigation targets.

## Keyboard, alternative input, and focus ownership

Every required workflow must have an operable path that does not depend on a precision pointer or an undiscoverable gesture when the supported surface expects keyboard/alternative input.

Define:

- which elements participate in sequential focus;
- expected arrow/tab/escape/enter/space behavior where the interaction pattern requires it;
- whether a composite widget owns roving/managed focus;
- who moves focus on open/close, route transition, validation failure, deletion, async replacement, and recovery;
- where focus returns after a temporary surface closes;
- how focus visibility remains perceivable in all supported themes/modes.

Do not reorder focus with arbitrary positive tab indexes to repair a broken DOM/task order. Repair ownership/order instead.

A focus trap is justified only while interaction is intentionally scoped (for example a modal surface). It must not strand the user after the owner unmounts, crashes, changes route, or becomes hidden.

Keyboard shortcuts must not steal expected text-entry/navigation keys, must respect platform conventions, and need a discoverable or remappable policy when material.

## Async state, status, errors, and recovery

A screen can be visually correct while assistive users never learn that anything changed.

For material asynchronous transitions, decide whether the user needs:

- a busy/loading state;
- progress information;
- a status/completion announcement;
- an error announcement;
- focus movement;
- no automatic announcement because the user already initiated and can discover the result in context.

Avoid announcing every render or intermediate state. Excessive live updates can be as unusable as silence.

Errors must be programmatically connected to the affected field/action where applicable, explain recovery rather than only failure, and remain available long enough to perceive. Do not rely on red borders, toast position, animation, or iconography alone.

When validation blocks submission, preserve user-entered data and provide a deterministic route to the first actionable problem without creating a focus loop.

## Visual perception, zoom/reflow, contrast, and motion

Do not encode required meaning only in color, shape, location, motion, or hover.

Validate that required content/actions survive the supported combinations of:

- text resizing/font scaling;
- browser/page zoom and reflow;
- narrow/large viewports and orientation where applicable;
- high-contrast/forced-color or equivalent platform modes;
- light/dark themes;
- reduced-motion preferences.

Avoid fixed-height/overflow patterns that clip scaled text or controls. A responsive layout that looks correct at multiple viewport widths can still fail when text alone grows.

Focus indicators are interaction state, not decoration. Do not remove them unless an equivalent visible focus treatment exists for every keyboard/alternative-input path.

Nonessential animation should follow reduced-motion preferences. If motion conveys required state, provide an equivalent non-motion signal rather than simply suppressing the information.

## Pointer, touch, gestures, and timing

Required interactions should tolerate the precision available on the supported device/input mode.

Do not make hover the only discovery path for required controls. Avoid edge-only, tiny, overlapping, or moving targets that become impractical under tremor, magnification, or touch.

When an interaction depends on complex or path-based gestures, drag/drop, multi-pointer input, device motion, or similar mechanisms, define the equivalent simple action when the product contract requires one.

For time limits, expiring sessions, transient controls, auto-advancing content, or disappearing notifications, define pause/extend/recovery behavior. Security/session constraints may justify limits, but they still need an explicit accessible recovery path.

## Forms, authentication, and error-prone workflows

Inputs need durable labels and instructions that survive placeholder disappearance, responsive layout, and validation state.

Preserve the distinction between:

- required/optional state;
- format guidance;
- error state;
- help text;
- the value itself.

Do not make placeholder text the only label or instruction. Do not encode validation only with color or a summary detached from field relationships.

For authentication, payments, consent, destructive actions, or other consequential workflows, accessibility is part of the authorization/completion contract. A user must not be forced into an inaccessible CAPTCHA, gesture, timer, or out-of-band step without an equivalent supported route.

## Media and non-text content

Define alternatives according to product meaning, not file type alone.

Examples include:

- useful alternative text for informative images;
- intentionally empty/ignored semantics for purely decorative imagery;
- captions/transcripts or other alternatives for time-based media where the product requires them;
- text/state equivalents for charts, maps, status graphics, or canvas content when users need the underlying information to complete the task.

If a capability is genuinely not applicable, record that in the contract instead of inventing low-quality placeholder alternatives.

## Mobile and desktop platform semantics

Accessibility APIs are platform contracts. The same visual component can need different native semantics on web, iOS, Android, or desktop shells.

On mobile, validate screen-reader navigation, accessible names/actions, dynamic text/font scaling, orientation/form-factor behavior, switch/keyboard input where supported, and platform focus/announcement semantics.

On desktop/Electron or other host shells, separate renderer/web semantics from native shell surfaces such as menus, dialogs, tray items, notifications, and operating-system permission prompts. A browser-level accessibility test does not prove native shell accessibility.

Do not force one cross-platform abstraction to erase platform semantics merely to keep component APIs visually identical.

## Shared components and design systems

Accessibility belongs in the component contract whenever the interaction is reusable.

A shared button, input, dialog, menu, tab set, combobox, notification, table, or navigation primitive should centralize the semantics/focus behavior it can own. Feature code should provide domain labels, descriptions, data, and transitions rather than reimplementing keyboard/focus behavior per screen.

Treat a design-system change as a fan-out change. A semantic or focus regression in one shared primitive can affect many product workflows even when screenshots remain stable.

Variant styling must not silently drop labels, focus indicators, disabled semantics, or target size/spacing assumptions.

## Validation shape

Automated accessibility checks are useful but are not a proof of end-to-end operability.

A useful risk-shaped validation stack is:

1. source/component semantics and deterministic accessibility assertions;
2. browser/native interaction coverage for keyboard/focus/state behavior;
3. representative zoom/reflow, contrast/non-color, and reduced-motion checks when material;
4. real or platform-equivalent screen-reader/assistive-technology smoke for critical workflows;
5. package/device/native-shell validation when behavior depends on installed application identity or platform surfaces.

Representative scenario classes should include:

- keyboard-only completion;
- screen-reader completion;
- focus transitions across dialogs/routes/errors/async replacement;
- dynamic loading/status/error updates;
- zoom/text scaling and reflow;
- state conveyed without color alone;
- reduced motion when animation is present;
- touch/gesture alternatives when material.

Prefer assertions on semantic roles/names/states, focus ownership, durable effects, and task completion over brittle snapshots of generated accessibility markup.

Automated tooling can find many structural issues, but only a task-level assistive-technology oracle can prove that reading order, announcements, focus transitions, and recovery make sense together.

## Observability and release

Accessibility failures often enter through shared components, content/config changes, responsive redesigns, or platform updates without producing ordinary application errors.

Where material, track bounded evidence such as:

- deterministic accessibility regression failures;
- inaccessible-flow support incidents;
- component/version identity for known regressions;
- rollout cohorts when a new design-system primitive changes semantics/focus.

Do not log assistive-technology state or user disability information as a proxy for accessibility usage unless the product has an explicit privacy-authorized reason. Accessibility correctness should not depend on identifying disabled users.

Roll out high-fan-out component or navigation changes with a recovery path. Code rollback and user-state recovery are separate: reverting a component must not discard user work created through the workflow.

## Completion boundary

An accessible product slice is not complete because an audit tool reports zero violations or because controls have ARIA attributes.

Close the real task contract: semantic structure, accessible name/role/state, keyboard/alternative input, focus ownership, async feedback, errors/recovery, zoom/reflow, non-color cues, motion, pointer/gesture/timing behavior, forms/media where applicable, shared-component ownership, representative assistive-technology validation, and platform-specific behavior.

For web/UI implementation also use `references/frontend-product-patterns.md`. For native/cross-platform clients use `references/mobile-product-engineering.md`. For desktop shell surfaces add `references/host-shell-platform-patterns.md`. For high-risk validation and regression design add the repository testing/evidence references rather than duplicating them here.
