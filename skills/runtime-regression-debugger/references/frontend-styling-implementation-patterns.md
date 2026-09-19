# Frontend styling implementation patterns

Use this when an accepted UI/design contract must be translated into production styling: CSS, Tailwind or other utility classes, CSS Modules, Sass/Less, CSS-in-JS, theme systems, design tokens, component variants, or responsive layout rules. This reference owns **how visual intent is implemented in the repository's real styling architecture**. It does not redefine product hierarchy or visual direction; keep those under `frontend-product-patterns.md` and `frontend-visual-system-patterns.md`.

## Contents

- Recover the real styling authority
- Map design decisions to code owners
- Avoid accidental hardcoding
- Implement layout and responsive behavior structurally
- Work with common styling architectures
- Translate screenshots/Figma without pixel tracing
- Keep component and token ownership coherent
- Validate rendered styling

## Recover the real styling authority

Before adding CSS, determine how the active product actually produces styles. Inspect only the evidence needed for the changed surface:

- component library and existing primitives;
- theme providers, token files, CSS custom properties, typography and spacing scales;
- Tailwind/utility configuration and shared class/variant helpers;
- CSS Modules, global stylesheets, Sass/Less layers, CSS-in-JS or framework styling APIs;
- reset/base styles, cascade/layer order, generated CSS and host/runtime overrides;
- representative components that already solve similar layout/state problems.

When the styling owner is unclear, use `scripts/frontend_style_fingerprint.py <repo-root> --json` as a navigation aid, then verify the reported candidates against imports, build configuration and rendered/computed styles. The script detects evidence; it does not decide the correct design system.

Do not introduce a second styling architecture just because another library is familiar. A React project using CSS Modules should not acquire Tailwind for one screen; a tokenized Tailwind system should not accumulate an unrelated sheet of raw values merely because it is faster for one patch.

## Map design decisions to code owners

Before substantial styling work, translate the accepted design into a small implementation map:

`design decision -> existing primitive/token/layout owner -> local composition -> rendered evidence`

Typical decisions include:

- page/shell geometry;
- type roles and text density;
- spacing rhythm;
- surface/background/border/elevation roles;
- control variants and interactive states;
- responsive transitions;
- content-pressure behavior;
- motion/state transitions.

Prefer an existing semantic component or token when it already owns the decision. Create a new reusable token/variant only when the value has reusable semantic meaning or multiple consumers; keep truly local geometry local.

## Avoid accidental hardcoding

Do not equate every literal with bad code. A `1px` border, an asset's intrinsic ratio, or a one-off local geometry value can be correct. The problem is an **unexplained literal that bypasses a shared semantic owner, duplicates a system value, or accumulates as corrective nudges**.

Treat these as review signals, not automatic failures:

- repeated raw colors instead of semantic color roles;
- repeated spacing/radius/font values that already exist in the product scale;
- arbitrary utility values used repeatedly;
- local `z-index` ladders without a layer model;
- `!important` used to defeat an unknown cascade owner;
- deep selectors that reach into another component's internals;
- negative margins/transforms used only to visually nudge a mis-modeled layout;
- static inline style objects when the repository already has a normal class/token path;
- many nearly identical media queries or breakpoints.

Prefer semantic tokens for reusable meaning: `surface-muted`, `text-secondary`, `space-panel`, `radius-control`, not aliases whose only meaning is `#18181b` or `14px`.

Use inline/runtime styles when the value is genuinely calculated at runtime, such as measured coordinates, user-controlled dimensions, progress, canvas-like geometry, or a value intentionally exposed through a CSS custom property. Keep static visual rules in the repository's ordinary style owner.

## Implement layout and responsive behavior structurally

Do not reconstruct a screenshot as absolute coordinates.

Prefer layout primitives that express relationships:

- Grid for two-dimensional tracks and aligned regions;
- Flexbox for one-dimensional distribution/alignment;
- intrinsic sizing, `minmax()`, `clamp()`, `min()`, `max()`, container queries or the project's existing responsive primitives when they fit;
- normal document flow for content whose height/length can change.

Use absolute/fixed positioning when the product semantics call for overlays, popovers, badges, anchored controls, decorative layers or other intentionally detached geometry. Do not use it as the default method for placing ordinary page content.

