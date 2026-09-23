# Fidelity Protocol

Use this reference when implementing from an accepted screenshot, mockup, Figma frame, generated concept, or other visual source of truth.

## No unapproved reinterpretation

Preserve the accepted design's:
- visible copy;
- hierarchy and section order;
- first-viewport balance;
- density and whitespace;
- palette and color temperature;
- typography;
- spacing and geometry;
- borders, radii, shadows, gradients;
- container model;
- icon style;
- imagery treatment;
- interaction model.

Do not add decorative badges, kicker text, extra cards, gradients, glows, panels, or helper labels that were not in the reference unless functionally required and clearly documented.

## Color and media lock

Match the actual background/surface colors instead of "improving" them to nearby cream, gray, or tinted alternatives. Preserve image overlays, masks, edge fades, and crop treatment exactly when they are visually material.

If an image needs better blending, prefer matching assets, transparent cutouts, masks, or edge fades over adding an unapproved color wash on top.

## Typography audit

Check not only hero headings, but also:
- nav and buttons;
- tabs and filters;
- form controls;
- toolbar/sidebar/inspector text;
- table cells and chart labels;
- captions/metadata/status bars;
- command palettes and dialogs;
- mobile line breaks.

When needed, inspect computed font size, weight, line height, and tracking instead of judging by memory.

## Icon audit

Compare metaphor, outline/fill, stroke weight, optical size, alignment, color, padding, and interactive states. Prefer the existing product icon family if it matches. Create a small production-quality SVG only when necessary rather than swapping in a visually unrelated generic icon.

## Slice-by-slice implementation

For long or dense surfaces, implement and compare in slices:
1. first viewport / primary region;
2. correct visible drift;
3. continue to the next section/state;
4. repeat until the whole surface is complete.

This prevents small visual errors from compounding across a large page.

## Normalize before judging

Before filing visual mismatches, align the comparison state:

- same viewport/breakpoint;
- same content/data state;
- same theme/mode;
- same interaction state;
- equivalent crop/device frame;
- comparable image density when pixel dimensions differ.

Do not report drift caused only by browser chrome, canvas padding, device framing, or scale mismatch.

## Required fidelity surfaces

Every substantial comparison must explicitly inspect:

1. typography — family/fallback, weight, size, line height, letter spacing, wrapping;
2. spacing/layout — container size, alignment, margins, padding, gaps, radii, vertical rhythm;
3. color/tokens — surfaces, foregrounds, gradients, opacity, semantic state colors;
4. assets/media — correct subject, crop, scale, sharpness, icon family, imagery treatment;
5. copy/content — visible text, labels, hierarchy, truncation, metadata.

Also inspect responsive behavior and material interaction states when relevant.

## Finding severity

- **P0** — core use is broken, severe accessibility failure, or layout is unusable.
- **P1** — major visual or interaction mismatch users will clearly notice.
- **P2** — moderate fidelity, responsive, or state drift.
- **P3** — minor polish.

For substantial reference-led work, actionable P0/P1/P2 findings block a clean handoff when they can be fixed in the current environment. P3 findings may remain as follow-up polish.

## Verification order

1. Typecheck/build/lint/tests supported by the repo.
2. Run the real app.
3. Inspect the primary interaction flow.
4. Check desktop and at least one mobile-sized viewport when responsive.
5. Capture the latest implementation render.
6. Compare directly against the accepted reference using available image/browser inspection tools.
7. Fix correctable mismatches.
8. Remove temporary QA/debug artifacts before handoff.

If a rich browser tool is available, prefer it for navigation, screenshots, DOM/console inspection, and interaction checks. If it is unavailable, use the best available browser or local preview workflow and record the limitation.

## Fidelity ledger

Before handoff on substantial reference-led work, account for at least five concrete comparison points spanning:
- copy/IA;
- layout/alignment;
- typography;
- palette/gradients;
- asset/media treatment;
- spacing/container model;
- iconography;
- responsive behavior;
- interaction/motion.

For each unresolved mismatch, note whether it is intentional, blocked by unavailable assets/components, or still needs correction. Never claim pixel-perfect or 10/10 fidelity when the evidence does not support it.
