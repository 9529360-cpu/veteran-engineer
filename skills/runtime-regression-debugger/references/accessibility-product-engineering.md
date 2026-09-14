# Accessibility product engineering

Use this when a product must remain perceivable, understandable, navigable, operable, and recoverable across keyboard, screen reader, touch, alternative input, zoom/text scaling, contrast modes, reduced motion, and platform accessibility APIs. Accessibility is interaction correctness, not a late visual checklist.

The contract is:

`user intent -> perceivable structure/control -> operable navigation/input -> understandable state/feedback -> authorized effect -> accessible completion or recovery`

For web/UI implementation also use `frontend-product-patterns.md`; for native clients use `mobile-product-engineering.md`; for desktop shell surfaces use `host-shell-platform-patterns.md`.

## Prefer platform semantics over imitation

Use native semantic controls when they already own keyboard, focus, accessible name/role/state, disabled behavior, and platform accessibility mappings. A clickable custom element is not equivalent to a button, link, input, disclosure, tab, dialog, menu, or other semantic primitive merely because mouse activation works.

When a custom interaction is necessary, own the complete behavior: accessible name/description, role/type, current value/state, relationships, keyboard/focus behavior, announcement/update behavior, and pointer/touch behavior. Do not add redundant or contradictory ARIA/accessibility metadata to native controls.

Meaningful headings, landmarks, lists/tables, labels, descriptions, groups, DOM/accessibility order, and relationships must survive responsive layout, portals, overlays, virtualization, and CSS reordering. Hidden/inert/background-modal content must not remain active navigation targets.

## Focus and input are explicit state

Required workflows need an operable path that does not depend on precision pointer input or an undiscoverable gesture when the platform supports keyboard/alternative input.

Define focus order and ownership for open/close, route change, validation failure, deletion, async replacement, and recovery. Repair DOM/task ownership instead of using positive `tabindex` to paper over broken order. A focus trap is only valid while interaction is intentionally scoped and must release/restore focus when its owner closes or disappears.

Do not make hover the only discovery path. Complex drag/path/multi-pointer/device-motion interactions need an equivalent simple action when required by the product contract. Time limits, transient controls, or auto-advancing content need explicit pause/extend/recovery behavior where the user can otherwise lose the task.

## Async feedback and errors must be perceivable without noise

For material asynchronous transitions decide whether the user needs busy/progress state, completion/status announcement, error announcement, focus movement, or no automatic announcement because the result remains directly discoverable. Do not announce every render or intermediate state.

Errors should be programmatically connected to the affected field/action where applicable, explain recovery, remain available long enough to perceive, and preserve user-entered data. If validation blocks submission, provide a deterministic route to the first actionable problem without creating a focus loop. Red borders, toast position, animation, or icons alone are not sufficient state.

## Preserve meaning under visual and motion variation

Required meaning must not depend only on color, shape, location, motion, or hover. Validate the relevant combinations of text resizing/font scaling, browser zoom/reflow, compact and wide layouts, orientation, high-contrast/forced-color modes, themes, and reduced-motion preferences.

Avoid fixed-height/overflow layouts that clip scaled content or controls. Keep a visible focus indicator for every keyboard/alternative-input path. If motion conveys required information, provide an equivalent non-motion signal instead of merely suppressing the animation.

## Forms, authentication, media, and consequential flows

Inputs need durable labels/instructions that survive placeholder disappearance, responsive layout, and validation. Keep required/optional state, format guidance, help text, error state, and value distinct.

Authentication, payments, consent, destructive actions, and other consequential workflows must not force users through an inaccessible CAPTCHA, gesture, timer, or out-of-band step without an equivalent supported route.

Non-text alternatives follow product meaning rather than file type: informative images need useful alternatives, decorative imagery should be ignored appropriately, time-based media may need captions/transcripts, and charts/maps/canvas/status graphics need an equivalent way to obtain required information when users must act on it.

## Respect platform and shared-component ownership

Web, iOS, Android, desktop shells, native dialogs/menus/notifications, and OS permission prompts expose different accessibility APIs. A browser-level pass does not prove native-shell accessibility. Do not erase platform semantics behind one visual cross-platform abstraction.

Reusable controls such as buttons, inputs, dialogs, menus, tabs, comboboxes, navigation, tables, and notifications should centralize the semantics and focus behavior they can truly own. Feature code supplies domain labels/data/transitions rather than reimplementing interaction mechanics. Treat design-system accessibility changes as high-fan-out changes.

## Validation must prove task completion

Automated checks are useful but do not prove end-to-end operability. Use the strongest practical stack for the changed mechanism:

1. semantic/component assertions;
2. keyboard/focus/state interaction tests at browser/native boundaries;
3. zoom/reflow, contrast/non-color, and reduced-motion checks when material;
4. representative screen-reader/assistive-technology smoke for critical workflows;
5. package/device/native-shell validation when installed-app identity or platform surfaces matter.

Representative cases include keyboard-only completion, screen-reader completion, focus transitions across dialogs/routes/errors/async replacement, dynamic status/error updates, zoom/text scaling/reflow, non-color state, reduced motion, and gesture alternatives where applicable.

Prefer assertions on semantic roles/names/states, focus ownership, durable effects, and task completion over brittle snapshots of generated accessibility markup. Zero automated violations or the presence of ARIA attributes is not a completion claim; a task-level assistive-technology oracle must make reading order, announcements, focus transitions, action, and recovery coherent together.

Keep accessibility evidence privacy-safe: do not log disability or assistive-technology usage merely to prove accessibility. Roll back high-fan-out component regressions without discarding user work created through the workflow.
