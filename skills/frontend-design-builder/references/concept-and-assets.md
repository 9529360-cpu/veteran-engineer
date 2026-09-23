# Concept Generation and Asset Workflow

Use this reference for visually significant new surfaces, redesigns, games, or work where image-generated concepts/assets will materially improve fidelity.

## Concept-first rule

When there is no accepted visual reference and the task is visually significant, create enough concept material to specify the whole requested surface before deep implementation.

For a long website, prefer one coordinated concept per major section or state rather than one tiny full-page image whose details cannot be read. For dense apps, editors, dashboards, and games, create separate detail/state concepts for areas such as tables, inspectors, toolbars, modals, charts, forms, or HUD states when a single screen would make them ambiguous.

If a generated concept is blurry, cropped, unreadable, or too compressed to implement accurately, regenerate that section/state as a fresh standalone reference instead of zooming or cropping the weak image.

## Brief contents

Carry forward the user's actual requirements:
- product/page purpose and audience;
- required sections, states, workflows, nav, fields, copy, CTAs, and media;
- target viewport and responsive needs;
- technical constraints;
- information architecture that must be preserved;
- code-native text/controls versus rasterized asset content.

Do not let concept generation invent fake metrics, new product claims, unrelated navigation, or extra sections simply to make the mockup look busier.

## Approval mode

If the user explicitly asks to review concepts before implementation:
1. Generate/show the concept.
2. Iterate on the concept while it is under review.
3. Do not start deep implementation until the user accepts the direction.
4. Once accepted, treat it as the active visual spec unless the user changes it.

If the user asked for direct implementation and enough context exists, do not block progress on unnecessary approval checkpoints.

## Design extraction before coding

From the accepted concept/reference, capture:
- exact visible copy and allowed above-the-fold strings;
- first viewport composition and downstream section/state order;
- palette and color temperature;
- typography and control/chrome type;
- spacing, density, radius, borders, shadows, elevation;
- container model;
- component families and variants;
- icon inventory and visual treatment;
- imagery/media treatment, aspect ratios, overlays, masks, crop rules;
- motion cues and timing;
- responsive continuation;
- workflow states and interactions.

## Asset pass

Use generated or supplied assets for visually important non-icon material when appropriate:
- logos/marks when the user owns or supplies them or asks for an original new mark;
- hero/product imagery;
- illustrations, textures, backgrounds, posters, avatars, empty states;
- game sprites, tiles, collectibles, hazards, props, and layered backgrounds.

Keep actual application labels, controls, navigation, tables, forms, and live data code-native. Do not replace an interactive interface with a screenshot.

For layered assets, generate/export transparent or clean-cutout variants when needed. Preserve branding/text that belongs inside the asset itself.

## Game-specific asset separation

For games, distinguish visual art from runtime UI logic:
- art assets: characters, sprite states, tiles, terrain, hazards, pickups, props, parallax/background layers;
- code-native/runtime: HUD text, score, menus, controls, hit boxes, physics, game state, collision geometry.

Do not substitute primitive canvas shapes for visible production art when the concept clearly calls for authored assets unless the user explicitly wants a minimal/procedural aesthetic.
