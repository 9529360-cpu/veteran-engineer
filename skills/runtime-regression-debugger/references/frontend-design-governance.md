# Frontend design governance

Use this only when design scope or authority itself is a material engineering problem: refinement versus redesign, accepted-design identity/versioning, long-running or delegated implementation, stale design/code authority, stage exits, or pressure to skip design-before-code. Ordinary UI work should stay on `frontend-product-patterns.md`; visual-system decisions belong in `frontend-visual-system-patterns.md`.

## Contents

- Decide whether the task preserves or replaces the visual world
- Version accepted design when stale implementation is possible
- Design authority and change control
- Design-before-code stage exits
- Red flags that mean the design gate is being skipped

### Decide whether the task preserves or replaces the visual world

Classify substantial appearance work before styling so the agent does not accidentally blend incompatible scopes:

- **refinement** preserves the incumbent product identity, factual copy, workflow/behavior, information architecture, and everything outside the requested defect surface. Improve craft, consistency, hierarchy, accessibility, or density without inventing a replacement visual world.
- **redesign** may replace the incumbent visual language and composition where authorized, but it must preserve product truth, reachable functionality, native/platform affordances, data/security semantics, and explicit constraints unless those dimensions were separately reopened. Treat the discarded look as evidence or anti-reference, not as a palette that must survive by inertia.

Do not split the difference by layering a new theme on top of a visual system the redesign has already rejected. Mixed old/new token families, duplicated component grammars, and partial chrome swaps usually create more design debt than either direction alone. If the request is ambiguous between refinement and redesign and repository/user evidence cannot resolve the intended scope, clarify only that scope boundary; do not ask the user to choose low-level styling details.

### Version accepted design when stale implementation is possible

For a long-running, delegated, or parallel implementation, give the accepted design/experience contract a stable identity or revision that downstream work can bind to. This can be a design-doc revision, commit/blob hash, Figma/version identifier, accepted mock artifact id, or a task-local contract generation; use the lightest identity the workflow can actually verify. Tiny single-agent consistency fixes do not need version ceremony.

Include that identity in implementation/delegation packets. If the user or product owner reopens a material design dimension and a new contract supersedes the old one, mark work still based on the previous revision as stale until it is compared against the new contract. Do not integrate an old worker result merely because its code/tests are green.

Use this transition:

`accepted design Dn -> worker binds Dn -> design changes -> Dn+1 supersedes Dn -> old work classify: still compatible / needs rebase-redesign / discard -> validate against Dn+1`

The new revision invalidates only the dimensions it actually changed. A typography-token revision does not automatically invalidate a backend migration; a new workflow/IA decision may invalidate large parts of a UI implementation. Preserve completed work that remains contract-compatible instead of restarting by ritual.

The design contract should resolve only the dimensions that materially affect the screen or workflow:

`audience + job -> current surface -> entry/exit flow -> information architecture -> layout/hierarchy -> visual concept -> type/color/spacing roles -> interaction/state behavior -> responsive/window behavior -> content/edge pressure`

Before choosing art direction for a broad surface, classify its dominant product mode from the user's job rather than from aesthetic vocabulary. Useful classes include:

- **workspace/product tool** - optimize repeated task throughput, context, command access, and durable state; persistent chrome should stay quiet;
- **data/decision surface** - optimize scanning, comparison, freshness/scope, filters, tables/charts, and drill-down;
- **marketing/brand surface** - optimize narrative, product signal, persuasion, and a deliberate first impression;
- **editorial/content surface** - optimize reading/navigation rhythm, typography, media, and sustained comprehension;
- **transactional/service flow** - optimize trust, commitments, steps, validation, recovery, and low-distraction completion;
- **immersive/experimental surface** - allow stronger art direction only when the product/job justifies its accessibility, performance, and maintenance cost.

Then write one concise visual thesis that fits that mode and the product vernacular. Do not import the signature grammar of a different mode just because it looks fashionable: a workspace does not need a landing-page hero, a decision dashboard does not need fake metric mosaics, and a checkout flow does not benefit from decorative motion that competes with commitment and error recovery.

### Design authority and change control

Treat design evidence as an authority ladder, not a bag of suggestions. For the current task, prefer in this order unless a higher-level source explicitly changes the lower one:

1. current explicit user requirements and constraints;
2. a visual/interaction target the user has accepted for this task;
3. project-local design authority such as `DESIGN.md`, Figma, tokens, component contracts, or maintained product guidelines;
4. active in-product patterns that are demonstrably current;
5. external references or competitor observations used as evidence;
6. generic design heuristics.

Once a target is accepted, treat it as the active production design spec. Implementation must not silently reinterpret layout, hierarchy, visible copy, density, component family, spacing model, imagery treatment, or interaction behavior merely because another version is easier to code. When a real platform/data/accessibility constraint makes the target impossible or harmful, reopen that specific design clause, record the constraint, choose the smallest compatible deviation, and then update the implementation oracle.

Design authority is **dimension-scoped**. A source governs only what it actually specifies or reliably demonstrates. A static screenshot can be strong authority for visible composition, hierarchy, copy, density, and visual treatment, but it does not silently define authorization, persistence, retry semantics, destructive-action reversibility, hidden loading/error behavior, or other product state that the artifact cannot show. A Figma prototype with documented interactions governs more interaction behavior than a flat frame; a maintained product spec may govern semantics that no image can express. Combine authorities per dimension instead of letting one artifact become a total-product oracle.

Before implementation, separate two coupled contracts when the feature is non-trivial:

1. **experience/product contract** - user goal, action semantics, scope, information architecture, state transitions, reversibility, feedback, recovery, and completion;
2. **presentation contract** - layout, hierarchy, density, typography, color/material, component expression, responsive/window composition, and visible interaction treatment.

