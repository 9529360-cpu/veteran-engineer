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
const gate = path.join(skillRoot, 'scripts', 'takeover_readiness_gate.py');
const reference = path.join(skillRoot, 'references', 'project-takeover-engineering.md');

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

function validManifest() {
  return {
    repository: {
      authorized_identity: 'acme/shop',
      observed_identity: 'acme/shop',
      default_branch: 'main',
      revision: 'abc123',
      identity_evidence: ['origin remote resolves to acme/shop', 'live default branch head is abc123']
    },
    contract: {
      actor: 'signed-in buyer',
      intent: 'submit one order',
      transition: 'validated cart becomes durable order',
      postconditions: 'one durable order and visible confirmation',
      failure_recovery: 'unknown payment outcome reconciles before retry',
      compatibility: 'existing API clients retain response fields'
    },
    maps: {
      entry: { applicable: true, entries: ['POST /checkout -> CheckoutController'] },
      authority: { applicable: true, entries: ['OrderService owns order creation'] },
      data: { applicable: true, entries: ['orders table is durable order truth'] },
      runtime: { applicable: true, entries: ['api and payment worker deploy independently'] },
      validation: { applicable: true, entries: ['checkout contract test and payment integration test'] },
      delivery: { applicable: true, entries: ['merge to main builds image; promotion is manual'] }
    },
    active_path: {
      entry: 'POST /checkout',
      registration_or_wiring: 'router binds CheckoutController.submit',
      caller: 'CheckoutController.submit',
      authority: 'OrderService.create',
      effect: 'transaction inserts orders row then emits outbox event',
      visible_result: '201 response with order id',
      liveness_evidence: ['router registration', 'integration test executes OrderService.create']
    },
    mutation_target: {
      path: 'src/orders/OrderService.ts',
      classification: 'authoritative-source',
      source_of_truth: 'runtime imports src/orders/OrderService.ts through build graph'
    },
    companion_consumers: ['payment worker', 'generated API client', 'order status projection'],
    unknowns: { blocking: [], high_value: [], deferrable: ['dashboard copy can be polished later'] },
    first_change: {
      kind: 'regression-test',
      scope: 'characterize duplicate checkout request behavior',
      why_smallest: 'proves idempotency owner before production mutation',
      falsifier: 'duplicate request creates two durable orders',
      rollback_or_recovery: 'test-only change is removable',
      expected_write_set: ['tests/checkout-idempotency.test.ts']
    },
    validation: {
      focused_oracle: 'duplicate request yields one order id',
      integration_boundary: 'API -> DB -> outbox',
      exact_identity: 'commit SHA plus test database fixture version',
      required_gates: ['checkout contract test', 'repository typecheck']
    },
    parallel_work: { checked: true, overlaps: [], strategy: '' }
  };
}

test('project takeover readiness gate accepts a bounded evidence-backed first mutation', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill takeover gate is not present in this isolated runtime fixture');
    return;
  }
  assert.equal(await exists(reference), true);
  assert.match(await fs.readFile(reference, 'utf8'), /takeover_readiness_gate\.py/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-takeover-ready-'));
  try {
    const manifestPath = path.join(dir, 'ready.json');
    await fs.writeFile(manifestPath, JSON.stringify(validManifest()), 'utf8');
    const result = runPython(gate, [manifestPath, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.blockers, []);
    assert.equal(payload.summary.identity_proofs, 2);
    assert.equal(payload.summary.liveness_proofs, 2);
    assert.equal(payload.summary.expected_write_set, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('project takeover readiness gate fails closed on wrong-repo, authority, unknown, breadth, and collision gaps', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill takeover gate is not present in this isolated runtime fixture');
    return;
  }

  const manifest = validManifest();
  manifest.repository.observed_identity = 'acme/admin';
  manifest.repository.identity_evidence = [];
  manifest.maps.entry = { applicable: false, reason: 'not yet traced' };
  manifest.mutation_target = {
    path: 'dist/app.js',
    classification: 'generated-output',
    source_of_truth: 'src/app.ts'
  };
  manifest.unknowns.blocking = ['which service owns the write'];
  manifest.unknowns.high_value = ['whether old clients overlap'];
  manifest.first_change.kind = 'rewrite';
  manifest.first_change.expected_write_set = [];
  manifest.parallel_work = { checked: false, overlaps: ['src/core.ts'], strategy: '' };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-takeover-blocked-'));
  try {
    const manifestPath = path.join(dir, 'blocked.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    const result = runPython(gate, [manifestPath, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = new Set(payload.blockers.map((item) => item.code));
    for (const code of [
      'REPOSITORY_IDENTITY_MISMATCH',
      'REPOSITORY_IDENTITY_EVIDENCE_REQUIRED',
      'PROJECT_MAP_REQUIRED',
      'MUTATION_TARGET_NOT_AUTHORITATIVE',
      'UNRESOLVED_DECISION_UNKNOWN',
      'FIRST_CHANGE_TOO_BROAD',
      'FIRST_CHANGE_WRITE_SET_REQUIRED',
      'PARALLEL_WORK_UNCHECKED',
      'PARALLEL_WORK_STRATEGY_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
