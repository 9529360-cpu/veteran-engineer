import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scripts = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts');
const assumptionGate = path.join(scripts, 'assumption_ledger.py');
const proofGate = path.join(scripts, 'proof_bundle_gate.py');

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

function proofBundle() {
  return {
    change_identity: 'acme/shop@abc123',
    claims: [
      {
        id: 'order-writer-authority',
        claim: 'OrderService is the only authoritative order writer',
        required_level: 'integration',
        evidence_ids: ['writer-integration']
      }
    ],
    evidence: [
      {
        id: 'writer-integration',
        level: 'integration',
        applies_to: ['acme/shop@abc123'],
        result: 'pass',
        observed_at: '2026-09-14T03:30:00Z',
        max_age_hours: 2
      }
    ]
  };
}

function assumptionLedger() {
  return {
    change_identity: 'acme/shop@abc123',
    assumptions: [
      {
        assumption: 'OrderService is the only authoritative order writer',
        status: 'proven',
        decision_sensitive: true,
        proof_claim_id: 'order-writer-authority'
      },
      {
        assumption: 'Checkout helper copy is stable',
        status: 'proven',
        decision_sensitive: false,
        evidence: ['current UI fixture']
      }
    ]
  };
}

async function runCase(t, ledger, proof = null, now = '2026-09-14T04:00:00Z') {
  if (!(await exists(assumptionGate)) || !(await exists(proofGate))) {
    t.skip('source Skill assumption/proof gates are not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-assumption-proof-'));
  try {
    const ledgerPath = path.join(dir, 'ledger.json');
    await fs.writeFile(ledgerPath, JSON.stringify(ledger), 'utf8');
    const args = [ledgerPath, '--now', now, '--json'];
    if (proof) {
      const proofPath = path.join(dir, 'proof.json');
      await fs.writeFile(proofPath, JSON.stringify(proof), 'utf8');
      args.splice(1, 0, '--proof-bundle', proofPath);
    }
    const result = runPython(assumptionGate, args);
    assert.ok(result, 'python is required by the Skill gate regression');
    return { result, payload: JSON.parse(result.stdout) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('decision-sensitive proven assumptions require and accept a fresh current proof claim', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-cli-'));
  try {
    const proofPath = path.join(dir, 'proof.json');
    await fs.writeFile(proofPath, JSON.stringify(proofBundle()), 'utf8');
    const proofResult = runPython(proofGate, [proofPath, '--now', '2026-09-14T04:00:00Z', '--json']);
    assert.ok(proofResult);
    assert.equal(proofResult.status, 0, proofResult.stderr || proofResult.stdout);
    assert.equal(JSON.parse(proofResult.stdout).gate_passed, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const out = await runCase(t, assumptionLedger(), proofBundle());
  if (!out) return;
  assert.equal(out.result.status, 0, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.gate_passed, true);
  assert.equal(out.payload.proof_bundle_gate_passed, true);
  assert.deepEqual(out.payload.assumptions[0].problems, []);
  assert.deepEqual(out.payload.assumptions[1].problems, []);
});

test('decision-sensitive proven assumptions fail closed on missing, stale, foreign, or unknown proof', async (t) => {
  const missing = assumptionLedger();
  delete missing.assumptions[0].proof_claim_id;
  missing.assumptions[0].evidence = ['plain note is not authoritative proof'];
  const missingOut = await runCase(t, missing);
  if (!missingOut) return;
  assert.notEqual(missingOut.result.status, 0);
  assert.ok(missingOut.payload.assumptions[0].problems.includes('missing_proof_claim'));
  assert.ok(missingOut.payload.assumptions[0].problems.includes('missing_proof_bundle'));

  const staleOut = await runCase(t, assumptionLedger(), proofBundle(), '2026-09-14T10:00:00Z');
  assert.notEqual(staleOut.result.status, 0);
  assert.equal(staleOut.payload.proof_bundle_gate_passed, false);
  assert.ok(staleOut.payload.assumptions[0].problems.includes('unusable_proof_claim'));

  const foreign = assumptionLedger();
  foreign.change_identity = 'acme/shop@different';
  const foreignOut = await runCase(t, foreign, proofBundle());
  assert.notEqual(foreignOut.result.status, 0);
  assert.ok(foreignOut.payload.assumptions[0].problems.includes('proof_identity_mismatch'));

  const unknown = assumptionLedger();
  unknown.assumptions[0].proof_claim_id = 'missing-claim';
  const unknownOut = await runCase(t, unknown, proofBundle());
  assert.notEqual(unknownOut.result.status, 0);
  assert.ok(unknownOut.payload.assumptions[0].problems.includes('unknown_proof_claim'));
});
