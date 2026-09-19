# Design synthesis and prototyping

Use this when a product surface needs to be **invented, materially re-shaped, or visually directed** before production UI implementation. This is the design-synthesis owner between product intent and code. It is deliberately tool-agnostic: a professional design canvas may improve the work, but a paid external design tool is never required for ordinary product engineering.

Do not use this for tiny styling fixes, established-component reuse, or implementation that already has an accepted design target. Route those directly to the appropriate frontend implementation/styling owner.

## Contents

- Design-synthesis contract
- Classify the product surface first
- Recover the existing design world
- Choose the highest-fidelity available design medium
- Generate a design thesis before generating screens
- Explore directions without generating cosmetic variants
- Compile the experience into an implementation-ready contract
- Prototype at the cheapest useful fidelity
- Use professional design tools when available
- Code-native design when no design canvas is available
- Design-to-code handoff
- Validate with real rendered evidence
- Anti-patterns

## Design-synthesis contract

Convert an unresolved product/experience problem into a bounded, implementation-ready design decision:

`product goal -> user/job -> surface type -> current evidence -> design thesis -> structure/flow -> visual system -> states/responsiveness -> component map -> accepted design contract -> implementation handoff`

The design owner decides **what the experience should be**. The styling owner decides how to express accepted visual intent through the repository's CSS/theme/token architecture. The frontend behavior owner decides client state/effects/forms. Rendered QA checks the real result. Do not let CSS experimentation silently become product design authority.

A material design result should make these questions answerable without inventing semantics during coding:

- Who is the primary user and what are they trying to accomplish?
- What is the dominant action or information priority on this surface?
- What is the page/screen anatomy and navigation model?
- What content/data is real, optional, loading, empty, unavailable, or erroneous?
- What visual hierarchy and brand/product character should be perceived first?
- Which existing components/tokens should be reused or extended?
- What materially changes across viewport/input/platform states?
- What dimensions are intentionally left to implementation judgment?

## Classify the product surface first

Do not apply one visual grammar to every repository. Identify the surface before designing it.

Typical classes:

- **public website / landing / marketing** - content hierarchy, brand expression, trust, proof, conversion, SEO semantics, responsive storytelling, load performance;
- **authenticated SaaS/web app** - task completion, navigation, data/state density, workflow continuity, permissions, recovery;
- **desktop workspace** - window/workspace semantics, persistent navigation, command density, native shell boundaries, multi-panel behavior;
- **mobile product** - touch reachability, progressive disclosure, interruption/re-entry, compact state, platform conventions;
- **developer tool / admin / operations UI** - precision, observability, power-user speed, bulk/keyboard operations, safe destructive actions;
- **content/editor/canvas product** - focus, selection, history, document/state identity, viewport/tooling interactions.

A repository using React, cards, or a component library does not imply a dashboard. A public homepage does not become stronger because it resembles an internal SaaS shell.

## Recover the existing design world

Before inventing a new visual language, inspect enough evidence to distinguish **system** from **accident**:

- current rendered representative routes/screens when available;
- existing design tokens, CSS variables, theme/config, typography, spacing/radius/elevation roles;
- canonical shared components and their variants;
- navigation/layout shells;
- brand assets, illustrations, icons, logos, imagery rules;
- current content voice and terminology;
- responsive behavior and important states;
- existing Figma/design file or accepted screenshots when provided;
- recent product/design docs only when they are current authority.

Use `scripts/frontend_style_fingerprint.py` when styling authority is unclear. Treat repeated literal values as navigation evidence, not automatic defects. Preserve distinctive product language that is coherent and useful; do not normalize every product into generic minimal SaaS.

## Choose the highest-fidelity available design medium

Choose the medium by the question being resolved, not by tool prestige.

1. **Accepted design source exists** - inspect it and preserve the dimensions it owns. Do not redesign around it unless the user reopened those decisions.
2. **Editable design canvas/tool is available** - use it when structure, component composition, visual comparison, or collaboration materially benefits from a separate design artifact.
3. **Image/visual generation is available** - use it for mood, visual thesis, illustration direction, or broad composition exploration. Treat generated pixels as concept evidence, not automatically as component geometry or product truth.
4. **Browser/desktop runtime is available** - use a disposable code-native prototype or the real product surface when interactive truth matters more than a separate canvas.
5. **No visual tool is available** - compile a precise text/wireframe/design-system contract and implement the thinnest reversible prototype in the existing product architecture.

Never block ordinary UI/product work solely because Figma or another paid design service is unavailable. Professional design tooling is an accelerator and collaboration surface, not the source of design judgment.

## Generate a design thesis before generating screens

Do not jump from "make it look good" to CSS. Write the smallest useful design thesis first.

A useful thesis covers:

- **product character** - e.g. precise/technical, calm/premium, playful/consumer, dense/professional;
- **information posture** - editorial, workflow-first, data-dense, task-focused, narrative;
- **hierarchy strategy** - what dominates first, second, and what intentionally recedes;
- **surface language** - flat, bordered, tonal, elevated, editorial, canvas-like, etc.;
- **type/space rhythm** - large expressive type vs compact utility; open vs dense spacing;
- **accent strategy** - where color/motion/depth are allowed to draw attention;
- **distinctive product cue** - one or two choices that make the product feel specific rather than generated-from-template.

The thesis must follow product evidence and existing brand/design authority. It is not a license to invent a new brand because the current interface is plain.

## Explore directions without generating cosmetic variants

Explore multiple directions only when the product question is genuinely unresolved and comparison is cheap enough to improve the decision.

