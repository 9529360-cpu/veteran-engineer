# Subscription, Billing, and Entitlements Product Engineering

Use this reference when a product sells recurring access, trials, seats, usage, add-ons, licenses, quotas, or other commercial entitlements whose lifecycle crosses product state, payment/provider state, and authorization.

The product contract is:

`commercial intent -> scoped subscription mutation -> versioned quote/catalog decision -> provider/payment transition -> durable subscription truth -> entitlement projection -> user-visible access -> reconciliation/recovery`

Do not collapse this into “the payment succeeded” or “the provider webhook arrived.” Subscription state, monetary truth, provider state, and current product access are related but distinct authorities.

For exact money movement, ledger conservation, refunds, settlement, and irreversible monetary effects, also read `payments-ledger-integrity.md`. This reference owns the commercial-access lifecycle around that monetary authority.

## Separate the authorities

Name the owner of each fact before changing code:

- **Catalog authority** owns plan, price, currency, billing interval, feature, quota, add-on, seat, and migration semantics.
- **Subscription authority** owns the durable account-scoped lifecycle: trialing, active, past-due, grace, canceling, canceled, expired, and domain-specific equivalents.
- **Payment/ledger authority** owns charge, invoice, credit, refund, settlement, balance, and monetary finality.
- **Provider authority** owns the external provider object and its accepted/failed/pending state; provider state is evidence about the external system, not automatically internal product truth.
- **Entitlement authority** owns the current product-access projection derived from approved subscription/add-on/seat state.
- **Metering authority** owns accepted usage facts and aggregation windows used for usage-based billing.

A pricing UI, checkout return page, cached plan name, provider webhook, invoice status, or feature flag is not a substitute for these authorities.

## Stable identity before retries

Use stable internal identity independent of provider request attempts:

- tenant/account id;
- internal subscription id;
- change-request/idempotency id for upgrade, downgrade, cancel, resume, seat change, and add-on mutation;
- provider customer/subscription/invoice ids as scoped external references;
- billing-period identity and effective-time boundaries;
- entitlement generation/version;
- usage event and meter identity.

If a provider mutation times out after acceptance may have occurred, reconcile by stable request/provider identity before issuing another logical mutation.

## Catalog and pricing are versioned contracts

Do not let a mutable “current plan” row silently rewrite history.

- Bind subscriptions and quotes to explicit plan/price versions or immutable identifiers.
- Preserve old versions long enough to interpret grandfathered subscriptions, invoices, queued jobs, and audit history.
- Separate display names from durable plan/price identity.
- Define currency, interval, unit, rounding, and approved tax-treatment inputs explicitly; delegate exact monetary calculation/accounting to the payment authority.
- Define feature/limit mapping separately from marketing labels.
- For price or packaging migrations, define grandfathering, forced migration, opt-in migration, and removal conditions.

## Trials are real lifecycle states

Define trial eligibility, start/end instant, payment-method requirements, trial entitlements, conversion trigger, payment-pending/failed/unknown behavior, extension authority, and terminal behavior at expiration.

Do not grant an endless trial because a delayed worker never executed the expiry transition.

## Activation and renewal

Separate:

`billing attempt -> monetary outcome -> subscription transition -> entitlement effect`

A provider-created invoice does not necessarily mean paid access. A successful payment attempt does not mean every entitlement projection/cache/session has converged.

For renewal, define cycle boundary/timezone, evidence required for renewal, dunning ownership, grace access, final expiration/revocation, and late-payment recovery.

## Upgrade, downgrade, and proration

State exactly when a commercial change becomes effective: immediately, next period, after payment, after approval, or after another domain condition.

For prorated changes:

- a preview/quote is not the final invoice;
- bind quote inputs to plan versions, quantity, currency, period bounds, and scoped customer/subscription identity;
- handle timeout-after-provider-acceptance without duplicating the change;
- reconcile final invoice/credit against the intended change;
- preserve old/new entitlement timing explicitly.

Downgrades need explicit policy when current usage exceeds the new plan. Define read-only, no-new-creation, scheduled cleanup, or next-cycle behavior. Never delete customer data merely because an entitlement shrank unless the product contract explicitly defines a safe lifecycle.

## Cancellation, resume, and grace periods

Distinguish immediate cancellation, cancel-at-period-end, non-renewal, provider cancellation, internal effective cancellation, resume-before-end, involuntary cancellation after dunning/grace, and account deletion.

A cancel request should have stable identity and an effective timestamp. Stale workers or duplicate provider events must not resurrect a canceled subscription or revoke a resumed one.

Grace periods are product policy, not a timing accident. Define access during grace, retry boundaries, visible state, and terminal behavior.

## Seats, licenses, and account scope

Purchased quantity and assigned members/devices are different facts.