The presentation contract must serve the experience contract. A beautiful accepted frame cannot justify changing product semantics, and a correct state machine does not excuse a visually unresolved surface.

For a broad surface, the target must cover the whole requested experience rather than a polished hero/header fragment. Include the primary screen composition plus any states, panels, modals, inspectors, tables, forms, responsive/window transformations, or assets whose omission would force the engineer to invent important design decisions during implementation.

Design tooling is optional; design work is not. Use screenshots/vision, browser or desktop rendering, Figma, image generation, or a dedicated design capability when available. Without them, write a concrete wireframe/design specification and use it as the implementation oracle instead of skipping directly to styling.

Before implementation, run a distinctiveness check. The interface should look like a deliberate response to this product and audience, not a generic generated dashboard. Treat these as warning signs unless the brief actually calls for them: identical rounded cards for unrelated content, one radius/elevation everywhere, arbitrary glass/gradient decoration, decorative all-caps eyebrow labels, placeholder metric tiles, default hero/stat patterns, or motion applied uniformly to every card/section. Spend visual emphasis where it communicates product meaning; keep the rest disciplined.

Ground visual language in the product's real work. Use real domain nouns, representative content density, actual actions, credible state labels, and the product's own instruments/artifacts/vernacular when forming the design. Placeholder metrics, invented system jargon, fake activity feeds, and generic developer chrome distort hierarchy and often manufacture a dashboard the product never needed. If content is unknown, model the smallest representative content set needed to test the layout and mark assumptions rather than decorating empty containers.

When the brief benefits from visual identity, choose one product-specific signature idea and let the surrounding system stay quieter. The signature can be structural, typographic, spatial, material, or interaction-driven; it should encode something true about the product rather than decorative novelty. Utility-heavy enterprise surfaces may intentionally choose restraint instead.

Use a hierarchy-before-decoration test before committing to effects. The interface should remain understandable if gradients, blur, shadows, accent colors, and decorative motion are mentally removed. Establish structure, grouping, typography, spacing, and action hierarchy first; then add color/material/elevation; add decorative motion or expressive effects last. If removing decoration collapses the hierarchy, fix the hierarchy rather than intensifying the decoration.

### Design-before-code stage exits

For substantial UI work, make the design phase falsifiable instead of ceremonial. Use these exits:

1. **Surface audit exit** - identify the actual user job plus the current hierarchy, navigation/workflow, density, visual-language, and state problems from rendered evidence when possible.
2. **Design direction exit** - state one coherent product-specific visual thesis and the structural decisions that support it. `clean`, `modern`, `premium`, `native`, or `minimal` alone are not directions.
3. **Plan-design review exit** - before production UI code, check that the plan specifies what the user sees in normal, loading, empty, error, disabled/permission, long-content, and relevant responsive/window states. Fix missing design decisions in the plan, not during CSS improvisation.
4. **Implementation exit** - every material layout, theme, interaction, and workflow clause maps to a real component/state/data owner. Preserve the chosen design intent instead of replacing it with whatever is easiest to style.
5. **Live-design review exit** - inspect the real rendered surface after implementation, compare it with the design contract, fix meaningful misses, and re-render. Source review is not a substitute.

Before crossing from design into implementation, create an implementation inventory from the active target: visible copy, screen/section order, component families, state variants, token roles, responsive/window transitions, asset/media treatments, and the existing source owners that will implement each part. The inventory is a translation boundary, not a second design. It prevents the implementation phase from quietly inventing a different product.


When implementation is delegated to another worker/agent, turn that inventory into a compact **design-intent packet** instead of sending a screenshot plus `make it match`. Include only what the receiver needs to preserve intent:

- source authority/provenance: accepted frame/mockup/spec and project design-system owner;
- accepted dimensions: layout/hierarchy, interaction/state, responsive/window behavior, and visual-system clauses actually fixed by the target;
- token/component references and existing source owners to reuse or extend;
- representative content/assets plus their provenance/rights constraints when material;
- a **reachable state/content-pressure matrix** for the states the product can actually enter: normal plus relevant loading, empty/first-use, error/retry, disabled/read-only/permission, processing/success, long/localized content, missing/partial data, and compact/wide window cases; name which authority defines semantics when the accepted visual target does not show a state;
- hard constraints and explicit `do not` deviations;
- observable acceptance criteria and rendered proof target;
- unresolved clauses that the worker must escalate rather than invent.

Keep the packet semantic and source-linked rather than copying a giant design transcript. A receiver may choose implementation mechanics inside the contract, but it must not originate new product or aesthetic decisions on accepted dimensions. If the target or design system changes, refresh the packet before dependent work continues.

Keep pre-implementation design review and post-implementation design QA separate. The first prevents undefined experience decisions from leaking into code; the second catches implementation drift, content pressure, platform rendering, and interaction defects.

### Red flags that mean the design gate is being skipped

Treat these thoughts or behaviors as evidence to stop styling and recover the missing design target:

- `I can make it modern quickly and refine the design later.`
- `The component library already gives us the design.`
- `It is Electron/React/SwiftUI work, so this is mainly a platform implementation task.`
- `The build passes and the screenshot is cleaner, so the redesign is done.`
- `I changed colors, radii, blur, and spacing, so the layout request is covered.`
- `I will decide empty/error/loading/responsive states after the happy path looks good.`
- `The user asked me to implement, so creating a visual target would be unnecessary ceremony.`

These are shortcuts, not completion evidence. The remedy is the smallest missing design artifact or decision that makes the next implementation step falsifiable.
