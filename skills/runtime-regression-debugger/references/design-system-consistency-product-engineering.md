# Design system and UI consistency product engineering

Use this when a product has repeated UI patterns, tokens, primitives, variants, themes, density modes, or legacy surfaces whose consistency affects product quality across more than one screen.

A design system is not a component gallery and not a reason to redesign a coherent product. It is the shared contract that keeps visual roles, interaction semantics, accessibility behavior, content pressure, and reusable implementation aligned across product surfaces.

The central contract is:

`active product surfaces -> drift/inventory evidence -> canonical token/primitive/variant owner -> shared fix or intentional exception -> compatible adoption -> rendered/accessibility verification -> legacy cleanup`

The goal is not maximum reuse. The goal is one clear owner for genuinely shared semantics, with intentional product-specific composition above it.

## First decide whether the defect is local or systemic

Do not turn every UI inconsistency into a design-system project.

Treat a finding as systemic when evidence shows one or more of these:

- the same semantic role is implemented differently across several active surfaces;
- several product components duplicate the same primitive behavior or styling contract;
- raw values repeatedly bypass established semantic tokens;
- one shared primitive causes repeated downstream regressions;
- old and new component families coexist without a migration boundary;
- the same variant name means different product states in different consumers;
- responsive, accessibility, localization, or theme behavior diverges because ownership is fragmented;
- teams cannot safely change a shared visual/interaction role without searching and patching many consumers.

Keep the fix local when the exception is genuinely product-specific, one-off, or better expressed in a product wrapper than in a shared primitive.

A shared abstraction is harmful when it erases real semantic differences merely because two things look similar.

## Recover the existing design language before changing it

Before adding tokens or primitives, recover the current authorities:

- semantic design tokens and their source files;
- CSS variables, theme maps, platform tokens, or generated token artifacts;
- shared primitive/component packages;
- product-specific wrappers and composites;
- typography, spacing, radius, border, elevation, motion, and status roles;
- component variants and state semantics;
- responsive conventions and layout primitives;
- accessibility ownership for names, roles, focus, errors, and live status;
- localization and content-length constraints;
- old component libraries or legacy styling islands still on active paths;
- rendered evidence from representative product surfaces.

Do not infer authority from whichever file has the most CSS. Trace active consumers and build/runtime wiring.

If the current product is coherent, preserve it. A new library, trendy aesthetic, or personal preference is not evidence that the existing system should be replaced.

## Tokens are semantic roles, not a bag of values

A useful token names product/design meaning rather than one accidental pixel value.

Prefer roles such as:

- text primary/secondary/muted;
- surface/base/elevated/selected;
- border subtle/strong/focus;
- action primary/secondary/destructive;
- status success/warning/error/information;
- spacing/layout roles when stable repetition justifies them.

Avoid creating dozens of aliases that merely rename raw values without improving ownership. Avoid binding product policy to visual tokens.

Changing a token can fan out across many consumers. Before changing a shared token, recover:

- semantic intent;
- affected surfaces;
- contrast/accessibility implications;
- theme/mode implications if those modes actually exist;
- old/new bundle or independently deployed consumer compatibility when applicable;
- visual verification coverage.

## Primitive versus product wrapper ownership

Keep low-level primitives responsible for reusable interaction and presentation semantics. Keep business/product policy in product wrappers or domain components.

A primitive may own:

- semantic role and accessible mechanics;
- size/density variants;
- focus/hover/pressed/disabled/loading presentation;
- token consumption;
- content slots and composition boundaries;
- responsive behavior intrinsic to the primitive.

A product wrapper may own:

- entitlement or permission decisions;
- destructive-operation policy;
- domain-specific validation;
- API mutation behavior;
- product copy and analytics;
- workflow-specific loading or recovery state.

Do not put `isPremium`, `canDeleteCustomer`, or tenant policy into a generic button/card/dialog primitive merely to centralize code.

## Variant names must carry stable semantics

Variants are contracts, not styling shortcuts.

If `destructive`, `warning`, `selected`, `compact`, or `loading` exists, define what the variant means and where it is valid.

Avoid patterns where:

- one component uses `danger` for destructive actions while another uses it for informational red emphasis;
- `primary` means “most important action” on one screen and “brand-colored decoration” on another;
- loading removes an accessible name or changes layout unpredictably;
- disabled and permission-denied states look identical despite different recovery paths;
- size variants silently change interaction semantics.

When names have drifted, choose one canonical semantic model and migrate consumers deliberately rather than layering more aliases forever.

## Interaction-state consistency is part of the system

A shared visual language includes reachable states, not only resting screenshots.

For shared controls and product patterns recover the intended behavior of:

`rest -> hover/focus -> active -> validating/submitting -> processing -> success`

and material exceptional states such as:

`disabled`, `validation-error`, `permission-denied`, `conflict`, `offline`, `retrying`, `partial`, `terminal-failure`, `stale`.

The same product state should not be expressed with contradictory status language, color roles, focus behavior, or recovery affordances across comparable surfaces.

Do not flatten materially different states merely for visual consistency.

## Consistency under content pressure

A component is not reusable if it only works with short English fixture text.

Validate representative shared components under:

- long labels and descriptions;
- localization expansion;
- RTL when the product supports it;
- large numbers, dates, identifiers, and user-generated content;
- empty, error, permission, and partial-data states;
- compact and wide layouts relevant to active products;
- zoom/text scaling;
- keyboard and touch target constraints.

Use `globalization-product-engineering.md` when locale, RTL, input, time, or regional behavior is material.

## Accessibility cannot be a skin-level exception

Shared primitives amplify accessibility behavior across the product.

A shared change must preserve, when material:

