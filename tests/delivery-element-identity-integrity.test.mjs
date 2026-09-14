import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scripts = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts');
const deliveryGate = path.join(scripts, 'delivery_slice_gate.py');
const traceGate = path.join(scripts, 'requirements_delivery_trace_gate.py');
const criterionFingerprintFields = ['evidence', 'given', 'id', 'requirement_id', 'then', 'when'];

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

function criterionFingerprint(criterion) {
  const canonical = {};
  for (const key of criterionFingerprintFields) canonical[key] = criterion[key];
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function requirementsManifest() {
  return {
    acceptance_criteria: [
      { id: 'AC-1', requirement_id: 'R-1', given: 'valid cart', when: 'checkout', then: 'one order is committed', evidence: 'integration' },
      { id: 'AC-2', requirement_id: 'R-1', given: 'committed order', when: 'projection refreshes', then: 'the order is visible to downstream work', evidence: 'integration' }
    ]
  };
}

function deliveryManifest() {
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
    contract: 'buyer submits one order and downstream work observes the durable result',
    visible_completion: 'confirmation displays the same durable order identity consumed downstream',
    write_set: {
      expected: ['src/orders.ts', 'tests/checkout.test.ts'],
      actual: ['src/orders.ts', 'tests/checkout.test.ts'],
      exceptions: []
    },
    transitions: [{
      name: 'create order',
      owner: 'OrderService',
      status: 'done',
      success_postcondition: 'one durable order is committed',
      error_postcondition: 'duplicate request returns the existing order identity',
      evidence: ['integration: checkout -> orders DB']
    }],
    companions: [{
      name: 'cache invalidation',
      applicable: true,
      status: 'done',
      evidence: ['integration: read-after-write']
    }],
    consumers: [{
      name: 'payment worker',
      applicable: true,
      status: 'done',
      evidence: ['contract: payment worker consumes order-created']
    }],
    durable_or_external_effects: {
      present: true,
      replay_semantics: 'request id deduplicates logical order creation',
      rollback_or_forward_repair: 'reconciliation moves uncertain state forward',
      terminal_or_reconciliation_state: 'confirmed or reconciliation-required',
      evidence: ['regression: duplicate checkout request']
    },
    validation: {
      exact_identity: 'head def456 + fixture orders-v3',
      focused: { status: 'passed', evidence: ['unit: idempotency key'] },
      integration: { status: 'passed', evidence: ['integration: API -> DB -> outbox'] },
      visible_boundary: { status: 'passed', evidence: ['browser: checkout confirmation'] },
      required_gates: [{ name: 'repository check', status: 'done', evidence: ['ci: repository tests'] }]
    },
    integration_readiness: {
      base_fresh: true,
      parallel_conflicts_checked: true,
      evidence: ['live main and open PR write sets refreshed']
    },
    temporary_mechanisms: []
  };
}

function traceManifest(requirements, delivery) {
  const criteria = new Map(requirements.acceptance_criteria.map((criterion) => [criterion.id, criterion]));
  return {
    schema: 'veteran-requirements-delivery-trace-v2',
    change_id: delivery.change_identity.change_id,
    criteria: [
      {
        criterion_id: 'AC-1',
        criterion_fingerprint: criterionFingerprint(criteria.get('AC-1')),
        status: 'done',
        implementation_owners: ['OrderService'],
        implementation_paths: ['src/orders.ts'],
        validation_evidence: ['integration: checkout -> orders DB'],
        delivery_links: [
          { kind: 'transition', name: delivery.transitions[0].name },
          { kind: 'consumer', name: delivery.consumers[0].name }
        ]
      },
      {
        criterion_id: 'AC-2',
        criterion_fingerprint: criterionFingerprint(criteria.get('AC-2')),
        status: 'done',
        implementation_owners: ['OrderProjection'],
        implementation_paths: ['tests/checkout.test.ts'],
        validation_evidence: ['integration: visible projection'],
        delivery_links: [{ kind: 'companion', name: delivery.companions[0].name }]
      }
    ],
    shared_paths: [],
    shared_delivery_elements: []
  };
}

