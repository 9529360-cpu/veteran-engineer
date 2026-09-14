# Notification and Outbound Delivery Product Engineering

Use this reference when a product must notify a person or an external endpoint through in-app notifications, push, email, SMS, scheduled delivery, digests, or outbound webhooks.

The product contract is not “enqueue a message.” Model the whole path:

`product event -> recipient/endpoint eligibility -> preference/policy check -> durable notification intent -> render/version -> schedule/rate/dedupe -> channel/provider attempt -> receipt/suppression/failure -> user-visible or machine-visible completion/recovery`

A provider 2xx, queue acknowledgement, APNs/FCM acceptance, SMTP acceptance, or webhook socket write is only one intermediate fact. Do not call the notification delivered unless that claim matches the channel’s real observable contract.

## 1. Separate the authorities

Keep these facts distinct:

- **product trigger authority**: decides that a business event is eligible to notify;
- **recipient authority**: resolves the exact user, tenant, address, device token, topic, or external endpoint;
- **preference/policy authority**: decides whether this notification class may use this channel now;
- **notification intent**: durable identity for one logical notification outcome;
- **delivery attempt**: one provider/channel attempt for that intent;
- **rendered content**: template/version/locale-specific payload produced for that attempt or intent;
- **provider receipt**: provider-specific acknowledgement or rejection;
- **user-visible projection**: inbox/read/unread/banner/badge state, when the product owns one.

Do not let a provider callback, mobile client, UI badge, analytics event, and notification table each become competing authorities for the same fact.

## 2. Give every logical notification stable identity

A logical notification should have identity independent of retries.

When duplicates are harmful, define a dedupe identity such as:

`tenant + recipient + notification class + business object/version + trigger generation`

Do not generate a brand-new logical identity after a timeout unless you have reconciled the previous outcome.

Use separate attempt identity for retries, provider failover, or channel fallback. This lets the system answer:

- did the logical notification already succeed or suppress?
- which attempt produced the current provider receipt?
- is this callback stale?
- may another attempt run concurrently?
- did a fallback channel already take ownership?

## 3. Model state transitions, not booleans

Common logical states include:

`planned -> eligible -> scheduled -> ready -> attempting -> accepted -> delivered/visible | suppressed | expired | failed | cancelled | reconciling`

Do not require every channel to support every state. Define which states are authoritative for the product and which are provider hints.

Examples:

- email can distinguish accepted, bounced, complained, or provider-rejected but often cannot prove human reading;
- mobile push acceptance does not prove a device displayed the notification;
- SMS provider delivery receipts can be delayed, missing, or provider-specific;
- in-app notifications may have strong authoritative visible/read state because the product owns the store and client projection;
- webhook 2xx can be the agreed machine-visible completion if the contract defines it that way, but timeout-after-commit remains ambiguous.

## 4. Eligibility, preferences, suppression, and revocation

Classify notification types according to repository/product policy rather than inventing legal categories.

Make the decision inputs explicit:

- notification class and purpose;
- recipient/tenant eligibility;
- channel availability;
- user preference or subscription state when applicable;
- suppression lists, invalid destinations, complaints, or disabled endpoints;
- account/resource state;
- time/quiet-hours policy;
- rate/frequency policy.

Do not snapshot preferences days in advance and blindly send later. Define freshness at the point where the irreversible provider handoff occurs.

If a preference is revoked while work is queued, the worker should either re-check current authority before send or carry a version/generation that makes stale work fail closed.

Keep product preference semantics separate from authentication/authorization. A user may be authorized to view a resource while having disabled an optional notification channel.

## 5. Recipient and endpoint correctness

Recipient resolution is a trusted boundary.

Validate:

- tenant/user/resource scope;
- normalized destination identity;
- ownership/verification state when required by product policy;
- device-token or endpoint generation;
- stale/unregistered destination handling;
- fanout membership at the intended snapshot/version;
- endpoint secrets/signing configuration for machine delivery.

Never trust a client-supplied tenant, destination, template, redirect, or arbitrary webhook URL merely because it arrived through an authenticated request.

