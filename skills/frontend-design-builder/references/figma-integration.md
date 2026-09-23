# Figma Integration

Use this reference when Figma is a source, destination, design-system authority, or design-to-code bridge.

Figma is not just a screenshot source. Treat it as structured design data: variables, component properties, variants, libraries, assets, annotations, Dev Mode metadata, and Code Connect mappings.

## Prerequisite routing

When the host exposes dedicated Figma skills/tools, use their prerequisite workflow rather than improvising raw calls.

- For any Figma write or Plugin API operation, load the host's Figma-use prerequisite first.
- For Figma-to-code implementation, load the dedicated design-to-code workflow before requesting design context.
- For building screens/pages in Figma, load the design-generation workflow.
- For variables, tokens, components, variants, or library work, load the design-library workflow.

If those capabilities are unavailable, fall back to exported screenshots/specs and state exactly what structured Figma data could not be inspected.

## Host capability routing

When the host exposes the following dedicated Figma skills, route to them instead of reproducing their detailed tool contracts here. Load only the capability needed for the current phase.

| Need | Preferred host workflow |
| --- | --- |
| Inspect/write Figma through the Plugin API | `figma-use` before the write/unique-read call |
| Create a new Design, FigJam, or Slides file | `figma-create-new-file` before file creation |
| Figma design → production code | `figma-design-to-code` before design-context retrieval |
| Build/update a full screen or composed view in Figma | `figma-use` + `figma-generate-design` |
| Create variables, tokens, components, variants, or a library | `figma-use` + `figma-generate-library` |
| Create/maintain component-to-code mappings | `figma-code-connect` |
| Implement Figma motion in production code | `figma-implement-motion` |
| Author or inspect motion inside Figma | `figma-use` + `figma-use-motion` |
| SwiftUI ↔ Figma | `figma-swiftui`; add `figma-use` for code → design |
| Editable flow/architecture/state/sequence diagrams in FigJam | `figma-generate-diagram`; use `figma-use-figjam` for hybrid edits |
| Procedural shader/effect authoring | `figma-shaders` only when explicitly requested |
| Reusable generative Figma-plugin authoring | `figma-generative-plugins` only when explicitly requested |
| Figma Slides editing | `figma-use` + `figma-use-slides` only for slide work |

These are host capabilities, not hard dependencies. If a named workflow is unavailable, continue with the strongest available structured Figma/read/export path and record the limitation.

### Routing discipline

- Do not load all Figma capabilities because a Figma URL exists.
- Design-to-code, code-to-design, library evolution, motion, SwiftUI translation, diagrams, and plugin/effect authoring are different modes with different evidence.
- Keep the active Figma node/frame/component identity stable through a phase.
- For design-to-code, preserve both structured context and a visual render; neither replaces the other.
- For code-to-design, inspect production components/tokens before creating parallel Figma primitives.
- For motion, preserve the existing DOM/view/component structure when possible; motion should augment the implementation rather than trigger an unrelated rebuild.
- For diagrams, ground nodes/edges in real product or repository evidence instead of inventing a visually complete but false flow.

## Read before write

For an existing file:

1. Identify the target frame/component/page.
2. Inspect the file structure and current design-system conventions.
3. Discover local and subscribed libraries before creating new primitives.
4. Inspect variables, styles, component properties, variants, and descriptions relevant to the task.
5. Only then mutate the canvas.

Do not create a parallel token taxonomy or duplicate component family before proving the existing system cannot express the requirement.

## Design-system rules

Follow these defaults unless the existing file has a stronger convention:

- Variables/tokens before repeated components.
- Semantic tokens should alias primitives rather than duplicate raw values.
- Give variables useful scopes and code syntax where supported.
- Bind component visual properties to tokens instead of hardcoding repeated values.
- Use component properties for meaningful variation: variant, boolean, text, instance swap, and flexible slots where appropriate.
- Avoid variant explosion. If a component matrix becomes unwieldy, split responsibilities or use nested components/instance swaps.
- Preserve component descriptions and usage guidance as part of the handoff contract.

Figma's variables and component properties are machine-readable signals. A well-structured file should let an agent infer supported states instead of guessing from visual inspection.

## Code Connect and production components

When Code Connect or an equivalent mapping exists, treat it as the preferred bridge from design component to production component.

- Reuse the mapped code component directly when it can express the design.
- Map Figma properties to real production props/states rather than regenerating raw markup.
- Prefer connected examples/instructions over generic auto-generated snippets.
- Keep mappings current when the code component API changes.
- If a mapped component is close but insufficient, identify the smallest extension or wrapper instead of abandoning the mapping.

Figma describes Code Connect as a bridge between repository components and Dev Mode/MCP context, specifically to provide more precise implementation guidance to AI agents.

## Figma-to-code evidence loop

For implementation from Figma:

1. Get structured design context for the requested node.
2. Get a screenshot/render of that node and keep it as the visual target.
3. If structured context is sparse, inspect the visible child nodes rather than inventing missing detail.
4. Inspect the repository for matching components, tokens, assets, and Code Connect mappings before editing.
5. Implement using the project's native layout/component system.
6. Run the real product.
7. Compare the rendered result against the Figma screenshot and fix in-scope mismatches.

Do not use the screenshot itself as the UI implementation asset. Exact visual reference and code-native implementation are separate requirements.

## Writing back to Figma

When generating or updating Figma designs:

- Build coherent sections/screens rather than isolated decorative fragments.
- Use auto layout for structural relationships.
- Track returned node IDs/created entities in a state ledger for resumability and safe cleanup.
- Validate each coherent phase from returned structural evidence and a bounded visual review.
- Never guess node IDs or authorize destructive cleanup using fuzzy name matching.
- Keep reusable library work deterministic and idempotent.

## Figma as a bidirectional bridge

A mature workflow may move both directions:

```text
production code / Storybook
        ⇅
Code Connect + variables + component properties
        ⇅
Figma design system / product frames
        ⇅
rendered implementation + visual QA
```

The goal is not "export code from Figma." The goal is to keep design intent, reusable component APIs, tokens, and rendered behavior aligned. Figma's current Dev Mode explicitly supports MCP context, Code Connect, variables, Storybook/GitHub integrations, and write-to-canvas workflows.