- Scope quantities and assignments to the correct tenant/account/product.
- Define who may assign/revoke seats.
- Prevent concurrent assignment from violating quantity invariants.
- Define downgrade behavior when current assignments exceed the new quantity.
- Re-authorize active sessions after entitlement revocation; do not rely only on login-time claims.
- Keep cache keys and provider references scoped by tenant/account and entitlement generation.

## Entitlements are a projection with one derivation owner

Entitlements answer “what can this principal/account do now?” Derive them from authoritative subscription/add-on/seat state rather than mutating them independently from every webhook or UI flow.

Carry enough generation/version information to reject stale updates. Define grant/revoke effective time, source identity, cache freshness/invalidation, degraded behavior, session/token refresh, and old-client compatibility.

If multiple systems can write entitlements, either establish one mutation owner or define explicit reconciliation. “Last webhook wins” is not an authority model.

## Usage metering is an accounting-adjacent data pipeline

For every meter define tenant/account/subscription/meter scope, stable event identity, unit, aggregation rule, event-time versus processing-time behavior, period/window timezone, late/out-of-order event policy, corrections, billing cutoff, retention, and auditability.

Do not make retry of a usage producer increase billable quantity unless duplicate delivery is intentionally billable.

## Provider webhooks are asynchronous evidence

- Authenticate callbacks and protect secrets.
- Scope event/object ids to the intended account/provider context.
- Deduplicate replay and tolerate out-of-order/delayed delivery.
- Compare provider object version/timestamp when meaningful.
- Never regress newer internal state from an older event.
- Make handlers retry-safe and keep unknown outcomes explicit.

A checkout redirect or webhook should normally drive a durable/reconciled transition; it should not bypass trusted subscription/entitlement authority because it arrived from a successful provider path.

## Reconciliation is a first-class owner

Webhooks can be missed, duplicated, reordered, or delayed. Periodically reconcile bounded authoritative sets:

`internal subscription -> provider subscription/invoice/payment refs -> expected entitlement generation -> observed entitlement/access`

Record drift explicitly: provider-active/internal-expired, internal-active/payment-unresolved beyond allowed grace, entitlement projection stale, seat quantity mismatch, missing/cross-account provider reference, or usage aggregate mismatch.

Repair through idempotent domain transitions. Avoid silent direct row edits that erase the history needed to explain drift.

## Mixed versions and migrations

- Evolve subscription/webhook/event schemas additively or through explicit versions.
- Keep old catalog identifiers interpretable until all readers and queued work are migrated.
- During provider migration, keep stable internal subscription identity and define dual-read/event reconciliation windows.
- Do not let provider-specific ids become the only product identity.
- Roll out new entitlement capabilities so old clients fail predictably rather than interpreting unknown access as free access.

## Rollback boundaries

Code rollback cannot undo a captured charge, issued invoice/credit, provider-side cancellation, billing notification already sent, or access already granted/revoked and used.

Separate artifact rollback from domain compensation/reconciliation. Define forward repair for external effects before risky migrations or bulk subscription operations.

## Observability

Correlate by stable identities:

`account -> change request -> quote/catalog version -> provider object/attempt -> invoice/payment evidence -> subscription transition -> entitlement generation -> user-visible access`

Track subscription/payment/provider/entitlement drift, webhook lag/duplicates/order, dunning/grace aging, entitlement propagation lag, seat conflicts, late/duplicate/rejected usage, reconciliation repairs, and unresolved unknown outcomes.

Redact payment credentials, provider secrets, raw signed URLs, and unnecessary personal/invoice content.

## Validation shape

High-value cases include:

- duplicate provider event;
- out-of-order webhook;
- timeout after provider accepted a plan change;
- trial expiration/conversion failure;
- cancel-at-period-end plus resume-before-end;
- payment failure through grace and late recovery;
- immediate upgrade with proration;
- next-cycle downgrade with entitlement timing;
- concurrent seat assignment at the limit;
- late/duplicate metered usage;
- cross-tenant subscription/provider-reference rejection;
- provider reconciliation drift;
- mixed old/new plan identifiers during migration.

The strongest oracle is not “HTTP 200.” It is that catalog, subscription, payment evidence, provider state, entitlement projection, and user-visible access agree after retries, replay, delay, migration, and reconciliation.

## Common failed approaches

Avoid treating a checkout success page as subscription authority; toggling entitlements directly from every provider webhook; using provider ids as unscoped internal identity; overwriting current plan/price and losing grandfathered semantics; retrying unknown provider mutations with a new logical identity; letting cached session claims preserve revoked access indefinitely; billing duplicate usage after producer retry; conflating cancel request/provider cancel/entitlement revoke times; deleting customer data as an implicit downgrade mechanism; or calling the provider dashboard the ledger/internal subscription truth.
