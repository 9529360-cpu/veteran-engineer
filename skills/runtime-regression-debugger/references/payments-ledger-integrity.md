# Payments, Ledgers, and Irreversible Side Effects

Use this reference when a system moves money, credits, inventory-like value, quotas, entitlements, or performs side effects that are difficult to reverse.

## Model money as a domain, not a numeric field

- Use integer minor units or a domain-appropriate decimal representation; never binary floating point for exact monetary accounting.
- Carry currency explicitly and obey currency-specific scale/rounding rules.
- Separate quoted amount, authorized amount, captured amount, refunded amount, fee, tax, settlement, and accounting entries when the provider/domain distinguishes them.
- Never infer financial truth solely from a UI success page or one webhook.

## Stable operation identity

Every externally replayable mutation should have a stable logical idempotency identity scoped to the correct actor/account/operation.

Handle the classic ambiguity: request timed out after the provider may have accepted it. Before retrying blindly, query/reconcile using the stable operation identity or provider reference.

## Ledger discipline

For stored value or accounting-like systems:

- prefer append-only entries and explicit corrections over rewriting historical balances;
- derive or reconcile balances from authoritative entries where feasible;
- encode conservation/invariant checks such as debits = credits for double-entry ledgers;
- separate pending, posted, reversed, disputed, failed, and settled states when materially different;
- make every adjustment auditable with actor/reason/source identity without leaking sensitive data.

A ledger is not merely an event log. It represents domain invariants and reconciliation authority.

## Provider workflows

Treat authorization, capture, cancellation, refund, payout, dispute, and settlement as state machines whose transitions may be asynchronous and duplicated.

- Authenticate and deduplicate webhooks.
- Expect webhook order differences and delayed delivery.
- Reconcile periodically against provider authoritative state instead of relying only on push delivery.
- Avoid committing an internal irreversible entitlement before the payment state required by the product contract is durable.

## Security and scope

Keep payment credentials/tokens out of logs, analytics, URLs, and support bundles. Minimize handling of raw regulated data; use provider tokenization and least-privileged scoped credentials where possible.

Tenant/account/provider context must be part of every authorization, idempotency, lookup, cache, job, and reconciliation key.

## Operational safety

For bulk credits/refunds/migrations, require dry-run/counts, bounded batches, resumability, duplicate protection, reconciliation totals, approval boundaries appropriate to the environment, and a halt condition when invariants drift.

Never use "rerun the job" as a recovery strategy until duplicate monetary effects have been proven impossible or safely deduplicated.

## Clearing, settlement, payout, and reconciliation

Separate customer-facing payment success from processor/acquirer settlement and internal accounting finality.

- Model expected receivables/payables, fees, reserves, refunds, disputes/chargebacks, payout batches, settlement dates, and provider adjustments explicitly where the business needs them.
- Reconcile provider transaction-level detail to internal operations/ledger entries and then to settlement/payout totals; aggregate equality alone can hide offsetting errors.
- Treat settlement files/reports as replayable external input with stable source identity, version/date, duplicate detection, and auditable import state.
- Preserve timezone, currency, exchange-rate, fee, and rounding semantics used by the provider; never infer them from display formatting.
- Investigate unmatched, duplicate, late, and amount-mismatched records as explicit exception states with bounded retry/escalation, not silent manual edits.
- Keep reconciliation capable of re-running over a bounded historical window without creating new monetary effects.

For payout or merchant-balance systems, distinguish available, pending, reserved, paid, failed, reversed, and reconciled amounts. A provider dashboard balance is evidence, not a replacement for internally defined accounting authority.

## Financial recovery decisions

During a money-integrity incident, availability can be less important than preventing additional ambiguous mutations. It can be correct to pause capture/refund/payout paths while preserving read-only account access and reconciliation tooling.

Before bulk financial repair, establish:

`affected operation set -> authoritative references -> expected ledger/provider state -> proposed correction -> dry-run totals -> bounded execution -> post-run reconciliation`

Require exact counts and amount totals before and after repair. Preserve immutable evidence of the correction rather than overwriting the history that explains it.