For shared devices or account switching, bind push/device registrations to the correct current account and invalidate stale associations safely.

## 6. Rendering and template authority

Treat templates as versioned product behavior.

Define:

- template identity and version;
- required variables and validation;
- escaping/encoding by output context;
- locale and fallback behavior;
- timezone-aware dates when human-facing;
- subject/title/body/payload limits;
- deep-link or action target validation;
- sensitive-content policy for lock screens, email subjects, SMS previews, logs, and provider metadata.

Do not let old queued work silently render with a semantically incompatible new template unless that is intentional. Either bind intent to a template/content version or make rendering changes backward-compatible.

For globalized products, reuse the globalization authority for locale, pluralization, number/date formatting, bidi/RTL, and fallback semantics.

## 7. Scheduling, quiet hours, expiry, and staleness

Scheduled notifications are temporal workflows.

Persist the intended schedule in a stable time representation and keep the user/business timezone policy explicit. Re-evaluate timezone/DST behavior when schedules are local-time based.

Define:

- schedule authority;
- earliest/latest send window;
- quiet-hours or do-not-disturb behavior when applicable;
- expiry/staleness policy;
- cancellation behavior;
- reschedule identity;
- catch-up behavior after downtime.

A reminder for an event that already ended should not be sent merely because a delayed queue eventually resumed.

## 8. Retry and unknown outcome

Provider calls are external effects. Assume:

- timeout after provider acceptance;
- client disconnect after local commit;
- duplicate job delivery;
- retry after worker crash;
- duplicate provider callback;
- callback before local attempt state is visible;
- provider 429/5xx;
- permanent destination rejection.

Use idempotency where the provider supports it. Otherwise reconcile by durable intent/attempt identity and bound duplicate risk according to product semantics.

Never retry permanent failures with the same policy used for transient failures.

Keep retry budgets bounded. Backoff, jitter, dead-letter/reconciliation, and operator visibility should prevent a failing provider or invalid destination population from creating unbounded queue growth.

## 9. Rate limits, fanout, and backpressure

Large fanout is a capacity problem, not a loop over users.

Define budgets for:

- provider quotas/rate limits;
- per-tenant/user frequency;
- concurrent sends;
- queue depth/age;
- rendering throughput;
- callback ingestion;
- fallback-channel amplification.

Do not allow one tenant, campaign, outage, or retry storm to starve transactional delivery when product priorities differ.

For large audiences, define the audience snapshot/version and whether membership is evaluated at trigger time or send time.

## 10. Channel-specific considerations

### In-app

The product often owns the strongest state model. Define notification record identity, visibility, unread/read/archive state, badge projection, pagination/order, and cross-device reconciliation.

Do not derive unread counts independently in multiple clients if the server owns the authoritative inbox.

### Mobile push

Treat device tokens as revocable/versioned destinations. Handle invalid/unregistered tokens, account switching, multiple devices, collapse/grouping semantics, payload-size limits, and lock-screen sensitivity.

Deep links must re-authorize the destination after app launch; the notification payload is not an authorization token.

### Email

Distinguish render/send acceptance from bounce/complaint and from any optional open/click analytics. Treat open pixels and link tracking as privacy-sensitive projections, not proof of human comprehension.

Handle destination normalization, suppression, provider feedback, template HTML/text alternatives, and safe unsubscribe/preference paths according to approved product policy.

### SMS

Keep message segmentation/length, locale, sender identity, provider receipts, destination validity, quiet-hours/product policy, cost/rate limits, and sensitive content explicit.

Do not assume every carrier/provider exposes identical final states.

### Outbound webhook

Treat the endpoint as a remote machine principal. Define endpoint ownership, allowed destination policy, signing/versioning, timestamp/replay protection, payload schema/version, timeout, idempotency/retry, disablement after persistent failure, and observable delivery history.

Never let retries sign or replay a payload whose authorization/scope is no longer valid without an explicit contract.

## 11. Provider abstraction without semantic flattening

A common provider interface is useful only for semantics that really are common.

Normalize stable product outcomes such as:

