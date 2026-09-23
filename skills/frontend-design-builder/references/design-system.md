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

## Reuse hierarchy

Prefer, in order:
1. existing app-level pattern or shell;
2. existing library/local component with the correct variant/prop;
3. composition of existing primitives;
4. a new local component using existing tokens;
5. a new token/variant only when the system genuinely lacks one.

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

When repeated work in the same project is likely, create/update a project-local design-system reference using `design-system-reference.template.md` or an equivalent project note.

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
