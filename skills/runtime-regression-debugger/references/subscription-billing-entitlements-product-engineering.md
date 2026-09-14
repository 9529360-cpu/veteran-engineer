# Subscription, Billing, and Entitlements Product Engineering

Use this when recurring access, trials, seats, usage, add-ons, licenses, quotas, or similar commercial rights cross product state, payment/provider state, and authorization.

The contract is:

`commercial intent -> scoped subscription mutation -> versioned catalog/quote decision -> provider/payment transition -> durable subscription truth -> entitlement projection -> user-visible access -> reconciliation/recovery`

Do not collapse this into “payment succeeded” or “webhook arrived.” Subscription lifecycle, monetary truth, provider state, and product access are related but distinct authorities. For exact money movement, ledger conservation, refunds, settlement, and irreversible monetary effects, use `payments-ledger-integrity.md`; this reference owns the commercial-access lifecycle around that monetary authority.

## Keep commercial authorities singular

Recover the owner of each fact before changing code:

- catalog: plan/price/currency/interval/feature/quota/add-on/seat semantics and versioning;
- subscription: durable account-scoped lifecycle and effective-time transitions;
- payment/ledger: charge, invoice, credit, refund, settlement, balance, and monetary finality;
- provider projection: scoped external object/event state used as evidence, not automatic product truth;
- entitlement: current product-access projection derived from approved subscription/add-on/seat state;
- metering: accepted usage facts and aggregation windows for usage-based billing.

A pricing UI, checkout return page, cached plan label, provider webhook, invoice status, or feature flag is not a substitute for those owners. Do not create a second entitlement truth merely to make UI or provider integration convenient.

## Stable identity before retries

Keep stable internal account/subscription identity independent of provider attempts. Commercial mutations such as upgrade, downgrade, cancel, resume, seat change, or add-on change need stable request/idempotency identity. Preserve scoped provider references, billing-period/effective-time identity, entitlement generation, and usage-event identity where they affect correctness.

If a provider mutation times out after acceptance may have occurred, reconcile the existing request/provider identity before issuing another logical mutation. A new retry transport attempt must not silently become a second upgrade, cancellation, charge, or entitlement transition.

## Catalog and lifecycle are versioned contracts

Do not let a mutable “current plan” record rewrite history. Bind durable subscriptions/quotes to explicit immutable or time-bounded catalog identity, keep old versions interpretable during coexistence, and separate marketing labels from plan/price/feature authority.

Define trial start/end, conversion, payment-pending/failed/unknown behavior, renewal evidence, grace/dunning, expiration, cancellation/resume, and upgrade/downgrade effective time as real lifecycle states. Delayed workers and duplicate/out-of-order provider events must not extend trials forever, resurrect cancelled subscriptions, revoke resumed access, or apply a commercial change twice.

For plan changes, a preview/quote is not the final invoice. Bind the intended change to plan/version, quantity, period, currency, account/subscription, and request identity. Reconcile provider/payment outcome before advancing the durable subscription state whose entitlements depend on it.

Downgrade semantics must define what happens when current seats, usage, data, or feature state exceed the new plan. Do not delete customer data merely because access shrank unless a separate safe lifecycle explicitly owns that deletion.

## Seats and entitlements

Purchased quantity and assignment are distinct tenant-scoped facts. Concurrent assignment must preserve quantity invariants; downgrade behavior must define what happens to excess assignments.

Entitlements are a projection with one derivation owner. Derive them from authoritative subscription/add-on/seat state, carry generation/version information to reject stale updates, and define grant/revoke effective time, cache/session freshness, degraded behavior, and old-client compatibility. Re-authorize active sessions when revocation matters; login-time claims alone are not durable access authority.

If more than one system can mutate entitlements, establish one owner or explicit reconciliation. “Last webhook wins” is not an authority model.

## Usage metering

Usage events need stable tenant/account/subscription/meter/event identity, unit, aggregation rule, window/timezone, late/out-of-order policy, correction semantics, billing cutoff, retention, and auditability.

Producer retry must not increase billable quantity unless duplicates are intentionally billable. Period close must define whether late usage is still billable, corrected, carried forward, or rejected. Corrections should be auditable inputs/compensation rather than unexplained history rewrite.

## Provider events and reconciliation

Authenticate callbacks, scope event/object identity to the correct provider/account, deduplicate replay, tolerate delay and reordering, and never regress newer internal state from an older event. Keep unknown outcomes explicit.

Webhooks can be missed, duplicated, reordered, or delayed, so reconciliation is a first-class owner. Compare bounded internal subscription/payment references/provider state/entitlement generation/access and record drift such as provider-active/internal-expired, payment-unresolved beyond allowed grace, stale entitlement projection, seat mismatch, wrong-account provider reference, or usage aggregate mismatch.

Repair drift through idempotent domain transitions instead of direct row edits that erase the history needed to explain the mismatch.

## Compatibility, rollback, and observability

Assume old/new clients, workers, webhook schemas, catalog identifiers, queued work, and provider integrations can overlap. Keep stable internal subscription identity while external provider or catalog identifiers migrate; evolve contracts additively or through explicit versions until old readers and queued work are retired.

Code rollback cannot undo a captured charge, issued invoice/credit, provider-side cancellation, billing message already sent, or access already granted/revoked and consumed. Separate artifact rollback from monetary/domain compensation and reconciliation.

Correlate stable identities from account and change request through catalog/quote, provider/payment evidence, subscription transition, entitlement generation, and visible access. Observe drift, webhook delay/replay/order, grace aging, entitlement propagation, seat conflicts, usage duplicates/latency/corrections, reconciliation repairs, and unresolved unknown outcomes. Redact payment credentials, provider secrets, signed URLs, and unnecessary personal/invoice content.

## Validation shape

Use tests that can falsify the changed mechanism, such as:

- duplicate/out-of-order provider event;
- timeout after provider accepted a plan change;
- trial expiry/conversion failure;
- cancel-at-period-end plus resume-before-end;
- payment failure through grace and late recovery;
- upgrade/downgrade effective-time and proration handoff;
- concurrent seat assignment at the limit;
- late/duplicate usage;
- cross-tenant subscription/provider-reference rejection;
- provider/subscription/entitlement reconciliation drift;
- mixed old/new catalog or provider identities.

The useful oracle is not “HTTP 200.” It is that scoped catalog/subscription/payment evidence/provider state/entitlement projection and user-visible access converge correctly after retry, replay, delay, migration, and reconciliation.