Choose responsive transitions from content pressure and task priority. Reuse established breakpoints/container rules when they encode the right boundary. Do not add a breakpoint solely to make one screenshot look correct if the underlying component constraint is wrong.

Avoid fixed heights for variable content unless clipping/scrolling is an explicit product contract. Test long labels, localization, zoom/font scaling and realistic data before concluding that a layout is stable.

## Work with common styling architectures

Follow the repository's active architecture rather than applying a universal favorite.

### Tailwind / utility-first

- Prefer configured semantic/theme utilities and established composition helpers.
- Use arbitrary values (`[...]`) for justified exceptions, not as a substitute for understanding the theme.
- If the same arbitrary value or class cluster repeats, consider an existing token, variant/helper, or component owner before copying it again.
- Preserve the project's variant/class-composition convention (`cva`, helpers, component variants, etc.) when present; do not invent a competing abstraction.

### CSS Modules / scoped CSS

- Keep selectors local to the component contract; avoid reaching through implementation details of neighboring components.
- Reuse project variables/tokens instead of cloning raw values.
- Prefer explicit variants/state attributes over brittle selector depth when component state is semantic.
- Keep global rules in the actual global/base owner rather than escaping module scope ad hoc.

### CSS-in-JS / framework theme APIs

- Use the active theme/token/variant mechanism when it owns the value.
- Keep dynamic styling tied to real runtime state; avoid generating large one-off style objects for static design rules.
- Preserve server/client rendering and extraction constraints of the chosen library/framework.

### Global CSS / Sass / Less

- Respect layer/import order and existing naming/architecture conventions.
- Put reusable variables/mixins in their real shared owner only when the repository uses that model.
- Avoid expanding global selector reach to solve a component-local defect.

### Component libraries

Treat library primitives as implementation infrastructure, not the product design itself. Prefer supported variants, slots, tokens and composition before override chains. If the product needs behavior or appearance the primitive cannot express cleanly, create an owned wrapper or choose a more appropriate primitive rather than stacking fragile selectors against library internals.

## Translate screenshots/Figma without pixel tracing

When a screenshot, Figma frame or visual reference is the target, recover **constraints and semantics**, not only coordinates.

1. Identify regions, reading order, hierarchy and reusable component families.
2. Recover the active product tokens/components and map the target onto them.
3. Infer layout relationships: alignment, gaps, track behavior, max widths, anchoring, overflow and responsive transitions.
4. Implement structure first, then typography/space, then surface/color/depth, then motion/decoration.
5. Render the real route/state and compare against the target.
6. Repair the smallest owning rule: shared token/component when the mismatch is systemic, local composition when it is local.

If a structured design source exposes variables, components, constraints or variants, prefer those explicit semantics over eyeballing a raster screenshot. A screenshot remains valuable rendered evidence, but it should not force brittle coordinate-by-coordinate CSS.

Do not pursue pixel identity at the expense of responsive behavior, accessibility, real content, platform conventions or product semantics. Conversely, do not dismiss visible spacing/type/hierarchy drift merely because the component tree is technically clean.

## Keep component and token ownership coherent

Separate these responsibilities:

- **primitive/component**: semantic reusable behavior and supported visual variants;
- **token/theme**: reusable product-wide visual meaning;
- **layout/composition**: relationship among components for this screen/feature;
- **local exception**: genuinely local geometry or presentation with no reusable semantic meaning.

Do not promote every number into a token. Do not bury a repeated semantic decision in dozens of local classes. Promote only when reuse/meaning justifies shared ownership.

When changing a shared token or primitive, inspect representative consumers before declaring the UI fixed. A global fix that improves one screenshot but breaks another surface is not a successful design-system repair.

## Validate rendered styling

Source review cannot prove visual correctness. For meaningful UI changes, render the real changed state and inspect at the viewports/content states that can falsify the implementation.

Check at least the relevant dimensions:

- visual hierarchy and spacing rhythm;
- alignment and track behavior;
- wrapping/truncation/overflow;
- control states and focus treatment;
- long/empty/error/loading content;
- responsive transitions;
- computed styles when token/cascade authority is uncertain;
- screenshot/Figma comparison when a visual target exists.

If a mismatch is fixed by another unexplained local override, stop and identify the actual owner before adding a second patch. Repeated CSS correction layers are evidence that the implementation map or style authority is wrong.
