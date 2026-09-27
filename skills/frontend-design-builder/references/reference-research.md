# Reference Research and Pattern Libraries

Use this reference when the product needs external design inspiration, competitive pattern research, or examples of mature flows.

Reference libraries such as Mobbin are **research tools by default, not design authority**.

## Choose the right research unit

Search for the smallest unit that matches the design question:

- **Screen** — one state such as search, checkout, profile, settings, empty state, paywall, or editor.
- **Flow** — a multi-step journey such as onboarding, checkout, account recovery, upgrade, creation, or publishing.
- **Section** — a web section such as pricing, hero, comparison, social proof, footer, or signup.

Do not combine unrelated intents into one broad search.

## Build a bounded product-pattern packet

When the design question depends on product type, user stakes, or platform conventions, retrieve a **small product-pattern packet** rather than preloading a style encyclopedia.

Start from the target archetype and task, for example developer tool, fintech onboarding, healthcare scheduling, marketplace checkout, creative portfolio, dense operations console, or desktop editor. Refine it with the actual audience, trust/risk level, input modality, platform, and existing design-system constraints.

Search in this order when available:

1. the repository's own accepted screens/components/stories and product conventions;
2. official platform/design-system guidance for the actual stack or domain;
3. a few mature products with the same task model;
4. broader design libraries only to fill a remaining gap.

Keep only evidence that can change the active decision. A useful packet is compact:

```text
archetype + task:
task/IA patterns:
density + grouping:
trust/risk signals:
interaction + state expectations:
responsive/platform constraints:
accessibility floor:
avoid for this product:
source links/evidence:
```

Normally 5-8 high-signal observations are enough. Do not import dozens of palettes, font pairs, style names, or landing templates into working context and then choose by popularity. Retrieval narrows the design space; the target product's own contract remains the authority.

## Research protocol

1. Define the product decision being researched.
2. Search 3-5 relevant mature examples when possible.
3. Inspect the actual screen/flow images; do not infer layout or behavior from metadata alone.
4. Extract patterns across examples:
   - information hierarchy;
   - progressive disclosure;
   - primary/secondary actions;
   - state transitions;
   - trust/risk signals;
   - density and grouping;
   - mobile adaptation;
   - error/recovery;
   - accessibility implications.
5. Separate recurring principles from product-specific branding or content.
6. Apply the principle through the target product's own design system.
7. If the user explicitly selects one reference as the desired visual target, promote that selected reference from inspiration to visual authority and use the fidelity workflow.

## Mobbin-specific use when available

- Use screen search for one visible state.
- Use flow search for end-to-end journeys.
- Use section search for public web sections.
- Keep the same task intent across related searches.
- Prefer a small relevant result set over dumping many screens into context.
- When presenting or saving a reference, preserve the canonical source link.
- Do not describe a result solely from app/site metadata; inspect the visual preview.

## Do not cargo-cult

Do not copy another product's:

- logo/brand assets;
- proprietary text;
- product-specific taxonomy;
- deceptive or inaccessible interaction;
- monetization pattern that conflicts with the target product;
- dense interaction model without confirming the target audience can support it.

A strong result often combines the interaction principle of one reference, the hierarchy of another, and the target product's own system.

## Pattern synthesis

When no single reference is good enough, write a compact synthesis before design:

```text
goal:
borrow:
- <pattern + why>
- <pattern + why>
avoid:
- <pattern + why>
target-system constraints:
- <tokens/components/content/interaction constraints>
```

Then create a new design rather than a collage of copied screens.
