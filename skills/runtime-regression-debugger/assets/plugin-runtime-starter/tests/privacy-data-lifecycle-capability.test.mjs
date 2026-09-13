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
const gate = path.join(skillRoot, 'scripts', 'privacy_data_lifecycle_gate.py');
const reference = path.join(skillRoot, 'references', 'privacy-data-lifecycle-engineering.md');

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

test('engineering context router treats privacy/data lifecycle as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Privacy and Data Lifecycle reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'privacy,data-privacy,data-minimization,consent-management,privacy-preference,data-retention,data-deletion,data-export,provider-data-egress,sensitive-logging',
    '--max', '12',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/privacy-data-lifecycle-engineering.md',
    'references/security-multitenancy-patterns.md',
    'references/data-consistency-migration-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md',
    'references/dependency-outcome-degradation.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'privacy-engineering,personal-data,pii-handling,purpose-limitation,consent-preference,cookie-consent,retention-policy,account-deletion,data-erasure,privacy-export,subject-data-export,third-party-data-sharing,pii-logging',
    '--max', '12',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'privacy', 'data-privacy', 'data-privacy', 'data-minimization', 'privacy-preference',
    'privacy-preference', 'data-retention', 'data-deletion', 'data-deletion', 'data-export',
    'data-export', 'provider-data-egress', 'sensitive-logging'
  ]);

  const ambiguous = runPython(router, ['--signals', 'data,delete,export,logging,tracking,cookie', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['data', 'delete', 'export', 'logging', 'tracking', 'cookie']);
});

test('privacy/data lifecycle gate fails closed on incomplete lifecycle contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Privacy and Data Lifecycle reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-privacy-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      purpose: {
        user_outcome: 'Users can use the feature without unrelated collection and can see truthful completion of privacy lifecycle requests.',
        approved_purpose: 'store profile/contact fields only to deliver the requested account and collaboration behavior under approved product policy',
        data_categories: 'account identifiers, profile fields, user-authored content, bounded product telemetry',
        minimization_policy: 'collect only fields needed for the declared workflow; provider/event payloads use minimal projections'
      },
      authority: {
        authorization_owner: 'server authorization binds principal, tenant, object, and action at the trusted boundary',
        processing_policy_owner: 'versioned product privacy policy/config defines which optional processing purposes are enabled',
        preference_or_consent_owner: 'account-scoped durable privacy preference owns optional analytics/provider behavior where applicable',
        freshness_policy: 'async workers bind to preference generation or recheck current authority before consequential processing'
      },
      copies: {
        system_of_record: 'primary account/content stores are authoritative; other stores are projections or bounded processing copies',
        derivative_inventory: 'cache, search, object storage, analytics, queue payloads and provider copies are explicitly mapped',
        logs_and_evidence: 'logs/traces/evidence contain stable ids and redacted metadata, not raw user content or secrets',
        backup_restore_behavior: 'approved backups expire by policy and restored data re-enters suppression/deletion reconciliation before becoming active'
      },
      lifecycle: {
        retention_anchor: 'account/object closure or product-policy event starts the retention state machine',
        retention_action: 'idempotent resumable cleanup evaluates approved holds/exceptions then deletes, anonymizes or archives by contract',
        revocation_behavior: 'new optional processing stops at current authority; queued stale work is rejected by generation/freshness checks',
        deletion_convergence: 'primary, cache, search, objects, representative derivatives and provider copies converge before visible completion'
      },
      user_flows: {
        access_or_export: 'authorized request snapshots exact subject/tenant scope, generates a protected expiring artifact and excludes secrets/other principals',
        correction: 'authoritative updates invalidate or recompute affected projections and preserve explicitly immutable audit records by contract',
        deletion_or_closure: 'suppress new processing, fan out cleanup, reconcile partial failures and use tombstones where delayed replay could resurrect state',
        visible_terminal_states: 'pending, partial/retryable, completed and failed/recovery states are truthful to the actual lifecycle outcome'
      },
      providers: {
        egress_boundary: 'each external provider call declares fields, purpose, tenant binding, configuration and trigger',
        data_minimization: 'only the minimum provider projection is sent; browser/mobile SDK collection follows authoritative preference state',
        revocation_or_deletion: 'provider cleanup/revocation interface is invoked and reconciled when the product lifecycle requires it',
        failure_behavior: 'provider failure yields explicit degraded/pending cleanup rather than local false success'
      },
      observability: {
        lifecycle_status: 'track privacy workflow stage, backlog and age by bounded store/provider identity without payload content',
        redaction_policy: 'redaction/omission happens before logs/events/traces leave the producer boundary',
        reconciliation_failures: 'cleanup/export/provider failures are queryable by request id and store/provider stage'
      },
      validation: {
        scenarios: ['minimization', 'revocation', 'export-isolation', 'deletion-convergence', 'partial-failure', 'stale-work', 'backup-replay'],
        oracle: 'machine-visible copies/providers and user-visible terminal state agree with the declared lifecycle after retries and replay'
      },
      compatibility: {
        mixed_version_behavior: 'old/new clients, workers and events cannot bypass current suppression/preference authority during overlap',
        migration: 'new lifecycle authority is introduced additively before writers/providers switch and old copies are reconciled',
        rollback: 'code/config rollback is separate from irreversible disclosure/deletion and includes provider or recovery remediation where required'
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
      purpose: { user_outcome: '', approved_purpose: true, data_categories: '', minimization_policy: '' },
      authority: {}, copies: {}, lifecycle: {}, user_flows: {}, providers: {}, observability: {},
      validation: { scenarios: ['deletion-convergence'], oracle: false },
      compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'PURPOSE_FIELD_REQUIRED', 'AUTHORITY_FIELD_REQUIRED', 'COPIES_FIELD_REQUIRED', 'LIFECYCLE_FIELD_REQUIRED',
      'USER_FLOWS_FIELD_REQUIRED', 'PROVIDERS_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED',
      'VALIDATION_SCENARIOS_INCOMPLETE', 'VALIDATION_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
