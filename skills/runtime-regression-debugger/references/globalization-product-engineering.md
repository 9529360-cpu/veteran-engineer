# Globalization product engineering

Use this when product behavior depends on locale, language, timezone, calendar, number/currency formatting, bidirectional layout, Unicode text, IME composition, translated catalogs, or independently rolling out localized clients/content. Treat internationalization as data and behavior correctness, not a final copy-replacement pass.

## Compile the globalization contract

Start from a user-visible workflow and make the boundaries explicit:

`user/account locale -> message/content selection -> machine-stable data -> locale/timezone formatting -> direction/input behavior -> visible result -> fallback/recovery`

Capture only what can change implementation:

- supported locales/languages and fallback behavior;
- account, document, browser/device, URL, or request ownership of locale preference;
- timezone and calendar semantics for scheduling, deadlines, histories, and durations;
- message-key/catalog authority, interpolation, plural/select rules, and rich content;
- LTR/RTL directionality and mixed-direction content;
- IME composition, Unicode normalization, case folding, search and collation;
- machine-stable API/database values versus localized presentation;
- old/new client and catalog compatibility;
- observability for missing messages, fallback use, and formatting failures;
- validation locales/scenarios that can actually falsify the contract.

Do not ask the user to choose an i18n library when the repository already establishes one. Recover the existing catalog, formatter, locale-resolution, and persistence authority first.

## Keep machine values locale-neutral

Never make translated display text the authority for persisted or cross-service state.

Prefer stable ids/enums/codes plus localized presentation. This applies to status values, permission names, country/currency codes, units, API errors, analytics event names, storage keys, feature flags, and protocol fields.

Do not parse formatted display text back into authoritative values unless the product contract explicitly defines a locale-aware user-input parser. A localized label changing from one release to another must not rewrite identity.

For money, persist/transport the currency and precise numeric representation required by the domain; localization owns presentation, not value semantics.

## Resolve locale under one explicit authority

Define the precedence once. A common shape is:

`explicit resource/document language -> signed-in account preference -> explicit client preference -> device/browser locale -> product default`

The exact order is product-specific. The important property is that each scope has one owner and reload/login/account-switch behavior is deterministic.

Avoid locale state split across URL, account profile, browser storage, server session, and framework provider without reconciliation. If multiple representations exist, identify which one mutates the others.

Unsupported or partially supported locales need an explicit visible fallback. Preserve the user's preference when useful, but do not render a half-translated workflow without knowing which catalog/version is authoritative.

## Treat message catalogs as versioned product contracts

Use stable semantic message ids rather than source-copy identity when the repository supports it. Copy edits should not rename durable analytics/API/storage keys.

For interpolation:

- use named/typed placeholders where possible;
- do not build sentences by concatenating translated fragments;
- keep user-controlled content separate from translation markup;
- validate rich-text/HTML placeholders at the same trust boundary as other rendered content;
- allow translators to reorder placeholders according to grammar.

Use locale-aware plural/select rules. English `count === 1 ? singular : plural` logic is not a general pluralization model.

Define missing-key behavior: explicit fallback locale, visible placeholder in development/test, telemetry, or fail-closed behavior for critical regulated copy. Silent empty strings make incomplete catalogs look like unrelated layout bugs.

## Timezone, DST, calendars, and durations

A timestamp is not enough to describe every time product.

Separate:

- **instant**: a point on the UTC timeline;
- **zone**: rules for mapping instants to local civil time;
- **local date/time**: wall-clock value that may be ambiguous or nonexistent around DST transitions;
- **duration**: elapsed time, which should not be inferred from formatted wall-clock subtraction;
- **calendar date**: a date that may intentionally have no timezone.

Store UTC instants for event history when appropriate, and preserve a zone identifier when future wall-clock intent matters (for example, "09:00 Europe/Rome every Monday"). An offset such as `+02:00` is not a durable timezone rule.

Test skipped/repeated local times at DST boundaries, cross-midnight formatting, locale-specific week starts when material, and server/client disagreement about timezone authority.

Do not localize machine timestamps at an API boundary merely because the current UI needs formatted text. Keep transport values parseable and stable; format at the presentation owner unless server-rendered output is the explicit contract.

## Numbers, currency, measurement, and collation

Use locale-aware formatting libraries instead of handcrafted separators/symbol placement.

Keep currency code separate from locale. `en-US` does not imply USD, and a user can view EUR in an English locale.

