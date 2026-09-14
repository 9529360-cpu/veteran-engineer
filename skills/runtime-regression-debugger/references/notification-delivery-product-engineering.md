# Notification and Outbound Delivery Product Engineering

Use this when a product must notify a person or external endpoint through in-app notifications, push, email, SMS, scheduled delivery, digests, or outbound webhooks.

The contract is not “enqueue a message”:

`product trigger -> recipient/endpoint eligibility -> current preference/policy -> durable notification intent -> render/schedule -> bounded delivery attempt -> receipt/suppression/failure -> visible completion or recovery`

Provider acceptance, queue acknowledgement, SMTP acceptance, push acceptance, or a socket write is an intermediate fact unless the channel contract explicitly makes it terminal.

## Keep authorities separate

Distinguish:

- product trigger authority;
- recipient/endpoint authority;
- preference/policy authority;
- one durable logical notification intent;
- provider/channel delivery attempts;
- rendered template/version/locale;
- provider receipts;
- product-owned visible/read state when it exists.

Do not let provider callbacks, UI badges, analytics events, and notification rows become competing authorities for the same fact.

## Give the logical notification stable identity

Retries and failover must stay under one logical intent when duplicates are harmful. A useful dedupe identity often combines tenant, recipient, notification class, business object/version, and trigger generation.

Use separate attempt identity for each provider/channel attempt. This lets the system distinguish logical success from retry history, stale callbacks, concurrent attempts, and fallback ownership.

After timeout or unknown provider outcome, reconcile the existing attempt before creating another logical send. Use provider idempotency when available, but do not assume every provider supports it.

## Re-check eligibility at irreversible handoff

Queued work can become stale. Before provider handoff, use current trusted authority for the facts that can revoke delivery:

- tenant/user/resource scope;
- destination/device/endpoint generation;
- current notification preference or suppression state;
- resource/account state;
- schedule/expiry or quiet-hours policy when applicable;
- endpoint ownership/signing configuration for machine delivery.

Do not trust client-supplied tenant, destination, template, redirect, or arbitrary webhook URL merely because the request was authenticated.

## Treat rendering and scheduling as versioned behavior

Bind queued work to enough identity to remain interpretable while old/new code overlaps: template/content version, locale, action target, and trigger or recipient generation when material.

Scheduled notifications need explicit schedule authority, timezone semantics when local time matters, expiry/staleness, cancellation/reschedule identity, and catch-up policy. A delayed reminder should expire rather than send after its business meaning has disappeared.

Use the globalization owner for locale/time/RTL mechanics instead of duplicating those rules here.

## Model delivery outcomes truthfully

Product states may include:

`planned -> scheduled/ready -> attempting -> accepted -> delivered-or-visible | suppressed | expired | failed | cancelled | reconciling`

Channels do not need identical terminal states. Define what the product can actually prove:

- in-app may have authoritative visible/read state;
- email acceptance does not prove human reading;
- push acceptance does not prove display;
- SMS receipts can be delayed or provider-specific;
- webhook 2xx can be terminal only if that is the machine contract, while timeout-after-commit remains ambiguous.

Normalize stable product outcomes such as accepted, transient failure, permanent destination failure, throttled, suppressed, and unknown/reconciling. Preserve provider-specific detail for diagnosis without making provider strings the product state machine.

## Bound retry, fanout, and provider degradation

Handle duplicate jobs, worker crash, provider 429/5xx, timeout-after-acceptance, permanent destination failure, duplicate/out-of-order receipts, and provider failover.

Transient and permanent failures need different policy. Bound retries, backoff/jitter, queue age, concurrency, provider quotas, and fallback amplification. Large fanout must preserve recipient outcome identity so partial completion can resume without re-sending successful recipients.

Use `async-edge-job-patterns.md`, `dependency-outcome-degradation.md`, and performance/capacity owners when those mechanisms are active.

## Receipts, callbacks, and webhooks

Bind callbacks to stable attempt/provider identity. Authenticate callbacks using the provider-supported mechanism and reject stale or cross-tenant mutations that would regress current state.

Outbound webhooks are delivery to a remote machine principal. Define endpoint ownership, allowed destination policy, signing/versioning, timestamp/replay protection, payload schema, timeout, idempotency/retry, and disablement/recovery after persistent failure.

A notification payload or deep link never bypasses normal authorization at consumption time.

## Cancellation and supersession

Cancellation is not just removing one queue item; work may already exist in delayed/retry queues or at a provider. Use generation/version checks so superseded work cannot send obsolete content.

If provider-accepted delivery cannot be retracted, report that as an external effect rather than pretending rollback occurred.

## Observability and validation

Correlate:

`business trigger -> logical intent -> attempt -> provider request/receipt -> product-visible state`

Keep stable IDs and bounded metadata. Do not log raw tokens, webhook secrets, signed URLs, credentials, or sensitive message bodies.

Choose tests that can falsify the active mechanism, commonly:

- duplicate trigger converges to one logical intent;
- timeout-after-acceptance does not blindly duplicate;
- throttling uses bounded backoff;
- permanent invalid destination suppresses only that destination;
- preference/eligibility revocation blocks stale queued work;
- scheduled stale work expires;
- duplicate/out-of-order receipts do not regress state;
- partial fanout resumes without replaying successful members;
- provider failover preserves intent identity;
- cross-tenant recipient/endpoint injection fails closed;
- old/new templates, producers, workers, or callbacks coexist during migration.

Use deterministic fake providers for state-machine tests and a real provider contract/sandbox boundary only when changed behavior depends on actual provider semantics.

## Compatibility and cleanup

Assume old producers, queued intents, workers, templates, clients, and callbacks can overlap. Evolve intent/event/template contracts compatibly or dispatch by explicit version. Remove old template/provider compatibility only after queued work and supported versions no longer need it.

Software rollback cannot unsend already accepted email, SMS, push, or webhooks. Separate code rollback from reconciliation of external delivery effects.

## Boundaries

- Do not call queue/provider acceptance “delivered” unless the channel contract supports that claim.
- Do not create a new logical intent merely because one attempt timed out.
- Do not snapshot revocable preferences far ahead of send without freshness/version semantics.
- Do not make provider-specific statuses the product authority.
- Do not let failover bypass dedupe or eligibility.
- Do not treat notification payloads as authorization tokens.
- Do not invent legal/compliance communication policy; implement the approved product policy.
