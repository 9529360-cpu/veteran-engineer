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

function proofBundle(identity = 'change-abc123', claimId = 'claim-current') {
  return {
    change_identity: identity,
    claims: [{
      id: claimId,
      claim: 'current integration evidence establishes the decision premise',
      required_level: 'integration',
      evidence_ids: ['ev-current']
    }],
    evidence: [{
      id: 'ev-current',
      level: 'integration',
      applies_to: [identity],
      result: 'supports',
      observed_at: '2026-09-14T04:00:00Z',
      max_age_hours: 2
    }]
  };
}

function sensitiveLedger() {
  return {
    change_identity: 'change-abc123',
    assumptions: [{
      assumption: 'the integration path owns the observed behavior',
      status: 'proven',
      decision_sensitive: true,
      proof_claim_id: 'claim-current'
    }]
  };
}

async function runLedger(t, ledger, proof = null) {
  if (!(await exists(assumptionGate))) {
    t.skip('source Skill assumption gate is not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-assumption-types-'));
  try {
    const ledgerPath = path.join(dir, 'ledger.json');
    await fs.writeFile(ledgerPath, JSON.stringify(ledger), 'utf8');
    const args = [ledgerPath, '--now', '2026-09-14T05:00:00Z', '--json'];
    if (proof) {
      const proofPath = path.join(dir, 'proof.json');
      await fs.writeFile(proofPath, JSON.stringify(proof), 'utf8');
      args.splice(1, 0, '--proof-bundle', proofPath);
    }
    const result = runPython(assumptionGate, args);
    assert.ok(result, 'python is required by the assumption metadata regression');
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('assumption ledger keeps canonical string proof links and lightweight local notes backward compatible', async (t) => {
  const ledger = sensitiveLedger();
  ledger.change_identity = '  change-abc123  ';
  ledger.assumptions[0].assumption = '  the integration path owns the observed behavior  ';
  ledger.assumptions[0].status = ' Proven ';
  ledger.assumptions[0].proof_claim_id = ' claim-current ';

  const result = await runLedger(t, ledger, proofBundle());
  if (!result) return;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gate_passed, true);
  assert.equal(payload.change_identity, 'change-abc123');
  assert.equal(payload.assumptions[0].proof_claim_id, 'claim-current');

  const lightweight = await runLedger(t, {
    assumptions: [{
      assumption: 'helper copy is stable enough for this local check',
      status: 'proven',
      decision_sensitive: false,
      evidence: [{ note: 'task-local UI fixture; intentionally not a proof bundle' }]
    }]
  });
  assert.equal(lightweight.status, 0, lightweight.stderr || lightweight.stdout);
  assert.equal(JSON.parse(lightweight.stdout).gate_passed, true);
});

test('assumption ledger rejects non-object roots and rows as malformed manifests', async (t) => {
  const rootResult = await runLedger(t, []);
  if (!rootResult) return;
  assert.equal(rootResult.status, 2, rootResult.stderr || rootResult.stdout);
  assert.match(rootResult.stderr, /assumption ledger root must be an object/);

  const rowResult = await runLedger(t, { assumptions: ['not-an-object'] });
  assert.equal(rowResult.status, 2, rowResult.stderr || rowResult.stdout);
  assert.match(rowResult.stderr, /assumptions\[0\] must be an object/);
});

test('assumption ledger does not coerce change identity or proof claim references into authority', async (t) => {
  const numericIdentity = sensitiveLedger();
  numericIdentity.change_identity = 7;
  numericIdentity.assumptions[0].proof_claim_id = 'claim-current';
  const identityResult = await runLedger(t, numericIdentity, proofBundle('7'));
  if (!identityResult) return;
  assert.equal(identityResult.status, 2, identityResult.stderr || identityResult.stdout);
  assert.match(identityResult.stderr, /change_identity must be a string/);

  const numericClaim = sensitiveLedger();
  numericClaim.assumptions[0].proof_claim_id = 7;
  const claimResult = await runLedger(t, numericClaim, proofBundle('change-abc123', '7'));
  assert.equal(claimResult.status, 2, claimResult.stderr || claimResult.stdout);
  assert.match(claimResult.stderr, /assumptions\[0\]\.proof_claim_id must be a string/);

  const booleanIdentity = sensitiveLedger();
  booleanIdentity.change_identity = true;
  const booleanResult = await runLedger(t, booleanIdentity, proofBundle('True'));
  assert.equal(booleanResult.status, 2, booleanResult.stderr || booleanResult.stdout);
  assert.match(booleanResult.stderr, /change_identity must be a string/);
});

test('assumption ledger rejects non-string reasoning text instead of inventing text through coercion', async (t) => {
  const numericAssumption = sensitiveLedger();
  numericAssumption.assumptions[0].assumption = 123;
  const assumptionResult = await runLedger(t, numericAssumption, proofBundle());
  if (!assumptionResult) return;
  assert.equal(assumptionResult.status, 2, assumptionResult.stderr || assumptionResult.stdout);
  assert.match(assumptionResult.stderr, /assumptions\[0\]\.assumption must be a string/);

  const numericFalsifier = sensitiveLedger();
  numericFalsifier.assumptions[0] = {
    assumption: 'the integration path is the only writer',
    status: 'refuted',
    decision_sensitive: true,
    falsifier: 123,
    proof_claim_id: 'claim-current'
  };
  const falsifierResult = await runLedger(t, numericFalsifier, proofBundle());
  assert.equal(falsifierResult.status, 2, falsifierResult.stderr || falsifierResult.stdout);
  assert.match(falsifierResult.stderr, /assumptions\[0\]\.falsifier must be a string/);

  const booleanStatus = sensitiveLedger();
  booleanStatus.assumptions[0].status = true;
  const statusResult = await runLedger(t, booleanStatus, proofBundle());
  assert.equal(statusResult.status, 2, statusResult.stderr || statusResult.stdout);
  assert.match(statusResult.stderr, /assumptions\[0\]\.status must be a string/);
});

test('missing optional proof-link fields remain semantic blockers and decision_sensitive keeps its existing blocker', async (t) => {
  const missing = sensitiveLedger();
  missing.change_identity = null;
  missing.assumptions[0].proof_claim_id = null;
  const missingResult = await runLedger(t, missing, proofBundle());
  if (!missingResult) return;
  assert.equal(missingResult.status, 1, missingResult.stderr || missingResult.stdout);
  const missingPayload = JSON.parse(missingResult.stdout);
  assert.ok(missingPayload.assumptions[0].problems.includes('missing_change_identity'));
  assert.ok(missingPayload.assumptions[0].problems.includes('missing_proof_claim'));

  const sensitiveType = {
    assumptions: [{
      assumption: 'local note remains non-authoritative',
      status: 'proven',
      decision_sensitive: 'false',
      evidence: ['task-local evidence']
    }]
  };
  const sensitiveTypeResult = await runLedger(t, sensitiveType);
  assert.equal(sensitiveTypeResult.status, 1, sensitiveTypeResult.stderr || sensitiveTypeResult.stdout);
  const sensitivePayload = JSON.parse(sensitiveTypeResult.stdout);
  assert.ok(sensitivePayload.assumptions[0].problems.includes('invalid_decision_sensitive'));
});
