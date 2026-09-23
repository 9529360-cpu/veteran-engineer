# Cross-Tool Design System Sync

Use this reference when a product has more than one design-system surface: Figma variables/components, code tokens, Storybook, component libraries, Tailwind/CSS variables, DTCG-style token files, or another design tool/export.

The goal is not one universal source of truth. The goal is **one explicit authority per kind of decision**, with the other surfaces treated as synchronized projections.

## Assign authority by layer

For every project, identify these owners:

```text
token_value_authority:
semantic_token_authority:
component_api_authority:
visual_state_authority:
design_to_code_mapping_authority:
documentation_authority:
runtime_render_authority:
```

Typical defaults:

- production code owns component API and runtime behavior;
- Storybook/component docs expose implemented states and usage;
- Figma owns visual intent and design-system composition when the team works there;
- Code Connect/equivalent owns design-to-code mapping;
- code token files or Figma variables own token values according to the team's actual pipeline;
- the rendered product is evidence of what currently ships.

Do not call both Figma and code "the source of truth" for the same value unless there is a deterministic sync pipeline and one side is clearly the publisher.

## Token sync contract

When both code and Figma contain tokens, compare:

- token name/semantic role;
- primitive vs semantic alias relationship;
- value;
- mode/theme;
- scope/type;
- code syntax/export name;
- deprecation status.

Prefer semantic token names that describe purpose rather than appearance.

If the project already uses a token transformation/build pipeline, extend it. Do not introduce a second hand-maintained token pipeline.

## Component sync contract

For each shared component family, compare:

- code component name/import path;
- Figma component/set name;
- Code Connect mapping if present;
- code props;
- Figma component properties;
- variant/state axes;
- slots/instance swaps;
- accessibility constraints;
- Storybook stories/states;
- documentation.

A drift example:

```text
Figma: Button Size={S,M,L}, State={Default,Hover,Disabled}
Code:  Button size={sm,md,lg}, loading, disabled
Storybook: Default, Loading, Disabled
```

Do not hide the mismatch. Decide whether Figma is missing a production state, code is missing a designed state, or the mapping needs normalization.

## Round-trip workflow

When evolving a shared design system:

1. inspect code tokens/components and installed versions;
2. inspect Figma variables/components/libraries when accessible;
3. inspect Storybook/component docs when present;
4. build a compact drift table;
5. choose the canonical owner for each mismatch;
6. update the owner first;
7. synchronize the projections;
8. update Code Connect/equivalent mappings;
9. run component/rendered visual validation;
10. record the resolved mapping in the project design-system reference.

Never edit both sides independently and hope they converge.

## Drift table

Use a compact table or working note:

```text
item | code | figma | storybook | authority | action
color/surface/primary | var(--surface) | color/surface/primary | n/a | code tokens | sync Figma alias
Button.loading | supported | missing | story exists | code API | add Figma state/mapping
Card.radius | 12px token | 16px raw | story uses token | token system | fix Figma binding
```

Only track drift that can change implementation or design decisions.

## Theme and mode discipline

When the system supports light/dark, brand, contrast, or density modes:

- avoid duplicating components per mode when tokens can switch the appearance;
- verify semantic aliases resolve correctly in every supported mode;
- keep component APIs stable across modes unless behavior truly changes;
- verify the rendered product in the modes materially affected by the change.

## Deprecation

When replacing tokens/components:

- mark the old name/API as deprecated where the system supports it;
- migrate consumers before deletion;
- update Figma mappings and Storybook examples;
- avoid silently reusing an old token name for a new semantic meaning.

## Sync evidence

A design-system synchronization is complete only when the affected layer has evidence:

- token files build/validate;
- component API compiles/tests;
- Figma bindings/components are structurally validated when edited;
- Storybook relevant stories render;
- visual regression or rendered comparison passes when available;
- Code Connect/equivalent mappings reflect the final production component.

The purpose is to prevent silent drift, not to require every tool on every project.