For user input, distinguish permissive localized parsing from display formatting. Define accepted decimal/group separators, negative syntax, precision, and invalid/ambiguous states rather than stripping punctuation heuristically.

User-visible sorting/search may require locale-aware collation, but identifiers, authorization checks, protocol values, and durable uniqueness must remain locale-independent unless the domain explicitly defines otherwise.

Case conversion is language-sensitive. Do not use display-oriented lowercase/uppercase transformations as security or identity canonicalization.

## RTL, bidirectional text, and layout

Direction is a semantic property, not `transform: scaleX(-1)`.

When RTL is supported:

- derive direction from the resolved content/product locale as defined by the application;
- prefer logical layout properties (`start/end`, inline/block) over hard-coded left/right where practical;
- decide which icons/actions mirror and which retain semantic orientation;
- validate navigation order, focus order, tables/charts, drawers, carousels, gestures, and animation direction;
- isolate mixed-direction identifiers such as URLs, emails, account numbers, code, and timestamps so visual reordering cannot change perceived identity;
- test truncation and long translated text rather than designing only for English widths.

A visually mirrored screenshot is not proof that reading order, focus order, or semantic action direction is correct.

## IME composition and Unicode input

Text input is not always a sequence of finalized keypresses.

Japanese, Chinese, Korean, and other input methods can maintain an active composition range. During composition:

- do not submit on Enter merely because a key event fired;
- avoid validation/transformation that destroys the in-progress composition;
- do not move focus or rewrite the controlled value unless the framework contract preserves composition state;
- test keyboard shortcuts against composition events.

Preserve Unicode text end to end. Apply normalization only where the product defines comparison/search/canonicalization semantics; do not silently normalize identifiers or credentials in ways that change their authority.

Count UI length using product-appropriate units. Bytes, code points, UTF-16 code units, and user-perceived grapheme clusters are different things.

## Server/client and persistence boundaries

Internationalization crosses full-stack ownership:

`locale preference -> request/context -> domain values -> persistence -> API/schema -> client format/catalog -> rendered content`

Decide whether the server needs locale for domain behavior (for example localized email generation) or whether locale is presentation-only for a particular request. Do not send locale implicitly into business logic that should be invariant.

Persist user-authored content in its original intended language/encoding. If the product stores translated/generated variants, keep source language, translation provenance/version, and update/invalidation behavior explicit.

Cache keys must include locale/catalog identity when cached output is localized. A CDN/server cache that ignores locale can leak the wrong language across users while every individual formatter is correct.

## Validation shape

A useful globalization test matrix includes only representative classes, not every locale on every test:

- fallback and missing-catalog behavior;
- one RTL locale;
- one locale with materially different plural rules;
- long/pseudo-localized text expansion;
- IME composition input;
- mixed-direction identifiers;
- DST spring-forward and fall-back transitions when time matters;
- decimal/currency formatting and parsing when numeric input matters;
- old/new catalog or client overlap when independently deployed;
- cache/server-rendering separation by locale when output is localized upstream.

Use pseudo-localization to expose hard-coded copy, clipped layouts, and non-localized formatting before human translation is complete. Still validate real representative locales because pseudo-locales cannot prove grammar, typography, line breaking, IME, or bidirectional behavior.

For critical workflows, assert machine values and durable effects in addition to localized text. A UI can display the right translation while submitting the wrong enum, amount, date, or timezone.

## Observability and release

Make unexpected fallback measurable without logging sensitive user text.

Useful signals include:

- missing message id counts by app/catalog version and locale;
- unexpected fallback-locale use;
- formatter/parser failures by bounded locale/field identity;
- localized rendering/cache mismatches;
- locale-specific crash or validation-error regressions.

Translation catalogs, application code, and backend schemas may roll out independently. Preserve compatibility across the actual overlap window. Do not delete an old message key or enum mapping merely because the newest client no longer uses it while supported old clients remain active.

Rollback must restore a known-good code/catalog/config combination without rewriting durable user-authored localized data.

## Completion boundary

A localized product slice is not complete because translated strings render.

Close the implied responsibilities: locale ownership, stable machine values, fallback behavior, plural/interpolation rules, timezone/DST semantics, RTL and long-text layout, IME/Unicode input, server/client cache boundaries, representative validation, observability, and old/new compatibility.

When the changed mechanism is primarily web/UI, also use `references/frontend-product-patterns.md`. For native/cross-platform clients, also use `references/mobile-product-engineering.md`. For API/data compatibility or independently deployed consumers, add the corresponding API/data/cross-repo references rather than duplicating them here.
