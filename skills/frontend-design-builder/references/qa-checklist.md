# Frontend Visual QA Checklist

Use before handoff for substantial UI work.

## Visual fidelity

Compare the implementation with the accepted reference or declared design direction:
- visible copy and section/state order;
- first viewport composition and focal point;
- layout geometry and alignment;
- typography family/personality, size, weight, line-height, tracking;
- background/surface/accent colors;
- borders, radius, shadows/elevation;
- container model (open layout vs card/panel/table/canvas/etc.);
- icon metaphor, stroke/fill, size, alignment, state;
- imagery crop, aspect ratio, blending, masks/overlays;
- whitespace and density;
- motion and state transitions.

Fix visible drift rather than explaining it away when the source is available and the mismatch is correctable.

## Responsive QA

Check at minimum the target desktop viewport and a mobile-sized viewport when the interface is responsive.

Look for:
- horizontal overflow;
- accidental wrapping of primary controls;
- clipped headings, tables, charts, dialogs, or media;
- broken sticky/fixed regions;
- unreadable type or touch targets;
- collapsed hierarchy;
- mobile layouts that merely squeeze desktop UI instead of adapting it.

## Functional QA

Exercise the main path and meaningful states:
- navigation and selected states;
- forms and validation;
- tabs/filters/search;
- modals/drawers;
- creation/editing/success states;
- playback, drag/drop, canvas, or game controls when relevant.

Do not hand off obviously inert controls that visually imply functionality unless the user requested a static prototype.

## Engineering QA

Where supported by the repo:
- typecheck;
- lint;
- tests relevant to touched code;
- production build;
- browser/render smoke test.

Confirm that generated/imported assets resolve and that no temporary QA/debug artifacts remain.

## Final ledger

For non-trivial work, mentally or explicitly account for at least five comparison points across layout, type, color, assets/icons, spacing/container model, responsive behavior, and interaction. Note any intentional deviation and why it exists.
