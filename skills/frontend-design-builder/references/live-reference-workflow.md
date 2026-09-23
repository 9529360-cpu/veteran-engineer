# Live Reference Capture and URL-to-Code

Use this reference when the user explicitly wants to recreate or faithfully implement a live website/app surface from a URL.

A live URL can be:
- **authority** when the user explicitly wants a faithful recreation and has the right to do so;
- **evidence/inspiration** when the user asks to redesign, improve, or make something "like" the source.

Do not silently turn a style reference into a cloning task.

## Rights boundary

Proceed with faithful recreation only for a site/app the user owns, controls, or has permission to reproduce. Do not bypass login, paywalls, access controls, or technical restrictions to obtain protected material.

## Capture before code

Do not scaffold a faithful clone from memory.

1. Open the exact target URL and confirm the correct page/state.
2. Reject blocked, login, loading, install-promo, error, or unrelated redirect states as source evidence.
3. Capture the full desktop experience in small scroll increments.
4. Capture the relevant mobile state, normally around a 390px-wide viewport when the product is responsive.
5. Record sticky/fixed elements, lazy-loaded sections, breakpoint changes, and content that changes after scrolling.
6. Inspect available DOM/style/layout evidence for:
   - visible text and hierarchy;
   - containers, grids, spacing, size constraints;
   - colors, borders, radii, shadows;
   - fonts and type roles;
   - images, SVGs, videos, icons, background media;
   - controls and their states;
   - responsive behavior.
7. Test important interactions one at a time and return to a known baseline between tests.

Source capture is complete only when the intended implementation scope is represented by real evidence.

## Asset integrity

Prefer original assets only when the user has the right to reuse them and the environment can retrieve them lawfully.

Do not hotlink production assets in the recreated app.

If an asset cannot or should not be reused:
- preserve supplied/user-owned brand assets;
- use the closest appropriate open icon/font when a licensed source asset is unavailable;
- generate a new replacement for bespoke decorative imagery when appropriate;
- document material replacements.

Do not replace important logos, illustrations, product images, custom icons, or decorative marks with emoji, text glyphs, crude CSS shapes, or placeholder blocks.

## Interaction capture

For visible interactive controls, inspect:
- navigation/links;
- menus/drawers;
- tabs/accordions;
- forms/inputs;
- modals/dialogs;
- carousels;
- sticky behavior;
- hover/focus/pressed/selected states when material.

A static screenshot does not prove interaction behavior. Capture the state transition or DOM/behavior evidence.

## Build from evidence

For a faithful recreation:
- preserve captured copy, IA, hierarchy, density, typography, imagery treatment, and responsive behavior within the agreed scope;
- keep controls code-native;
- reuse the target repository's existing system when implementing inside an existing project;
- do not add creative improvements unless the user asks for a redesign.

For a redesign:
- use the live product as current-state evidence and/or inspiration;
- create a new explicit design contract before implementation;
- do not accidentally retain clone-level fidelity as an unstated requirement.

## Verification

Run the implementation and compare it against the source at matching states.

Verify:
- desktop/current target viewport;
- mobile when applicable;
- captured interactions;
- browser console/runtime health when the tool supports it;
- the five fidelity surfaces from `fidelity-protocol.md`.

Use `fidelity-protocol.md` as the blocking visual comparison loop for substantial faithful recreation.

Do not substitute build success, HTTP health, or a server-start message for rendered verification.

## Handoff

State:
- source URL/surface used;
- viewports/states captured;
- interactions verified;
- assets/fonts/icons replaced and why;
- any inaccessible source state;
- remaining fidelity gaps.

If capture or visual comparison was blocked, say that the fidelity claim is blocked rather than calling the recreation complete.
