# Component Lab and Visual Regression

Use this reference when the repository has Storybook, a component catalog, visual regression tooling, or a component-library workflow.

## Storybook as implementation evidence

When Storybook exists, inspect it before rebuilding a component from scratch.

Treat stories as evidence for:

- supported component props and variants;
- loading/empty/error/disabled/focus/hover states;
- composition patterns;
- responsive behavior captured by stories;
- expected component documentation and usage.

Storybook is code-side authority for implemented component states; it does not automatically override an accepted Figma visual target.

## State matrix

For a material component or screen, account for the states that actually matter:

```text
default
hover / pressed / selected
focus-visible
disabled
loading
empty
error
success
long content / overflow
small viewport
theme / mode when supported
```

Do not create meaningless stories for every theoretical combination. Cover risk-bearing and user-visible states.

## Interaction tests

If the project already uses Storybook interaction tests, extend them for meaningful behavior changes. Storybook's current interaction testing uses stories plus play functions to simulate user actions and assertions, and can run in CI.

Use interaction tests for behavior such as:

- open/close;
- validation;
- keyboard operation;
- selection;
- form submission;
- state transitions.

## Accessibility checks

If the repository already uses Storybook a11y tooling, keep changed stories clean or document known pre-existing violations. Automated checks are a first-line heuristic, not a substitute for keyboard/screen-reader reasoning. Storybook's a11y addon is based on axe-core and integrates with story-based testing.

## Visual regression

If Chromatic or another visual baseline system already exists:

1. update/add the relevant story;
2. render the target state;
3. run the repository's visual test command;
4. inspect diffs;
5. accept only intentional changes;
6. keep the final passing baseline as evidence.

Storybook documents snapshot-style visual tests as comparisons of stories against last-known-good baselines, including cross-browser testing through Chromatic.

Do not install Storybook/Chromatic solely for a tiny one-off UI fix unless the user asked or the repository is clearly becoming a reusable component system.

## Design-code synchronization

For design systems, Storybook and Figma can complement each other:

- Figma defines visual intent, variables, component properties, and design usage.
- Storybook defines production component APIs, states, interaction behavior, and code documentation.
- Code Connect or equivalent mappings link the two.
- visual regression protects the implementation after handoff.

When the sources drift, report the exact mismatch instead of silently choosing whichever is easier to implement.
