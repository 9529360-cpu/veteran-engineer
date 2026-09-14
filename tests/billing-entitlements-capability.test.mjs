import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const gate = path.join(skillRoot, 'scripts', 'billing_entitlements_gate.py');
const reference = path.join(skillRoot, 'references', 'subscription-billing-entitlements-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats subscription billing and entitlements as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Subscription Billing and Entitlements reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'billing-entitlements,subscription-billing,subscription-lifecycle,plan-change,trial-lifecycle,seat-entitlements,usage-metering,billing-webhook,entitlement-projection,subscription-grace-period,billing-reconciliation,subscription-cancellation,subscription-proration',
    '--max', '18',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/subscription-billing-entitlements-product-engineering.md',
    'references/payments-ledger-integrity.md',
    'references/security-multitenancy-patterns.md',
    'references/temporal-debugging-state-transitions.md',
    'references/async-edge-job-patterns.md',
    'references/data-consistency-migration-patterns.md',
    'references/api-backend-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'saas-billing,recurring-billing,subscription-plan-change,upgrade-downgrade,subscription-trial,trial-conversion,seat-management,seat-billing,metered-billing,usage-billing,subscription-webhook,stripe-subscription-webhook,entitlement-read-model,subscription-grace,subscription-reconciliation,invoice-entitlement-reconciliation,subscription-cancel,subscription-prorate',
    '--max', '18',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'subscription-billing', 'subscription-billing', 'plan-change', 'plan-change',
    'trial-lifecycle', 'trial-lifecycle', 'seat-entitlements', 'seat-entitlements',
    'usage-metering', 'usage-metering', 'billing-webhook', 'billing-webhook',
    'entitlement-projection', 'subscription-grace-period', 'billing-reconciliation', 'billing-reconciliation',
    'subscription-cancellation', 'subscription-proration'
  ]);

  const ambiguous = runPython(router, ['--signals', 'subscription,plan,trial,seat,license,metering,invoice,entitlement', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['subscription', 'plan', 'trial', 'seat', 'license', 'metering', 'invoice', 'entitlement']);
});

