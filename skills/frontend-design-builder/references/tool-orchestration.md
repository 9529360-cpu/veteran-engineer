# Tool Orchestration and Graceful Degradation

Use available tools to complete the design-to-implementation loop. Do not assume a tool exists merely because it would be useful.

## Repository and code access

When a repository, branch, pull request, or code-hosted project is part of the task:
- Prefer the authenticated repository connector when available and appropriate.
- Inspect the existing project structure, package manager, framework, component library, token/theme files, routing, and testing setup before proposing structural changes.
- Use local filesystem/terminal execution when the environment provides it and the task requires real implementation or verification.
- Never claim code was changed, built, or tested unless the corresponding write/execute capability was actually available and used.

## Figma and design sources

When a Figma source is supplied and Figma tooling is available:
- Use the Figma integration according to its own prerequisite workflow.
- Treat the selected frame/component and its design context as the primary design source.
- Extract reusable variables, component structure, typography, spacing, and assets rather than eyeballing them when exact data is available.
- If the Figma integration is unavailable, work from user-provided screenshots/exports and clearly distinguish faithful reconstruction from exact source extraction.

## Image generation

Use image generation when original visual concepting or bespoke graphical assets materially improve the product. Good uses include hero art, illustrative surfaces, texture, empty-state art, game art, and visual direction exploration.

Do not generate images merely to decorate a UI that is better served by typography, layout, icons, or code-native graphics. Keep functional interface elements code-native.

## Browser / rendered inspection

When browser, computer-use, preview, or screenshot tooling is available:
- Run the app or open the provided URL.
- Inspect the actual rendered surface at the target viewport.
- Test critical interactions and at least one smaller viewport when responsive behavior matters.
- Compare screenshots against the accepted reference and fix visible mismatches.

When rendered inspection is unavailable:
- Still run available typecheck/build/tests.
- Perform static review of CSS/layout/responsive logic.
- State that final visual QA remains unverified; never call the result pixel-perfect.

## Web research

Use web research only when current external facts materially affect the interface, library/API behavior, browser compatibility, or user-requested references. Prefer official documentation for framework/library claims.

## Missing tools

Optional tooling must not create a dead end. Choose the strongest available path and continue. Ask the user only when a missing input is truly necessary to determine the product or implementation; do not ask merely because an optional design tool is unavailable.


## Pattern libraries and design research

When Mobbin or a comparable reference library is available, use it for bounded pattern research, not as an automatic source of truth. Search screens for one state, flows for journeys, and sections for public-web patterns. Inspect actual imagery before drawing conclusions. Read `references/reference-research.md`.

## Storybook and component labs

When Storybook or an equivalent component catalog exists in the repository, inspect it before recreating component states. Reuse the repository's own stories, interaction tests, accessibility checks, and visual regression commands where available. Read `references/component-lab.md`.

## Other design tools

For Framer, Sketch, Penpot, ProtoPie, Principle, or other design sources without a dedicated connector, use exports, screenshots, specs, tokens, or repository artifacts as available. Apply the same authority/evidence model from `references/design-source-authority.md`; do not claim structured extraction that was not performed.


## Live URL capture

When a user explicitly asks to faithfully recreate a live URL they are authorized to reproduce, read `references/live-reference-workflow.md` before coding. Use browser/rendered tools to capture desktop/mobile, DOM/layout, assets, and material interactions first. A live page that is blocked, logged out, half-rendered, or redirected is not valid fidelity evidence.

When the user asks for a redesign or says "like this site," treat the URL as evidence/inspiration unless they explicitly establish it as the target. Do not silently switch into clone mode.


## Design Action Fabric

For tool-heavy design work, read `design-action-fabric.md`. Route the requested design intent against the tools actually exposed by the current host before choosing Figma or a fallback. Treat design tools as capability providers, not as permanent product architecture.