async function runDelivery(t, delivery) {
  if (!(await exists(deliveryGate)) || !(await exists(traceGate))) {
    t.skip('source Skill delivery/trace gates are not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-delivery-identity-'));
  try {
    const deliveryPath = path.join(dir, 'delivery.json');
    await fs.writeFile(deliveryPath, JSON.stringify(delivery), 'utf8');
    const result = runPython(deliveryGate, [deliveryPath, '--json']);
    assert.ok(result, 'python is required by the delivery identity regression');
    return { result, payload: JSON.parse(result.stdout) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function runTrace(t, requirements, delivery, trace) {
  if (!(await exists(deliveryGate)) || !(await exists(traceGate))) {
    t.skip('source Skill delivery/trace gates are not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-trace-identity-'));
  try {
    const reqPath = path.join(dir, 'requirements.json');
    const deliveryPath = path.join(dir, 'delivery.json');
    const tracePath = path.join(dir, 'trace.json');
    await Promise.all([
      fs.writeFile(reqPath, JSON.stringify(requirements), 'utf8'),
      fs.writeFile(deliveryPath, JSON.stringify(delivery), 'utf8'),
      fs.writeFile(tracePath, JSON.stringify(trace), 'utf8')
    ]);
    const result = runPython(traceGate, [reqPath, deliveryPath, tracePath, '--json']);
    assert.ok(result, 'python is required by the delivery identity regression');
    return { result, payload: JSON.parse(result.stdout) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('delivery and requirements trace gates accept unique delivery element identities', async (t) => {
  const requirements = requirementsManifest();
  const delivery = deliveryManifest();
  const deliveryOut = await runDelivery(t, delivery);
  if (!deliveryOut) return;
  assert.equal(deliveryOut.result.status, 0, deliveryOut.result.stderr || deliveryOut.result.stdout);
  assert.equal(deliveryOut.payload.passed, true);

  const traceOut = await runTrace(t, requirements, delivery, traceManifest(requirements, delivery));
  assert.equal(traceOut.result.status, 0, traceOut.result.stderr || traceOut.result.stdout);
  assert.equal(traceOut.payload.gate_passed, true);
  assert.equal(traceOut.payload.counts.delivery_elements, 3);
});

test('the same delivery element name remains valid across different kinds', async (t) => {
  const requirements = requirementsManifest();
  const delivery = deliveryManifest();
  delivery.transitions[0].name = 'shared lifecycle step';
  delivery.companions[0].name = 'shared lifecycle step';
  delivery.consumers[0].name = 'shared lifecycle step';

  const deliveryOut = await runDelivery(t, delivery);
  if (!deliveryOut) return;
  assert.equal(deliveryOut.result.status, 0, deliveryOut.result.stderr || deliveryOut.result.stdout);
  assert.equal(deliveryOut.payload.passed, true);

  const traceOut = await runTrace(t, requirements, delivery, traceManifest(requirements, delivery));
  assert.equal(traceOut.result.status, 0, traceOut.result.stderr || traceOut.result.stdout);
  assert.equal(traceOut.payload.gate_passed, true);
  assert.equal(traceOut.payload.counts.delivery_elements, 3);
});

test('duplicate delivery element names fail closed within every trace-linked kind', async (t) => {
  const cases = [
    ['transition', 'transitions'],
    ['companion', 'companions'],
    ['consumer', 'consumers']
  ];

  for (const [kind, key] of cases) {
    const requirements = requirementsManifest();
    const delivery = deliveryManifest();
    delivery[key].push({ ...delivery[key][0] });

    const deliveryOut = await runDelivery(t, delivery);
    if (!deliveryOut) return;
    assert.equal(deliveryOut.result.status, 1, `${kind}: ${deliveryOut.result.stderr || deliveryOut.result.stdout}`);
    assert.equal(deliveryOut.payload.passed, false);
    assert.ok(
      deliveryOut.payload.gaps.some((item) => item.includes(`names must be unique within ${key}`)),
      `${kind}: expected duplicate-name delivery gap`
    );

    const traceOut = await runTrace(t, requirements, delivery, traceManifest(requirements, delivery));
    assert.equal(traceOut.result.status, 1, `${kind}: ${traceOut.result.stderr || traceOut.result.stdout}`);
    assert.equal(traceOut.payload.gate_passed, false);
    assert.ok(
      traceOut.payload.blockers.some((item) =>
        item.code === 'DELIVERY_ELEMENT_DUPLICATE'
        && item.path === `delivery.${key}[1].name`
        && item.message.includes(`duplicate delivery ${kind}`)
      ),
      `${kind}: expected duplicate trace identity blocker`
    );
  }
});