test('billing entitlements gate fails closed on incomplete authority and lifecycle contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Subscription Billing and Entitlements reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-billing-entitlements-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      product: {
        user_outcome: 'Customers receive the access they purchased at the correct effective time and retain truthful subscription state through retries and provider delays.',
        commercial_model: 'recurring SaaS plans with trials, seats, metered usage and account-scoped entitlements',
        subscription_classes: ['trial', 'recurring', 'seat-based', 'metered'],
        visible_states: 'trialing/active/past-due/grace/canceling/canceled/expired are distinct when product access or recovery differs'
      },
      authority: {
        catalog_owner: 'versioned internal catalog owns plan/price/feature semantics',
        subscription_owner: 'durable subscription aggregate owns lifecycle and effective-at transitions',
        entitlement_owner: 'derived entitlement projection owns current product access and references subscription generation',
        payment_owner: 'payments/ledger authority owns charge, invoice, refund, credit and monetary finality',
        provider_projection_owner: 'provider objects and webhooks are reconciled external evidence, never unscoped product access authority'
      },
      identity: {
        account_scope: 'tenant/account identity scopes subscriptions, provider customer refs, seats, usage and entitlements',
        subscription_identity: 'stable internal subscription id survives provider retries and plan changes',
        change_request_identity: 'each upgrade/downgrade/cancel/resume mutation has a stable idempotency identity',
        billing_period_identity: 'billing cycle and invoice period have stable boundaries and timezone semantics',
        entitlement_generation: 'each effective subscription transition advances a generation that stale workers/caches cannot overwrite'
      },
      catalog: {
        plan_versioning: 'plan/price versions are immutable or time-bounded and old subscriptions remain interpretable',
        feature_mapping: 'entitlements map from explicit plan/add-on/seat rules rather than UI labels',
        price_currency_tax: 'quotes bind currency, price version and approved tax treatment; money math delegates to payment authority',
        grandfathering: 'legacy plans and prices have explicit coexistence and migration rules'
      },
      lifecycle: {
        trial: 'trial start/end/conversion and payment-method requirements have explicit effective times and retry-safe transitions',
        activation: 'activation names the payment/provider evidence required before paid entitlements become effective',
        renewal: 'renewal separates billing attempt, monetary result, subscription state and entitlement effect',
        cancel_end_period: 'immediate versus period-end cancellation and resume-before-end are explicit state transitions',
        grace_dunning: 'past-due/grace/dunning windows define bounded access behavior and terminal recovery',
        upgrade_downgrade: 'upgrade/downgrade defines immediate versus next-cycle effect, proration and entitlement timing'
      },
      money: {
        quote_authority: 'versioned quote records inputs and is not confused with final provider invoice/ledger truth',
        proration: 'proration policy and rounding are explicit and reconciled to the final invoice through payment authority',
        invoice_payment_handoff: 'subscription state consumes normalized invoice/payment outcomes without becoming the monetary ledger',
        refund_credit_handoff: 'refunds/credits are executed and reconciled by payment authority before access corrections that depend on them'
      },
      entitlements: {
        projection_source: 'entitlement projection derives from authoritative subscription/add-on/seat state with generation identity',
        effective_time: 'grant/revoke times follow explicit subscription transition semantics, not webhook arrival time',
        seat_scope: 'purchased seat quantity and member assignment are distinct, tenant-scoped facts with concurrency rules',
        revocation: 'downgrade/cancel/account removal revokes only the intended capabilities and stale sessions are re-authorized',
        cache_freshness: 'cached entitlement decisions carry account+generation and fail closed or refresh when stale'
      },
      metering: {
        usage_identity: 'usage events have tenant/subscription/meter/stable event identity and cannot double bill on replay',
        aggregation_window: 'meter aggregation defines unit, window, timezone and authoritative cutoff',
        late_duplicate_events: 'late, duplicate and out-of-order usage are bounded and reconciled deterministically',
        corrections: 'usage corrections are auditable compensating input rather than history rewrite',
        billing_cutoff: 'period close defines when usage is billable, adjustable or carried forward'
      },
      provider: {
        webhook_auth: 'provider callbacks are authenticated, account-scoped, replay-bounded and secret-safe',
        dedupe_ordering: 'duplicate/out-of-order webhooks bind provider object+event/version and cannot regress newer subscription truth',
        unknown_outcome: 'timeout after provider mutation reconciles by stable request/provider identity before retry',
        reconciliation: 'scheduled reconciliation compares internal subscription/payment/entitlement state to provider objects and records drift',
        provider_migration: 'provider/customer/subscription id migration preserves stable internal identity and mixed-version readers'
      },
      tests: {
        scenarios: ['duplicate-provider-event', 'out-of-order-webhook', 'unknown-plan-change-outcome', 'trial-expiry', 'cancel-at-period-end', 'payment-failure-grace', 'upgrade-proration', 'downgrade-effective-time', 'seat-overage-race', 'late-usage-event', 'cross-tenant-entitlement', 'provider-reconciliation-drift', 'mixed-version-plan', 'resume-before-period-end'],
        oracle: 'catalog/subscription/payment evidence/entitlement projection/provider state agree on scoped effective access after retry, replay, migration and reconciliation'
      },
      observability: {
        transition_correlation: 'trace change request through quote, provider mutation, payment evidence, subscription transition and entitlement generation',
        billing_entitlement_drift: 'measure subscription/payment/provider/entitlement mismatches and reconciliation repair outcomes',
        metering_health: 'measure duplicate/late/rejected usage, aggregation lag, correction volume and period-close backlog',
        redaction_policy: 'logs exclude raw payment credentials, provider secrets and unnecessary personal or invoice data'
      },
      compatibility: {
        mixed_version_behavior: 'old/new clients, workers, webhooks and schemas coexist through additive/versioned state transitions',
        catalog_migration: 'old plan/price ids remain interpretable until all subscriptions and queued work are migrated',
        provider_migration: 'provider migration preserves internal subscription identity and reconciliation across dual-read/dual-event windows',
        rollback_external_effects: 'software rollback is separate from charges, invoices, cancellations or provider mutations already accepted externally'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      product: { user_outcome: '', commercial_model: true, subscription_classes: [], visible_states: '' },
      authority: {}, identity: {}, catalog: {}, lifecycle: {}, money: {}, entitlements: {}, metering: {}, provider: {},
      tests: { scenarios: ['trial-expiry'], oracle: false },
      observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'PRODUCT_FIELD_REQUIRED', 'SUBSCRIPTION_CLASSES_REQUIRED', 'AUTHORITY_FIELD_REQUIRED',
      'IDENTITY_FIELD_REQUIRED', 'CATALOG_FIELD_REQUIRED', 'LIFECYCLE_FIELD_REQUIRED',
      'MONEY_FIELD_REQUIRED', 'ENTITLEMENTS_FIELD_REQUIRED', 'METERING_FIELD_REQUIRED',
      'PROVIDER_FIELD_REQUIRED', 'TEST_SCENARIOS_INCOMPLETE', 'TESTS_FIELD_REQUIRED',
      'OBSERVABILITY_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
