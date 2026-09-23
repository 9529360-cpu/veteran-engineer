# Design Action Fabric

Use this reference when the task needs real design-tool actions rather than design advice alone.

The Design Action Fabric keeps **Veteran's design intent provider-neutral**. Figma is currently the richest web provider, but the Skill should reason in capabilities first and bind to concrete host tools only when they are actually available.

## Capability model

Treat these as the canonical capability families:

| Capability | Purpose | Typical Figma provider |
| --- | --- | --- |
| `design.inspect.context` | structured design-to-code context | `get_design_context` |
| `design.inspect.visual` | rendered visual evidence | `get_screenshot` |
| `design.inspect.structure` | pages/nodes/layout inventory | `get_metadata` or `use_figma` |
| `design.inspect.variables` | variables/token definitions | `get_variable_defs` or `use_figma` |
| `design.inspect.motion` | animation/keyframe evidence | `get_motion_context` |
| `design.system.libraries` | discover/search reusable components/tokens | `get_libraries` + `search_design_system` |
| `design.canvas.write` | mutate/create design nodes | `use_figma` |
| `design.file.create` | create Design/FigJam/Slides files | `create_new_file` |
| `design.capture.url` | live web page → design capture | `generate_figma_design` |
| `design.asset.import/export` | move images/SVGs across design/code | `upload_assets` / `download_assets` |
| `design.codeconnect.read/write` | bind design components to production code | Code Connect tools |
| `design.diagram.create` | editable FigJam flows/diagrams | `generate_diagram` |
| `design.deck.generate` | generate Figma Slides/decks | `generate_deck` |
| `design.shader.*` | advanced shader/effect resources | shader tools |
| `design.plugin.*` | advanced generative Figma tools | generative-plugin tools |

Do not load or invoke every provider tool because a Figma URL exists. Route only the active intent.

## Planning before calls

When design tooling is material, use:

`scripts/design_action_router.py --intent <mode> --tools <available-tool-names>`

Supported modes include:

- `design-to-code`
- `canvas-edit`
- `design-system`
- `code-to-design`
- `live-url-to-design`
- `asset-roundtrip`
- `code-connect`
- `motion`
- `figjam-diagram`
- `slides`
- `shader`
- `generative-plugin`

The router is an execution-planning aid, not authority over the design. It must never invent a provider that the host does not expose.

## Provider rules

### Figma provider

When Figma tools exist:

1. Load the provider's prerequisite Skill before any tool that requires one.
2. Keep file/node identity stable through the active phase.
3. Prefer structured context over eyeballing when exact data exists.
4. Preserve one screenshot/render as the visual target for design-to-code.
5. For writes, return/record affected node IDs and validate the changed phase.
6. For design-system work, inspect libraries/variables/components before creating new primitives.
7. For Code Connect, map real Figma properties to real production component props; never invent an API to make the mapping convenient.
8. For live URL capture, treat capture output as reference/layout evidence and reconcile it with the real design system.
9. For assets, keep temporary provider URLs out of final production code.
10. For advanced shaders/generative plugins, load them only when the user explicitly asks for those resource types.

### Non-Figma fallback

When Figma is unavailable, preserve the same intent through the strongest available path:

- repository tokens/components for design-system authority;
- browser/rendered screenshots for visual evidence;
- image generation for concepts/assets where appropriate;
- code-native motion and assets;
- Mermaid/text specs for diagrams;
- explicit pending design write-back when no design canvas can be mutated.

Never say a Figma file, component, mapping, or canvas mutation exists unless a real provider action created or verified it.

## Design-to-code

Require both structured context and visual evidence when the provider supports them:

`design context -> screenshot -> repository/component inspection -> implementation -> rendered comparison`

Code Connect, variables, libraries, and motion are enrichments to that path, not substitutes for the screenshot or real product verification.

## Code-to-design

Prefer:

`production evidence -> repository design system -> provider library discovery -> canvas write -> screenshot/structure verification`

For web apps with a live page capture provider, use the capture as a layout reference and reconcile it with actual library components/tokens rather than preserving a flattened capture as the final system.

## Evidence ledger

For substantial design-tool work, keep a compact ledger:

- provider/file identity;
- active page/frame/component/node IDs;
- source authority for tokens/components;
- created/mutated entity IDs;
- screenshots or rendered evidence used for comparison;
- unresolved design/code drift;
- write-back still pending.

The ledger may live in the current task state, a project-local note, or provider-returned IDs. Do not store hidden workflow metadata on user design nodes.

## Stop conditions

Stop expanding design-tool scope when:

- the requested artifact exists and verified evidence matches the accepted design contract;
- the task crosses back into backend/data/release ownership;
- the provider lacks a required capability and the fallback has been documented;
- additional provider calls would only repeat already-passing evidence.
