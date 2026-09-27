# Visual Direction

Use this when the user has not supplied a complete visual spec or when a reference must be translated into concrete design decisions.

## Commit before decorating

Choose a coherent combination of:
- visual paradigm and emotional tone;
- background/surface character;
- typography personality;
- density and whitespace strategy;
- primary screen or hero architecture;
- 2-4 recurring component motifs;
- imagery/material treatment;
- 1-2 meaningful motion behaviors.

Avoid mixing unrelated design languages just because each looks attractive in isolation.

## Calibrate the visual vector

For a new visual world, major redesign, or multi-section surface, declare three **directional** calibration axes before deep implementation:

- **structure variance** — restrained / balanced / expressive: how much asymmetry, compositional surprise, and layout variation the product can carry;
- **motion energy** — quiet / responsive / cinematic: how strongly motion participates in hierarchy, feedback, and spatial continuity;
- **information density** — airy / working / cockpit: how much information and control surface should occupy a viewport.

Write the vector compactly, for example:

`structure=balanced | motion=responsive | density=working`

These are consistency coordinates, **not quality scores** and not fixed aesthetic presets. Do not convert them into a universal numeric beauty rubric. Existing products should inherit their observed vector unless the user authorizes a redesign.

Use the vector to catch drift across the surface. A region may intentionally deviate because its job differs—for example a dense data table inside an otherwise airy product—but the deviation must serve task hierarchy rather than introduce a second visual language. When a representative real render feels wrong, diagnose which axis drifted before piling on decorative fixes.

## Interpret references by properties

When the user says "like X", extract properties rather than blindly cloning:
- dominant and accent colors;
- typography personality;
- layout density;
- geometry and corner language;
- material/texture cues;
- motion character;
- icon treatment;
- emotional tone.

Preserve the user's product and information architecture. A style reference is not permission to invent new product claims, fake metrics, unrelated sections, or unnecessary controls.

## Aesthetic range

Choose the visual language that fits the product instead of repeating one house style. The repertoire may include, where justified:
- refined SaaS / tool UI;
- editorial / luxury;
- playful consumer product;
- industrial / technical;
- sci-fi / futuristic HUD;
- fantasy / dark RPG;
- minimal game UI;
- retro / pixel UI;
- tactile/glass/material-rich interfaces.

Treat named products/games as property references, not as assets to copy. Extract palette, typography, density, material, motion, and emotional qualities and reinterpret them for the user's product.

## Concept competition

For visually important work without an accepted target, do not trust the first coherent composition merely because it is implementable. Explore materially different hierarchy/composition directions before committing when tools allow.

A valid alternative must change product framing, hierarchy, density, navigation, interaction, or material language. Color swaps and rearranged versions of the same card system do not count.

Select based on task clarity, product specificity, hierarchy, coherence, design-system fit, responsive plausibility, and distinctiveness. Do not use a numeric beauty score.

## Typography

Typography is structural. Define display/heading, body, UI/control, caption/metadata, and data/mono roles as needed. Set explicit size, weight, line-height, and tracking for controls as well as content.

Treat type as composition, not just tokens:
- control headline measure and intentional line breaks; do not let a hero wrap accidentally into an awkward orphan;
- keep body measure readable instead of stretching text across the container;
- create visible contrast between display, section heading, body, control, and metadata roles without making every level loud;
- inspect cap height/baseline relationships between text, icons, inputs, and buttons;
- use tighter leading/tracking only where the actual face/size supports it;
- keep microcopy legible enough to function; tiny text is not sophistication.

Use **optical alignment** when pure geometry looks wrong. A play triangle, chevron, icon-with-label pair, badge text, or button glyph may need a small visual offset to appear centered. Make such corrections bounded and intentional; do not scatter arbitrary 1px nudges without a visible reason.

Avoid falling back to generic default fonts when typography is a core part of the requested aesthetic. However, preserve an existing product's established type system instead of swapping fonts for novelty.

## Density and composition

Use deliberate whitespace. Avoid repetitive centered sections, endless bento grids, nested cards, and rounded containers around everything.

Prefer open layouts, bands, rails, tables, lists, canvases, split views, or focused framing when appropriate to the product type. Vary section rhythm without breaking the shared design system.

## Component grammar

A polished interface needs recurring visual rules, not a collection of individually pretty widgets.

Define a small component grammar from the active design system:
- which surfaces are open, bordered, elevated, inset, or truly card-like;
- where radius changes with hierarchy instead of one universal rounded rectangle;
- how primary, secondary, tertiary, destructive, and quiet actions differ;
- how icons are sized, stroked/filled, aligned, and given breathing room;
- how selected, hover, focus, disabled, loading, success, error, and destructive states inherit the same visual language;
- how repeated list/table/row structures align labels, metadata, controls, and baselines.

If every component requires a unique visual trick, the system is not coherent. If every component looks identical regardless of role, the system is not expressive enough.

## Motion

Treat motion as a first-class design tool when the product benefits from it. Every meaningful interaction should provide feedback, but not every element needs animation.

Use motion for:
- hover/focus/press feedback;
- entrance hierarchy and staged reveal;
- exit continuity;
- expanding/collapsing regions;
- drag/drop feedback;
- loading/progress/state transitions;
- spatial transitions between related states;
- game-specific urgency or status feedback.

Match timing/easing to the aesthetic. Prefer transform/opacity for performant motion where possible and respect reduced-motion preferences.

## Anti-generic checks

Before accepting a concept, challenge whether it could belong to almost any AI-generated SaaS product. If yes, the direction is not specific enough yet.

Remove visual filler:
- fake statistics or pseudo-system labels;
- badges/pills that carry no meaning;
- decorative icon rows;
- arbitrary gradients/glows;
- unnecessary cards;
- stock-looking placeholder imagery;
- repeated section formulas;
- card-on-card nesting or bento composition without task-driven grouping;
- standard sidebar/topbar/dashboard shells with no product-specific affordance;
- uniform rhythm that makes every region feel equally important;
- extra hero kicker/eyebrow copy not requested by the user.

Avoid defaulting to the same fashionable font, white-card layout, or purple/pink gradient every time. Aim for a specific, context-fit visual point of view rather than a recognizable AI template.

## Accessibility baseline

Do not trade away basic usability for style:
- sufficient text contrast;
- keyboard-reachable interactive controls;
- visible focus states;
- labels/accessible names for icon-only controls;
- meaningful alt text for informative images;
- do not rely on color alone for important state;
- support reduced motion for non-essential animation.
