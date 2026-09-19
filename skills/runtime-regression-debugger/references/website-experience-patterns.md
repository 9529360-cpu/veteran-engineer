# Website experience patterns

Use this for a public-facing website, marketing site, landing page, brand/content site, or other web surface whose primary job is communication, discovery, trust, acquisition, or conversion rather than an authenticated application workspace. Pair with `frontend-product-patterns.md` when the site also contains meaningful product workflows. Do not turn every website into a dashboard/card grid merely because the implementation stack is React.

## Contents

- Identify the real website job
- Design content and information hierarchy first
- Build trust without invented proof
- Preserve web semantics and discoverability
- Design conversion flows as real product flows
- Treat responsive content pressure as a design input
- Protect perceived and measured performance
- Hand off to the real frontend architecture
- Validate the public surface

## Identify the real website job

Before choosing components or visual language, identify the page/site role:

- brand/homepage;
- product or feature marketing;
- campaign/landing page;
- pricing/comparison;
- documentation/education;
- editorial/content discovery;
- lead generation/contact;
- public account/service entry.

Capture the primary audience, the question they arrive with, the first useful answer, the primary action, and the evidence needed before that action feels credible.

Do not copy application-shell patterns into a public site without a product reason. Persistent sidebars, dense tables, equal-weight cards, badge-heavy chrome and dashboard metrics may be correct for a workspace and wrong for a homepage.

## Design content and information hierarchy first

A public page is a reading and decision sequence. Design the content model before decorating sections.

For each major region decide:

- what user question it answers;
- whether it introduces, explains, proves, compares, or converts;
- the heading/message hierarchy;
- the supporting media/data/proof source;
- the primary and secondary action, if any;
- what can be deferred to another page or progressive disclosure.

Prefer a coherent narrative over a pile of interchangeable sections. Avoid repeating the same promise in the hero, three cards, a feature grid and another CTA with different adjectives but no new evidence.

Use real representative content early. Lorem ipsum and uniformly short placeholder strings hide hierarchy, wrapping, localization and content-density problems.

## Build trust without invented proof

Never manufacture testimonials, customer logos, user counts, awards, ratings, security claims, performance numbers, case-study outcomes or partner relationships to make a design look complete.

When verified proof exists, preserve source/provenance and present it at the point where it resolves a real user concern. When proof does not exist, design the layout so the product still communicates clearly without fake credibility furniture.

Keep legal, privacy, pricing and qualification language accurate. Do not make a visually attractive page by obscuring material limitations, recurring charges, consent, eligibility or cancellation terms.

## Preserve web semantics and discoverability

Use the platform as a website, not only as a rendered canvas.

When relevant to the changed surface, preserve or define:

- one coherent document heading structure;
- semantic landmarks and native links/buttons;
- meaningful page title and description;
- canonical/share metadata when the product uses them;
- crawl/index controls and sitemap ownership when the route is public and searchable;
- structured data only when the content genuinely qualifies for the schema;
- durable URLs and link behavior for content users may share or revisit.

Do not add SEO metadata mechanically to private application routes or claim SEO improvement from tags alone. Search discoverability depends on real accessible content, routing/rendering behavior, performance, links and the deployed site.

## Design conversion flows as real product flows

A CTA is not complete because it is visually prominent. Trace what happens after it.

For signup, contact, demo, waitlist, checkout-entry or download flows, define:

`promise -> CTA -> destination/form -> validation -> submission -> feedback -> recovery -> completion`

Keep the page promise consistent with the destination. Preserve campaign/referral parameters only when the product intentionally uses them. Do not create dead-end buttons, fake forms or success states disconnected from real submission behavior.

Use urgency, scarcity and comparison claims only when they are true and authorized. Avoid dark patterns such as visually hiding decline/cancel paths or making consent appear mandatory when it is not.

## Treat responsive content pressure as a design input

Public websites often fail because the desktop composition assumes one line of copy, one language and ideal imagery.

Test real pressure:

- long headlines/subheads;
- navigation labels and localization;
- missing or differently cropped imagery;
- pricing/features with uneven content;
- forms with validation errors;
- legal/disclosure text;
- narrow and wide viewports;
- zoom/font scaling.

Reflow from content priority. Do not preserve a desktop art direction on small screens by shrinking text, hiding essential proof, or absolute-positioning everything into a miniature poster.

## Protect perceived and measured performance

Treat performance as part of the designed experience when it is material to the site.

Prefer:

- correctly sized responsive images and modern formats supported by the project;
- explicit media dimensions/aspect ratios that reduce layout shift;
- fonts and icon strategies that avoid unnecessary blocking/churn;
- progressive loading for below-the-fold media/embeds;
- minimal client-side JavaScript for content that does not need interactivity;
- animation and video that do not block reading or interaction.

Measure the dominant user-visible problem before rewriting architecture. Core Web Vitals can be useful evidence for public web performance, but a score is not the product contract and should be interpreted with representative routes/devices and deployment conditions.

## Hand off to the real frontend architecture

Once the site structure and visual direction are accepted:

- use `frontend-styling-implementation-patterns.md` for CSS/utility/theme/token/component translation;
- use `frontend-implementation-patterns.md` for forms, client state, effects, loading/error behavior and interaction testing;
- use stack-specific references only after repository evidence identifies the framework;
- keep CMS/content/data ownership in its actual source rather than hardcoding production content into view components merely to match a mockup.

Do not introduce a page-builder abstraction, animation library, CSS framework or component system for one page unless the repository/product genuinely needs that new owner.

## Validate the public surface

For meaningful website changes, verify the deployed-equivalent route or the strongest runnable boundary available.

Inspect:

- first viewport and reading hierarchy;
- navigation and real CTA destinations;
- content accuracy and representative long/empty cases;
- responsive layout and media cropping;
- keyboard/focus and semantic structure;
- form success/error/retry states;
- metadata/link behavior when in scope;
- image/font/layout stability and material performance regressions;
- visual fidelity against an accepted target when one exists.

A beautiful screenshot with broken links, fake submission, poor semantic structure or unstable mobile layout is not a complete website implementation.
