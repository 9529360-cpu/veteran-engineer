# Design Source Authority

Use this reference whenever a task has more than one design source: code, Figma, Storybook, a live product, screenshots, reference libraries, generated concepts, or another design tool.

## Classify every source before using it

A source has one of three roles:

- **Authority** — defines what must be preserved for the current decision.
- **Evidence** — proves what is currently implemented or rendered.
- **Inspiration** — offers patterns to learn from but is not a specification.

Never silently promote inspiration into authority.

## Default authority ladder

Use the narrowest authority that matches the decision:

1. **Explicit user decision or accepted target** — wins for product intent and requested change.
2. **Production component API / existing design system** — wins for what the shipped code can actually express unless the task is explicitly changing that system.
3. **Accepted Figma frame/component/spec** — wins for visual design intent.
4. **Code Connect or equivalent design-to-code mapping** — wins for which production component should implement a mapped design component.
5. **Storybook/component docs** — wins for supported code states, variants, and expected component behavior.
6. **Live rendered product** — strong evidence for current behavior and appearance, not automatically the desired future state.
7. **Screenshot/mockup/export** — visual authority when explicitly accepted, but weak on hidden states and implementation semantics.
8. **Mobbin or other pattern libraries** — inspiration by default.
9. **Image-generated concepts** — proposals until selected or accepted.

For Framer, Sketch, Penpot, ProtoPie, Principle, Adobe XD exports, or other external tools without a native connector, classify the supplied frame/export/screenshots under the same model rather than inventing tool-specific authority.

## Resolve conflicts explicitly

When sources disagree, identify the exact conflict instead of averaging them.

- **Figma vs production component API** — preserve the visual target, then use the closest supported production API. If the API cannot express the design, identify whether the correct fix is a component extension, wrapper, or design change.
- **Figma vs Storybook** — Storybook reveals implemented states; Figma reveals intended visual states. Reconcile missing/extra states before handoff.
- **Code vs live product** — the live product proves what users currently see; code proves implementation intent. Reproduce only after determining whether the observed difference is a bug, stale deployment, feature flag, or intentional variation.
- **Mobbin/reference pattern vs product system** — adapt the interaction principle to the product's information architecture, tokens, accessibility, and component model. Never import another product's brand language as if it were native.
- **Generated concept vs existing system** — the concept can propose a direction, but production constraints and accepted design-system rules still apply unless the user approves a system change.

## Carry a compact design-source ledger

For substantial work, keep a small internal ledger:

```text
visual_target: <Figma frame / screenshot / concept / live state>
component_authority: <repo components / Storybook / Code Connect / none>
token_authority: <repo tokens / Figma variables / agreed new system>
behavior_authority: <existing product / spec / prototype>
inspiration_sources: <Mobbin / competitor / reference URLs>
verification_source: <rendered app + comparison target>
```

Update it only when authority changes. Do not let the same source play contradictory roles.

## Exit condition

Before implementation, be able to answer:

- What exact source defines the visual target?
- What source defines component APIs and reusable states?
- What source defines tokens?
- Which sources are inspiration only?
- What rendered evidence will prove completion?

If those answers are materially ambiguous, resolve the ambiguity before deep implementation.


### Live URL distinction

A live URL is not automatically visual authority.

- **faithful recreation explicitly requested and authorized** → the captured live surface becomes the active visual/interaction target for the agreed scope;
- **redesign / improve / inspired by / like this** → the live product is current-state evidence and/or inspiration until a new target is accepted.

Do not mix clone fidelity and redesign freedom in the same phase without an explicit contract change.
