# Globalization product engineering

Use this when product behavior depends on locale, language, timezone, calendar, number/currency formatting, bidirectional layout, Unicode text, IME composition, translated catalogs, or independently rolled localized clients/content. Internationalization is data and behavior correctness, not a final copy-replacement pass.

`locale authority -> stable machine data -> catalog/content selection -> locale/timezone formatting -> direction/input behavior -> visible result -> fallback/recovery`

## Keep machine values locale-neutral

Persist and exchange stable ids/enums/codes and domain values; localize presentation. Translated labels must not become authority for status, permissions, API errors, analytics keys, storage keys, feature flags, protocol fields, currency identity, or durable uniqueness.

Do not parse formatted display text back into authoritative values unless an explicit locale-aware input contract owns that conversion. Keep currency code/value semantics separate from display locale. Case conversion, collation, and normalization used for presentation/search must not silently redefine security or identity canonicalization.

## Resolve locale and fallback under one owner

Define deterministic precedence for resource/document language, account preference, explicit client preference, device/browser locale, and product default as the product requires. Avoid competing locale state in URL/profile/browser/session/framework providers without reconciliation.

Unsupported or partially supported locales need explicit fallback behavior. The fallback locale must be a real supported catalog/runtime target, and user preference should not silently corrupt or partially translate machine state.

## Treat message catalogs as versioned contracts

Use stable semantic message ids when repository conventions support them. Prefer named/typed placeholders, keep user-controlled content separate from translation markup, allow grammatical reordering, and use locale-aware plural/select rules instead of English-only branching.

Do not construct translated sentences by concatenating fragments. Define missing-key behavior and make unexpected fallback observable; silent empty strings hide catalog drift as layout bugs.

Old/new clients, catalogs, and backend schemas can overlap. Do not delete old message keys or enum mappings while supported readers or queued work still depend on them.

## Time, number, and calendar semantics stay explicit

Distinguish UTC instant, timezone rule, local wall-clock time, calendar date, and elapsed duration. Preserve a zone identifier when future wall-clock intent matters; an offset such as `+02:00` is not a durable timezone rule. Test skipped/repeated local times around DST when time behavior matters, and do not derive elapsed duration from formatted wall-clock subtraction.

Use locale-aware libraries for numbers/currency/units rather than handcrafted separators or symbol placement. Localized numeric input needs an explicit parsing contract for separators, signs, precision, and invalid/ambiguous states.

Keep API/database machine values parseable and stable; format at the presentation owner unless server-rendered/localized output is itself the contract.

## RTL, bidi, IME, and Unicode are interaction correctness

RTL is semantic direction, not a mirrored screenshot. Prefer logical layout properties, decide which icons/actions mirror, preserve navigation/focus meaning, and isolate mixed-direction identifiers such as URLs, emails, account ids, code, and timestamps so visual reordering cannot change perceived identity.

Validate long translated text, reading/focus order, tables/charts, drawers/carousels, gestures, and animation direction where relevant. A visually mirrored layout does not prove semantic order.

IME composition is not finalized text. Do not submit on Enter, validate destructively, move focus, or rewrite controlled values merely because a key event fired while composition is active. Preserve Unicode end to end and normalize only where an explicit comparison/search/canonicalization contract requires it.

Bytes, UTF-16 units, code points, and user-perceived grapheme clusters are different length units; use the one the product contract actually means.

## Full-stack ownership includes caches and generated variants

Carry locale/timezone only into business logic when the domain actually depends on them. User-authored content should preserve intended language/encoding; translated/generated variants need source language, provenance/version, and invalidation semantics.

Localized server/CDN caches must key on the locale/catalog identity that changes output. A formatter can be correct while a cache leaks the wrong language across users.

## Validation and release

Use representative classes rather than every locale on every test: fallback/missing catalog; RTL/bidi; materially different plural rules; long/pseudo-localized text; IME composition; DST spring/fall transitions; locale-aware number/currency parsing when input matters; old/new catalog overlap; and locale-separated upstream caching when relevant.

Pseudo-localization finds hard-coded copy and expansion issues, but real representative locales are still needed for grammar, typography, line breaking, IME, and bidirectional behavior. For critical workflows assert machine values and durable effects as well as visible localized text—a UI can show the right translation while submitting the wrong enum, amount, date, or timezone.

Measure missing message ids, unexpected fallback, formatting/parser failures, locale/cache mismatches, and locale-specific crash/error regressions without logging private user text.

Rollback must restore a known-good code/catalog/config combination without rewriting durable localized user data.

For Web/UI implementation also use `frontend-implementation-patterns.md`; use `frontend-product-patterns.md` when globalization materially changes the experience/layout; for native clients use `mobile-product-engineering.md`; for time-state bugs use `temporal-debugging-state-transitions.md`; for API/data/cross-repo compatibility add those focused owners rather than duplicating them here.
