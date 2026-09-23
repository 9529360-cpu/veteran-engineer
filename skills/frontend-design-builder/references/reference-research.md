# Reference Research and Pattern Libraries

Use this reference when the product needs external design inspiration, competitive pattern research, or examples of mature flows.

Reference libraries such as Mobbin are **research tools by default, not design authority**.

## Choose the right research unit

Search for the smallest unit that matches the design question:

- **Screen** — one state such as search, checkout, profile, settings, empty state, paywall, or editor.
- **Flow** — a multi-step journey such as onboarding, checkout, account recovery, upgrade, creation, or publishing.
- **Section** — a web section such as pricing, hero, comparison, social proof, footer, or signup.

Do not combine unrelated intents into one broad search.

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
