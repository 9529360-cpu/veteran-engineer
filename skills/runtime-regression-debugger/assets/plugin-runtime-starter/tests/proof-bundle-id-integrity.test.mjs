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
const proofGate = path.join(scripts, 'proof_bundle_gate.py');
const assumptionGate = path.join(scripts, 'assumption_ledger.py');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

async function writeJson(dir, name, value) {
  const target = path.join(dir, name);
  await fs.writeFile(target, JSON.stringify(value), 'utf8');
  return target;
}

const identity = 'change-abc123';
const usableEvidence = {
  id: 'ev-current',
  level: 'integration',
  applies_to: [identity],
  result: 'supports'
};
const usableClaim = {
  id: 'claim-current',
  claim: 'the changed integration path preserves the contract',
  required_level: 'integration',
  evidence_ids: ['ev-current']
};

test('proof bundle keeps unique claim/evidence identities backward compatible', async (t) => {
  if (!(await exists(proofGate)) || !(await exists(assumptionGate))) {
    t.skip('source Skill proof/assumption gates are not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-id-valid-'));
  try {
    const proofPath = await writeJson(dir, 'proof.json', {
      change_identity: identity,
      claims: [usableClaim],
      evidence: [usableEvidence]
    });
    const ledgerPath = await writeJson(dir, 'ledger.json', {
      change_identity: identity,
      assumptions: [{
        assumption: 'the integration path owns the observed behavior',
        status: 'proven',
        decision_sensitive: true,
        proof_claim_id: 'claim-current'
      }]
    });

    const proof = runPython(proofGate, [proofPath, '--json']);
    assert.ok(proof, 'python is required by the proof identity regression');
    assert.equal(proof.status, 0, proof.stderr || proof.stdout);
    assert.equal(JSON.parse(proof.stdout).gate_passed, true);

    const ledger = runPython(assumptionGate, [ledgerPath, '--proof-bundle', proofPath, '--json']);
    assert.equal(ledger.status, 0, ledger.stderr || ledger.stdout);
    assert.equal(JSON.parse(ledger.stdout).gate_passed, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('proof bundle rejects duplicate evidence ids before overwrite can choose an authority', async (t) => {
  if (!(await exists(proofGate)) || !(await exists(assumptionGate))) {
    t.skip('source Skill proof/assumption gates are not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-id-evidence-'));
  try {
    const proofPath = await writeJson(dir, 'proof.json', {
      change_identity: identity,
      claims: [{ ...usableClaim, evidence_ids: ['ev-duplicate'] }],
      evidence: [
        { id: 'ev-duplicate', level: 'invalid-level', applies_to: [identity], result: 'fail' },
        { id: 'ev-duplicate', level: 'production', applies_to: [identity], result: 'supports' }
      ]
    });
    const ledgerPath = await writeJson(dir, 'ledger.json', {
      change_identity: identity,
      assumptions: [{
        assumption: 'duplicate evidence cannot choose its own winner',
        status: 'proven',
        decision_sensitive: true,
        proof_claim_id: 'claim-current'
      }]
    });

    const proof = runPython(proofGate, [proofPath, '--json']);
    assert.ok(proof, 'python is required by the proof identity regression');
    assert.equal(proof.status, 2, proof.stderr || proof.stdout);
    assert.match(proof.stderr, /duplicate evidence id: ev-duplicate/);

    const ledger = runPython(assumptionGate, [ledgerPath, '--proof-bundle', proofPath, '--json']);
    assert.equal(ledger.status, 2, ledger.stderr || ledger.stdout);
    assert.match(ledger.stderr, /duplicate evidence id: ev-duplicate/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('proof bundle rejects duplicate claim ids before assumption lookup becomes ambiguous', async (t) => {
  if (!(await exists(proofGate)) || !(await exists(assumptionGate))) {
    t.skip('source Skill proof/assumption gates are not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-id-claim-'));
  try {
    const proofPath = await writeJson(dir, 'proof.json', {
      change_identity: identity,
      claims: [
        usableClaim,
        { ...usableClaim, claim: 'a conflicting second meaning under the same claim id' }
      ],
      evidence: [usableEvidence]
    });
    const ledgerPath = await writeJson(dir, 'ledger.json', {
      change_identity: identity,
      assumptions: [{
        assumption: 'the claim identity is unambiguous',
        status: 'proven',
        decision_sensitive: true,
        proof_claim_id: 'claim-current'
      }]
    });

    const proof = runPython(proofGate, [proofPath, '--json']);
    assert.ok(proof, 'python is required by the proof identity regression');
    assert.equal(proof.status, 2, proof.stderr || proof.stdout);
    assert.match(proof.stderr, /duplicate claim id: claim-current/);

    const ledger = runPython(assumptionGate, [ledgerPath, '--proof-bundle', proofPath, '--json']);
    assert.equal(ledger.status, 2, ledger.stderr || ledger.stdout);
    assert.match(ledger.stderr, /duplicate claim id: claim-current/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('proof bundle detects explicit ids that collide with deterministic fallback ids', async (t) => {
  if (!(await exists(proofGate))) {
    t.skip('source Skill proof gate is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-proof-id-fallback-'));
  try {
    const evidenceCollision = await writeJson(dir, 'evidence-collision.json', {
      change_identity: identity,
      claims: [{ ...usableClaim, evidence_ids: ['evidence-2'] }],
      evidence: [
        { id: 'evidence-2', level: 'integration', applies_to: [identity], result: 'supports' },
        { level: 'integration', applies_to: [identity], result: 'supports' }
      ]
    });
    const evidenceResult = runPython(proofGate, [evidenceCollision, '--json']);
    assert.ok(evidenceResult, 'python is required by the proof identity regression');
    assert.equal(evidenceResult.status, 2, evidenceResult.stderr || evidenceResult.stdout);
    assert.match(evidenceResult.stderr, /duplicate evidence id: evidence-2/);

    const claimCollision = await writeJson(dir, 'claim-collision.json', {
      change_identity: identity,
      claims: [
        { ...usableClaim, id: 'claim-2' },
        { claim: 'fallback claim collides with explicit claim-2', evidence_ids: ['ev-current'] }
      ],
      evidence: [usableEvidence]
    });
    const claimResult = runPython(proofGate, [claimCollision, '--json']);
    assert.equal(claimResult.status, 2, claimResult.stderr || claimResult.stdout);
    assert.match(claimResult.stderr, /duplicate claim id: claim-2/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