A distinct direction changes at least one material product consequence: information hierarchy, navigation model, density, interaction model, content sequencing, visual thesis, or responsive behavior.

Bad "three directions":

- same card grid in blue;
- same card grid in purple;
- same card grid with gradients.

Better alternatives might be:

- editorial/narrative homepage centered on one product proof;
- product-led homepage centered on a live workflow/demo;
- technical trust homepage centered on architecture/integration credibility.

Evaluate candidates in this order:

`hard requirements/accessibility/platform -> user/task consequences -> design-system coherence -> implementation/maintenance burden -> residual preference`

Do not ask the user to choose when evidence can safely decide. Ask only for a real brand/product preference that cannot be inferred from current authority.

## Compile the experience into an implementation-ready contract

Before production implementation, capture only the dimensions that materially constrain code:

- target user/job and primary outcome;
- surface/page anatomy in reading/task order;
- navigation/entry/exit behavior;
- primary/secondary actions;
- information hierarchy and content priority;
- representative real content/data pressure;
- loading/empty/error/permission/offline/partial states when relevant;
- responsive/adaptive rules;
- accessibility/keyboard/focus requirements for critical paths;
- visual thesis and reusable token/component intent;
- component inventory: reuse / extend / new local / new shared;
- assets/imagery/illustration requirements;
- accepted variants or unresolved decisions;
- rendered acceptance criteria.

Use concrete descriptions rather than decorative adjectives. "Premium" is weak; "one dominant headline, one primary CTA, restrained neutral surfaces, no equal-weight feature-card wall above the fold" is actionable.

## Prototype at the cheapest useful fidelity

Use fidelity to answer uncertainty:

- **structure uncertain** -> text outline / semantic wireframe;
- **workflow uncertain** -> clickable or code-native interaction prototype;
- **visual thesis uncertain** -> visual concept/frame/moodboard;
- **component fit uncertain** -> small component composition spike;
- **responsive behavior uncertain** -> live layout prototype across representative widths;
- **technical feasibility uncertain** -> bounded implementation spike behind no false product authority.

Disposable exploration must remain disposable. Do not let a quick prototype become production architecture merely because it already exists.

## Use professional design tools when available

When the host exposes a design canvas or design-system connector, use it for work it is better at:

- create/edit frames and layouts;
- search/reuse design-system components, variables, and styles;
- inspect component variants and tokens;
- compare source design with screenshots;
- map design components to code components when supported;
- capture a live page into the design workspace for critique or redesign;
- produce editable design artifacts for human collaboration.

Do not copy tool-generated reference code blindly. Adapt the result to repository components, tokens, semantics, state ownership, and accessibility. A design connector can provide editable layers and metadata; it does not override product/repository truth.

If a canvas supports design-to-code mappings, prefer semantic mapping:

`design component -> existing repository component + variant + token roles`

rather than regenerating the visual element from raw CSS.

## Code-native design when no design canvas is available

A repository itself can be the design medium when the workflow remains deliberate.

Use this loop:

`design thesis -> semantic page skeleton -> existing component composition -> representative content/states -> run -> screenshot/inspect -> revise design contract -> refine`

Keep early changes reversible and scoped. Use existing routes/components/tokens first. If a broad visual direction is still uncertain, do not bury the uncertainty under hundreds of CSS declarations; resolve the design question before polishing.

For a new website or major screen, a good code-native prototype should include enough real behavior/content to expose hierarchy and layout pressure, but it does not need production backend wiring before the design question is resolved.

## Design-to-code handoff

After design acceptance, convert design artifacts into implementation ownership rather than treating screenshots as coordinate maps.

Map:

`page region -> semantic component -> existing/new owner -> state/data source -> layout rule -> token/style role -> responsive rule -> validation oracle`

Then route:

- visual styling/theme/token translation -> `frontend-styling-implementation-patterns.md`;
- client behavior/forms/async/state -> `frontend-implementation-patterns.md`;
- desktop shell/process/native constraints -> desktop/runtime owners;
- accessibility depth -> `accessibility-product-engineering.md`;
- final live comparison -> `visual-ui-quality-assurance-product-engineering.md`.

Avoid screenshot tracing by absolute coordinates unless the product itself is a fixed canvas. Prefer semantic layout primitives, content-driven sizing, reusable tokens, and established component contracts.

## Validate with real rendered evidence

A design is not proven by source code, an attractive mockup, or a component tree alone.

When runnable rendering is available:

- inspect the actual changed route/screen;
- use representative content rather than only ideal short strings;
- inspect primary viewport classes and meaningful interaction states;
- compare against the accepted design contract/source visual;
- check hierarchy, density, alignment, clipping, wrapping, focus, affordance, and responsive behavior;
- verify that implementation preserved product semantics rather than only appearance;
- iterate until material design comments are closed or explicitly deferred.

For public websites, also verify semantic structure, meaningful content order, primary CTA clarity, asset loading/layout stability, and mobile first-screen quality when relevant.

## Anti-patterns

Treat these as warning signs:

- coding the final UI before deciding information hierarchy or interaction;
- using CSS changes as the mechanism for discovering product structure;
- copying a generated design's raw code into a repository without component/token mapping;
- rebuilding existing components because a screenshot looks slightly different;
- turning every product into card grids, glassmorphism, gradients, or oversized rounded panels;
- generating fake logos, testimonials, usage numbers, ratings, certifications, or customer proof;
- making multiple visual directions that differ only by palette;
- absolute-positioning an ordinary responsive page to match one screenshot;
- optimizing one desktop frame while ignoring real content pressure or smaller widths;
- letting a prototype silently become authoritative production structure;
- blocking design work because a paid canvas/tool is unavailable.
