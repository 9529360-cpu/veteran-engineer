import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const reference = path.join(skillRoot, 'references', 'subscription-billing-entitlements-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('billing and entitlements route to the focused commercial-access owner and companion mechanisms', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const direct = runPython([
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

  const aliases = runPython([
    '--signals',
    'saas-billing,recurring-billing,subscription-plan-change,upgrade-downgrade,subscription-trial,trial-conversion,seat-management,seat-billing,metered-billing,usage-billing,subscription-webhook,stripe-subscription-webhook,entitlement-read-model,subscription-grace,subscription-reconciliation,invoice-entitlement-reconciliation,subscription-cancel,subscription-prorate',
    '--max', '18',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runPython(['--signals', 'subscription,plan,trial,seat,license,metering,invoice,entitlement', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['subscription', 'plan', 'trial', 'seat', 'license', 'metering', 'invoice', 'entitlement']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /reconcile the existing request\/provider identity before issuing another logical mutation/);
  assert.match(specialist, /Entitlements are a projection with one derivation owner/);
  assert.match(specialist, /Producer retry must not increase billable quantity/);
  assert.match(specialist, /Code rollback cannot undo a captured charge/);
});
