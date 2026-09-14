import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const proofGate = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'proof_bundle_gate.py');

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

function validBundle() {
  return {
    change_identity: 'change-abc123',
    claims: [{
      id: 'claim-current',
      claim: 'the exact candidate preserves the integration contract',
      required_level: 'integration',
      evidence_ids: ['ev-current']
    }],
    evidence: [{
      id: 'ev-current',
      level: 'integration',
      applies_to: ['change-abc123'],
      result: 'supports',
      observed_at: '2026-09-14T04:00:00Z',
      max_age_hours: 2
    }]
  };
}

async function runBundle(t, bundle, now = '2026-09-14T05:00:00Z') {
  if (!(await exists(proofGate))) {
    t.skip('source Skill proof gate is not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-types-'));
  try {
    const target = path.join(dir, 'proof.json');
    await fs.writeFile(target, JSON.stringify(bundle), 'utf8');
    const result = runPython(proofGate, [target, '--now', now, '--json']);
    assert.ok(result, 'python is required by the proof metadata regression');
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('proof bundle keeps canonical string identities and numeric freshness backward compatible', async (t) => {
  const bundle = validBundle();
  bundle.change_identity = '  change-abc123  ';
  bundle.claims[0].id = '  claim-current  ';
  bundle.claims[0].required_level = ' Integration ';
  bundle.claims[0].evidence_ids = [' ev-current '];
  bundle.evidence[0].id = ' ev-current ';
  bundle.evidence[0].level = ' Integration ';
  bundle.evidence[0].applies_to = [' change-abc123 '];
  bundle.evidence[0].result = ' Supports ';

  const result = await runBundle(t, bundle);
  if (!result) return;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gate_passed, true);
  assert.equal(payload.change_identity, 'change-abc123');
  assert.equal(payload.claims[0].id, 'claim-current');
  assert.equal(payload.claims[0].required_level, 'integration');
});

test('proof bundle rejects coercible non-string authority identities and references', async (t) => {
  for (const value of [42, true, {}, []]) {
    const bundle = validBundle();
    bundle.change_identity = value;
    bundle.evidence[0].applies_to = [value];
    const result = await runBundle(t, bundle);
    if (!result) return;
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /change_identity must be a non-empty string/);
  }

  const evidenceId = validBundle();
  evidenceId.evidence[0].id = 7;
  evidenceId.claims[0].evidence_ids = ['7'];
  const evidenceIdResult = await runBundle(t, evidenceId);
  assert.equal(evidenceIdResult.status, 2, evidenceIdResult.stderr || evidenceIdResult.stdout);
  assert.match(evidenceIdResult.stderr, /evidence\[0\]\.id must be a non-empty string/);

  const claimId = validBundle();
  claimId.claims[0].id = false;
  const claimIdResult = await runBundle(t, claimId);
  assert.equal(claimIdResult.status, 2, claimIdResult.stderr || claimIdResult.stdout);
  assert.match(claimIdResult.stderr, /claim\[0\]\.id must be a non-empty string/);

  const ref = validBundle();
  ref.claims[0].evidence_ids = [7];
  ref.evidence[0].id = '7';
  const refResult = await runBundle(t, ref);
  assert.equal(refResult.status, 2, refResult.stderr || refResult.stdout);
  assert.match(refResult.stderr, /claims\[0\]\.evidence_ids\[0\] must be a non-empty string/);

  const scope = validBundle();
  scope.evidence[0].applies_to = ['change-abc123', 7];
  const scopeResult = await runBundle(t, scope);
  assert.equal(scopeResult.status, 2, scopeResult.stderr || scopeResult.stdout);
  assert.match(scopeResult.stderr, /evidence\[0\]\.applies_to\[1\] must be a non-empty string/);
});

test('proof bundle treats malformed claim and evidence rows as invalid manifests', async (t) => {
  const malformedEvidence = validBundle();
  malformedEvidence.evidence.push('not-an-object');
  const evidenceResult = await runBundle(t, malformedEvidence);
  if (!evidenceResult) return;
  assert.equal(evidenceResult.status, 2, evidenceResult.stderr || evidenceResult.stdout);
  assert.match(evidenceResult.stderr, /evidence\[1\] must be an object/);

  const malformedClaim = validBundle();
  malformedClaim.claims.push(123);
  const claimResult = await runBundle(t, malformedClaim);
  assert.equal(claimResult.status, 2, claimResult.stderr || claimResult.stdout);
  assert.match(claimResult.stderr, /claims\[1\] must be an object/);
});

test('proof freshness refuses boolean or numeric-string limits without changing semantic expiry blockers', async (t) => {
  for (const value of ['2', true]) {
    const bundle = validBundle();
    bundle.evidence[0].max_age_hours = value;
    const result = await runBundle(t, bundle);
    if (!result) return;
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /max_age_hours must be a finite non-negative number/);
  }

  const malformedObserved = validBundle();
  malformedObserved.evidence[0].observed_at = 123;
  const malformedObservedResult = await runBundle(t, malformedObserved);
  assert.equal(malformedObservedResult.status, 2, malformedObservedResult.stderr || malformedObservedResult.stdout);
  assert.match(malformedObservedResult.stderr, /observed_at must be a timestamp string/);

  const negative = validBundle();
  negative.evidence[0].max_age_hours = -1;
  const negativeResult = await runBundle(t, negative);
  assert.equal(negativeResult.status, 1, negativeResult.stderr || negativeResult.stdout);
  const payload = JSON.parse(negativeResult.stdout);
  assert.equal(payload.gate_passed, false);
  assert.deepEqual(payload.evidence_problems['ev-current'], ['invalid_freshness']);
});
