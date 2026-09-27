# Frontend Visual QA Checklist

Use before handoff for substantial UI work.

## Visual quality gate

Before fidelity details, judge whether the rendered result still expresses the selected design direction.

Block a clean handoff when the surface has drifted into generic AI-template behavior: unclear focal point, weak typography hierarchy, card soup, decorative gradients/glows/badges, generic sidebar-dashboard composition, uniform density, or product-irrelevant visual filler. Compare against the active visual target rather than rationalizing the coded result.

A visually polished build that no longer matches the selected product-specific direction is still a design failure.

## Designer critique loop

Do not treat visual QA as one terminal checklist pass for visually material work.

Use a tight loop:

1. capture the current real render at the exact viewport/state being judged;
2. identify the few highest-impact failures first: hierarchy, first viewport, typography, composition, spacing rhythm, component grammar, imagery, interaction/state clarity;
3. trace each finding to the owning source, token, component, layout rule, or asset;
4. fix the owner rather than layering local cosmetic overrides;
5. rerender the **same** viewport/state;
6. compare before/after and keep iterating while correctable P1/P2 visual failures remain.

Preserve before/after evidence when it materially proves the repair or helps a reviewer distinguish a true improvement from a different screenshot state. Do not accumulate screenshots for ceremony.

When source-level smells are plausible, `scripts/ui_slop_scan.py <frontend-path> --json` can supplement the review. Treat scanner output as advisory evidence only; a clean scan does not mean the UI looks good, and a finding can be acceptable when the product/design contract justifies it.

## Visual fidelity

Compare the implementation with the accepted reference or declared design direction:
- visible copy and section/state order;
- first viewport composition and focal point;
- layout geometry and alignment;
- typography family/personality, size, weight, line-height, tracking;
- headline/body measure, intentional line breaks, baseline relationships, and optical centering of icons/text inside controls;
- first/second/third visual fixation in the first viewport when that viewport owns orientation or conversion;
- component grammar consistency across surfaces, actions, radius/elevation, and icon treatment;
- background/surface/accent colors;
- borders, radius, shadows/elevation;
- container model (open layout vs card/panel/table/canvas/etc.);
- icon metaphor, stroke/fill, size, alignment, state;
- imagery crop, aspect ratio, blending, masks/overlays;
- whitespace and density;
- motion and state transitions;
- calibration-vector coherence across structure variance, motion energy, and information density when the active design contract declared one.

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

For material interactive components, verify the **state family** rather than only the default screenshot: default, hover, focus-visible, pressed/active, selected, disabled, loading/progress, empty, success, error, destructive, and offline/disconnected when the product can enter those states. Only require states that exist in the product contract; do not invent meaningless variants for static content.

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
