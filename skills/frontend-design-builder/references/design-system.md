# Design System Discovery and Reuse

Use this for existing codebases and any task where design-system fidelity matters.

## Resolve the source

Inspect only what the task needs, progressively:
- package.json and lockfile for installed UI/icon packages and exact versions;
- theme providers, Tailwind/config files, CSS variables, token files, DTCG files, or theme objects;
- local component directories and public exports;
- Storybook, docs, examples, and app-shell/layout components;
- existing pages that demonstrate the intended pattern;
- Figma references when the design system primarily lives there.

If the system source is ambiguous, surface the ambiguity rather than fabricating a rule.

## Evidence-first reuse ladder

Do not jump from "I need a component" to "create a component." Prove the strongest reusable owner first.

Prefer, in order:
1. existing app-level pattern or shell that already solves the same product job;
2. exact design-to-code mapping such as Code Connect/equivalent, when present;
3. existing product screen/story/example that proves the intended composition and states;
4. existing local or library component with the correct public API/variant;
5. composition of existing primitives;
6. a new local component using existing semantic tokens;
7. a new token/variant only when the system genuinely lacks one.

Use `reuse`, `wrap`, `compose`, or `new` explicitly for material decisions. A close visual match with an incompatible API is not exact reuse; prefer a wrapper or composition over forking internals.

Absence must be established across the relevant authority surfaces. An empty local token list does not prove no library variables exist; a missing Storybook story does not prove the code component lacks the state; a failed Figma lookup does not prove the repository has no matching component.

Do not copy a library component and alter its internals when its public API can express the needed result.

## Tokens

Think in three tiers:
- primitive/global values;
- semantic/alias roles;
- component-specific tokens.

Consume semantic roles first so light/dark/brand/density themes can switch without rewriting UI. Avoid raw hex colors and arbitrary pixels when the system exposes named roles/scales.

A complete newly-created system should consider:
- color roles and semantic feedback states;
- display/body/UI/mono typography roles;
- type scale, line-height, and tracking;
- spacing scale;
- radius and elevation/shadow scale;
- motion durations/easing;
- breakpoints and density rules;
- icon style and sizing;
- component state variants.

## Component APIs

For unfamiliar components, inspect actual TypeScript types, Storybook args, exports, or source before use. Verify props against the installed package version, not whichever documentation version happens to be easiest to find.

Record useful non-obvious details: variant axes, slot behavior, required providers, client/server constraints, accessibility gotchas, and styling limits.

## Version-aware project cache

When repeated work in the same project is likely, create/update a project-local design-system reference using `design-system-reference.template.md` or an equivalent project note. For long multi-tool design work, also use `design-session-ledger.md` to bind the current visual target, mappings, evidence identities, and open design frontier across turns.

Record:
- package/library name and installed version;
- import paths and public exports;
- token locations and semantic token names;
- component props/variants/slots;
- app-shell/layout conventions;
- icon source;
- known gotchas and accessibility requirements;
- example files that demonstrate canonical usage.

Stamp the cache with the relevant installed package/library version. On later runs, compare the recorded version to the current installed version before trusting cached APIs or tokens. Refresh stale entries instead of blindly reusing them.

## Figma/reference-sourced systems

When the real system lives in Figma or a visual library:
- extract real color/type/layout variables where tooling allows;
- use real exported icons/assets when available;
- reuse actual Figma components/instances when the available Figma tooling supports writing and component insertion;
- document component appearance and states;
- distinguish genuine reusable code components from visual approximations.

Never claim an HTML recreation is the original native/Figma component when only appearance could be reproduced.

## Verification

Typecheck/build first to catch wrong imports and props. Then render. A compiler cannot confirm visual fidelity, responsive composition, or correct interaction feel.

If no browser/preview tooling exists, fall back to a dev-server smoke test plus the strongest available static/runtime verification and state the limitation.

If a repeated override appears three or more times, treat it as evidence of a missing variant or system-level need rather than continuing to scatter one-off fixes.


## Cross-tool synchronization

When Figma, code tokens, Storybook, and production components all participate in the same design system, read `design-system-sync.md`.

Assign one authority per decision type instead of declaring every surface a source of truth. Keep token values, semantic aliases, component APIs, Figma properties/variants, Storybook states, and Code Connect mappings aligned through an explicit drift-resolution loop.

For design-system changes that cross tools, update the canonical owner first, then synchronize the projections and verify the final rendered component.
