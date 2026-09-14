import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gate = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'delivery_slice_gate.py');

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

function mergeReadyManifest() {
  return {
    schema: 'veteran-delivery-slice-v2',
    completion_stage: 'merge-ready',
    change_identity: {
      repository: 'acme/shop',
      base_revision: 'abc123',
      head_revision: 'def456',
      change_id: 'PR-42',
      evidence: ['git compare abc123...def456']
    },
    contract: 'buyer submits one order and receives durable confirmation',
    visible_completion: 'confirmation displays the durable order id',
    write_set: {
      expected: ['src/orders/OrderService.ts', 'tests/checkout.test.ts'],
      actual: ['src/orders/OrderService.ts', 'tests/checkout.test.ts'],
      exceptions: []
    },
    transitions: [
      {
        name: 'create order',
        owner: 'OrderService',
        status: 'done',
        success_postcondition: 'one durable order is committed',
        error_postcondition: 'duplicate request returns the existing order identity',
        evidence: ['integration: checkout -> orders DB']
      }
    ],
    companions: [
      { name: 'cache invalidation', applicable: true, status: 'done', evidence: ['integration: read-after-write'] }
    ],
    consumers: [
      { name: 'payment worker', applicable: true, status: 'done', evidence: ['contract: payment worker consumes order-created'] }
    ],
    durable_or_external_effects: {
      present: true,
      replay_semantics: 'request id deduplicates logical order creation',
      rollback_or_forward_repair: 'reconciliation moves uncertain payment state forward',
      terminal_or_reconciliation_state: 'confirmed or reconciliation-required',
      evidence: ['regression: duplicate checkout request']
    },
    validation: {
      exact_identity: 'head def456 + fixture orders-v3',
      focused: { status: 'passed', evidence: ['unit: idempotency key'] },
      integration: { status: 'passed', evidence: ['integration: API -> DB -> outbox'] },
      visible_boundary: { status: 'passed', evidence: ['browser: checkout confirmation'] },
      required_gates: [
        { name: 'typecheck', status: 'done', evidence: ['ci: typecheck'] },
        { name: 'test suite', status: 'done', evidence: ['ci: repository tests'] }
      ]
    },
    integration_readiness: {
      base_fresh: true,
      parallel_conflicts_checked: true,
      evidence: ['live main and open PR write sets refreshed']
    },
    temporary_mechanisms: []
  };
}

async function runManifest(t, manifest) {
  if (!(await exists(gate))) {
    t.skip('source Skill delivery gate is not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-delivery-claim-'));
  try {
    const file = path.join(dir, 'delivery.json');
    await fs.writeFile(file, JSON.stringify(manifest), 'utf8');
    const result = runPython(gate, [file, '--json']);
    assert.ok(result, 'python is required by the Skill gate regression');
    return { result, payload: result.stdout ? JSON.parse(result.stdout) : null };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('delivery slice gate accepts an evidence-backed merge-ready vertical slice', async (t) => {
  const out = await runManifest(t, mergeReadyManifest());
  if (!out) return;
  assert.equal(out.result.status, 0, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.passed, true);
  assert.equal(out.payload.completion_stage, 'merge-ready');
  assert.equal(out.payload.transition_count, 1);
  assert.equal(out.payload.companion_count, 1);
  assert.equal(out.payload.consumer_count, 1);
  assert.deepEqual(out.payload.gaps, []);
});

test('delivery slice gate rejects weak or overstated completion claims and accepts complete production proof', async (t) => {
  const legacy = {
    contract: 'legacy weak record',
    transitions: [{ name: 'API', owner: 'Service', status: 'done', success_postcondition: 'ok', error_postcondition: 'error', evidence: ['unit'] }],
    companions: []
  };
  const legacyOut = await runManifest(t, legacy);
  if (!legacyOut) return;
  assert.notEqual(legacyOut.result.status, 0);
  assert.ok(legacyOut.payload.gaps.some((item) => item.includes("schema must be 'veteran-delivery-slice-v2'")));

  const overstated = mergeReadyManifest();
  overstated.completion_stage = 'production-verified';
  overstated.write_set.actual.push('src/surprise.ts');
  const overstatedOut = await runManifest(t, overstated);
  assert.notEqual(overstatedOut.result.status, 0);
  assert.ok(overstatedOut.payload.gaps.some((item) => item.includes("write_set drift for 'src/surprise.ts'")));
  assert.ok(overstatedOut.payload.gaps.includes('release_candidate must be an object for release-candidate or later claims'));
  assert.ok(overstatedOut.payload.gaps.includes('deployment must be an object for deployed or later claims'));
  assert.ok(overstatedOut.payload.gaps.includes('production_verification must be an object for production-verified claims'));

  const proven = mergeReadyManifest();
  proven.completion_stage = 'production-verified';
  proven.release_candidate = {
    artifact_identity: 'image sha256:0123456789abcdef',
    evidence: ['artifact manifest signed for def456']
  };
  proven.deployment = {
    environment: 'production',
    release_identity: 'image sha256:0123456789abcdef',
    rollout: '10% -> 50% -> 100% with checkout guardrails',
    rollback_or_forward_repair: 'rollback image before schema contraction; reconcile uncertain payments forward',
    evidence: ['deployment controller reports exact image at 100%']
  };
  proven.production_verification = {
    release_identity: 'image sha256:0123456789abcdef',
    observed_at: '2026-09-14T04:00:00Z',
    user_visible_result: 'real checkout returns one confirmed order and confirmation renders the same id',
    evidence: ['production synthetic + correlated order trace']
  };
  const provenOut = await runManifest(t, proven);
  assert.equal(provenOut.result.status, 0, provenOut.result.stderr || provenOut.result.stdout);
  assert.equal(provenOut.payload.passed, true);
  assert.equal(provenOut.payload.completion_stage, 'production-verified');
});