- native semantics or correct ARIA ownership;
- accessible names and descriptions;
- keyboard operation;
- visible and unobscured focus;
- error association;
- status announcements;
- contrast and non-color cues;
- reduced-motion behavior;
- logical focus/task order.

A primitive that looks consistent but changes meaning for keyboard or assistive-technology users is not a successful design-system migration.

Use `accessibility-product-engineering.md` for the authoritative accessibility boundary.

## Theme, color mode, and density are optional product contracts

Do not invent dark mode, compact mode, or theme customization because design systems often have them.

If the product already supports a mode, define:

- mode authority and persistence;
- token transformation ownership;
- system/preference inheritance if applicable;
- transition behavior;
- mixed old/new surface behavior;
- contrast and asset behavior;
- SSR/hydration or native-shell boundary when relevant.

If the product does not support such a mode, record it as out of scope rather than creating speculative infrastructure.

## Detect and classify drift

Useful drift evidence includes:

- duplicated primitives with equivalent semantics;
- repeated raw token values where semantic tokens already exist;
- divergent component props for the same role;
- inconsistent status/action terminology;
- variant proliferation without distinct semantics;
- legacy CSS/component islands on active routes;
- visual evidence showing inconsistent hierarchy, spacing, density, or state treatment;
- recurring accessibility fixes applied independently to sibling components.

Classify each finding:

- **canonical-owner defect** - fix the shared owner;
- **consumer misuse** - migrate the consumer to the existing contract;
- **missing shared contract** - add the smallest reusable owner justified by repetition;
- **intentional exception** - document why the product-specific behavior should remain different;
- **legacy path** - define migration and removal;
- **taste-only difference** - do not churn the product.

Do not use a lint rule as the authority for semantics. Static checks can find drift candidates; active product behavior determines whether they are defects.

## Migrate without a visual flag day

Large products often cannot replace every consumer atomically.

Prefer compatible sequencing:

`define canonical contract -> support compatible old/new consumers -> migrate representative high-value surfaces -> expand adoption -> verify -> deprecate old API/token -> remove legacy owner`

When a shared package is independently versioned, define consumer compatibility explicitly. When one application ships atomically, do not manufacture a distributed migration problem that does not exist.

For prop/variant/token changes:

- prefer additive compatibility before removal when consumers cannot move together;
- prevent old and new names from developing different semantics during migration;
- keep deprecation measurable and bounded;
- give temporary aliases a removal condition;
- avoid permanent dual ownership.

Rollback of code is not enough if a migration changed persisted user preferences or externally distributed packages. Define forward repair where rollback cannot restore the previous state safely.

## Shared changes need fanout-shaped validation

A shared primitive can pass its isolated demo while breaking real consumers.

Validate at least:

1. the canonical primitive/token contract;
2. representative high-traffic or high-risk consumers;
3. different content pressure/state combinations that can falsify the change;
4. accessibility behavior for critical interactions;
5. responsive behavior on the viewport classes the consumers actually support;
6. old/new consumers during a migration window when versions can coexist;
7. one product-visible boundary, not only a Storybook or detached component harness.

For material visual changes, use `visual-ui-quality-assurance-product-engineering.md` and its evidence matrix. A component showcase is useful evidence but is not proof that the integrated product remains coherent.

## Treat exceptions as owned decisions

Perfect uniformity is not the goal.

An intentional exception is valid when a different semantic or task requirement justifies it. Record:

- the product reason;
- the owning surface/component;
- why the canonical primitive/variant is insufficient;
- whether the exception is permanent or temporary;
- the reevaluation/removal trigger when temporary.

Do not create a global variant merely to make one exceptional screen easier to style.

## Avoid design-system overreach

Do not:

- replace a coherent component library because another one is newer;
- centralize unrelated product policy into primitives;
- create tokens for every raw value before repetition or semantic value exists;
- force every layout into one generic component;
- rename variants without migrating semantics and consumers;
- declare a surface “consistent” from screenshots alone while interaction/accessibility behavior differs;
- use a system-wide rewrite to hide a local product defect;
- let compatibility aliases or legacy styles remain indefinitely without an owner and removal condition.

The best design-system change often removes choices and duplicate owners rather than adding more abstractions.

## Product contract record

For material product-wide consistency work, record:

- affected product surfaces and user impact;
- current token/primitive/product-wrapper inventory;
- canonical authorities;
- drift evidence and selected shared owner;
- semantic variant/state/accessibility contract;
- intentional-exception policy;
- migration and mixed old/new behavior;
- representative consumer/rendered verification boundary;
- deprecation and cleanup owner;
- falsifying scenarios.

Use `scripts/design_system_consistency_gate.py` when a structured contract helps prevent a visual cleanup from becoming unbounded redesign or unverified shared-component churn.

## Verification scenarios

Useful scenario classes include:

- token-drift;
- duplicate-primitive;
- variant-semantic-drift;
- shared-primitive-regression;
- long-content-pressure;
- responsive-layout;
- keyboard-focus;
- accessibility-semantics;
- legacy-consumer-migration;
- intentional-exception.

The deterministic gate requires these core classes for a material design-system migration. A local one-screen change does not need to pretend it is design-system work.

## Boundaries

- Do not choose brand identity, palette, typography, theme support, or redesign scope without product evidence or authorization.
- Do not invent a shared abstraction from one accidental use case.
- Do not make screenshots the authority for interaction or accessibility semantics.
- Do not encode permissions, billing, entitlement, or other business policy in visual primitives.
- Do not force a flag-day migration when consumers deploy independently.
- Do not preserve duplicate owners indefinitely for compatibility convenience.
- Do not call a design-system change visually complete without rendered evidence when the environment supports material visual verification.