- accepted for attempt;
- transient failure;
- permanent destination failure;
- suppressed;
- provider throttled;
- unknown/reconciling.

Preserve provider-specific detail for diagnosis, but do not expose provider-specific status strings as the product state machine.

Provider failover should not create duplicate logical notifications. Failover is another attempt under the same logical intent, with explicit ownership of which channel/provider may continue.

## 12. Receipts and asynchronous callbacks

Provider receipts are asynchronous input and can be duplicated, delayed, missing, or out of order.

Bind every callback to stable attempt/provider identity. Reject or ignore stale callbacks that would regress a terminal state incorrectly.

Verify callback authenticity using the provider’s supported mechanism. Parse defensively, bound payload size, and record only the minimum diagnostic data required.

Do not let an unauthenticated or cross-tenant callback mutate recipient state.

## 13. Cancellation and supersession

Cancellation is not “remove one queue item.” Work may already exist in delayed queues, retry queues, provider systems, mobile collapse groups, or fanout shards.

Define the cancellation point and residual behavior. When an old notification is superseded by a newer state, use generation/version checks so stale workers cannot send obsolete content after the new state is authoritative.

If cancellation cannot retract a provider-accepted message, make that limitation explicit rather than pretending rollback occurred.

## 14. Observability and supportability

Correlate:

`business trigger -> notification intent -> attempt -> provider request/receipt -> projection/user-visible state`

Useful metrics include:

- intent volume by class/channel;
- suppression/eligibility reasons;
- queue age and schedule lateness;
- render failures;
- provider acceptance/throttle/transient/permanent outcomes;
- retry counts and unknown outcomes;
- invalid destination/token rates;
- callback lag and unmatched callbacks;
- fanout completion/partial failure;
- stale-generation rejections.

Logs/evidence should use stable IDs and bounded metadata. Do not log raw tokens, signed URLs, webhook secrets, message bodies containing sensitive data, or provider credentials.

## 15. Validation

A strong validation set includes, where relevant:

- duplicate trigger produces one logical notification;
- timeout-after-provider-acceptance does not blindly duplicate;
- provider 429/5xx applies bounded backoff and preserves priority;
- permanent bounce/invalid token suppresses the right destination only;
- preference or eligibility revocation before send blocks stale queued work;
- scheduled notification expires instead of sending stale content;
- partial fanout is observable and resumable without resending successful members;
- out-of-order/duplicate receipts do not regress authoritative state;
- template/locale rollout works across queued old/new intents;
- cross-tenant recipient or endpoint injection fails closed;
- webhook signature/replay policy rejects forged or stale callbacks/requests when webhooks are active;
- provider failover preserves logical dedupe identity;
- account/device switching cannot leak notifications to the previous principal.

Use fake providers for deterministic state-machine tests, but keep at least one provider-contract or sandbox/integration boundary when the changed mechanism depends on real provider behavior.

## 16. Compatibility, migration, and rollback

Assume old producers, queued intents, workers, templates, clients, and callbacks can overlap during rollout.

Evolve event and intent schemas additively or with explicit version dispatch. Keep old template versions available while old queued intents still reference them, or migrate intents deliberately.

When changing provider, token format, callback schema, audience computation, or preference model, define mixed-version behavior and reconciliation before cutover.

Code rollback cannot unsend email/SMS/push/webhooks already accepted by providers. Separate software rollback from recovery of external effects.

## Completion standard

Notification/outbound delivery work is complete only when the engineer can answer:

- what creates one logical notification identity;
- who authorizes recipient, purpose, channel, and preference at send time;
- how duplicate trigger, retry, timeout-after-acceptance, and provider callbacks reconcile;
- how templates, locale, schedule, expiry, and deep links are versioned;
- how invalid destinations, suppression, cancellation, and stale work converge;
- what “delivered” means for each active channel;
- how partial fanout and provider degradation are visible and recoverable;
- how old/new producers, workers, templates, providers, and callbacks coexist;
- what cannot be rolled back after external delivery.

If those answers are missing, “the job was queued successfully” is not evidence that the notification product works.
