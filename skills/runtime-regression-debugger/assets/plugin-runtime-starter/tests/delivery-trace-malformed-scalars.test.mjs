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
const fingerprintFields = ['evidence', 'given', 'id', 'requirement_id', 'then', 'when'];

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deliveryManifest() {
  return {
    schema: 'veteran-delivery-slice-v2',
    completion_stage: 'code-change',
    change_identity: {
      repository: 'acme/shop',
      base_revision: 'abc123',
      head_revision: 'def456',
      change_id: 'PR-42',
      evidence: ['git compare abc123...def456']
    },
    contract: 'checkout creates one durable order',
    visible_completion: 'the committed order identity is visible',
    write_set: {
      expected: ['src/orders.ts'],
      actual: ['src/orders.ts'],
      exceptions: []
    },
    transitions: [{
      name: 'create order',
      owner: 'OrderService',
      status: 'done',
      success_postcondition: 'one order exists',
      error_postcondition: 'no duplicate order is created',
      evidence: ['focused transition regression']
    }],
    companions: [{
      name: 'cache invalidation',
      status: 'done',
      evidence: ['focused cache regression']
    }],
    consumers: [{
      name: 'payment worker',
      status: 'done',
      evidence: ['consumer contract regression']
    }],
    durable_or_external_effects: {
      present: false,
      reason: 'fixture models only the delivery-gate structure'
    },
    validation: {
      exact_identity: 'def456 + fixture-v1',
      focused: { status: 'passed', evidence: ['focused suite'] },
      required_gates: [{
        name: 'repository check',
        status: 'done',
        evidence: ['repository gate']
      }]
    },
    temporary_mechanisms: [{
      name: 'temporary fixture shim',
      status: 'done',
      evidence: ['removal condition verified']
    }]
  };
}

function criterionFingerprint(criterion) {
  const canonical = {};
  for (const key of fingerprintFields) canonical[key] = criterion[key];
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function requirementsManifest() {
  return {
    acceptance_criteria: [{
      id: 'AC-1',
      requirement_id: 'R-1',
      given: 'a valid cart',
      when: 'checkout completes',
      then: 'one order becomes visible',
      evidence: 'integration'
    }]
  };
}

function traceDeliveryManifest() {
  return {
    schema: 'veteran-delivery-slice-v2',
    change_identity: { change_id: 'PR-42' },
    write_set: { actual: ['src/orders.ts'] },
    transitions: [{ name: 'create order' }],
    companions: [{ name: 'cache invalidation' }],
    consumers: [{ name: 'payment worker' }]
  };
}

function traceManifest(requirements) {
  const criterion = requirements.acceptance_criteria[0];
  return {
    schema: 'veteran-requirements-delivery-trace-v2',
    change_id: 'PR-42',
    criteria: [{
      criterion_id: 'AC-1',
      criterion_fingerprint: criterionFingerprint(criterion),
      status: 'done',
      implementation_owners: ['OrderService'],
      implementation_paths: ['src/orders.ts'],
      validation_evidence: ['integration checkout proof'],
      delivery_links: [
        { kind: 'transition', name: 'create order' },
        { kind: 'companion', name: 'cache invalidation' },
        { kind: 'consumer', name: 'payment worker' }
      ]
    }],
    shared_paths: [],
    shared_delivery_elements: []
  };
}

async function runDelivery(t, payload) {
  if (!(await exists(deliveryGate)) || !(await exists(traceGate))) {
    t.skip('source Skill delivery/trace gates are not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-delivery-malformed-'));
  try {
    const target = path.join(dir, 'delivery.json');
    await fs.writeFile(target, JSON.stringify(payload), 'utf8');
    const result = runPython(deliveryGate, [target, '--json']);
    assert.ok(result, 'python is required by the malformed delivery regression');
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function runTrace(t, requirements, delivery, trace) {
  if (!(await exists(deliveryGate)) || !(await exists(traceGate))) {
    t.skip('source Skill delivery/trace gates are not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-trace-malformed-'));
  try {
    const requirementsPath = path.join(dir, 'requirements.json');
    const deliveryPath = path.join(dir, 'delivery.json');
    const tracePath = path.join(dir, 'trace.json');
    await Promise.all([
      fs.writeFile(requirementsPath, JSON.stringify(requirements), 'utf8'),
      fs.writeFile(deliveryPath, JSON.stringify(delivery), 'utf8'),
      fs.writeFile(tracePath, JSON.stringify(trace), 'utf8')
    ]);
    const result = runPython(traceGate, [requirementsPath, deliveryPath, tracePath, '--json']);
    assert.ok(result, 'python is required by the malformed trace regression');
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('delivery and trace malformed-scalar fixtures keep valid controls unchanged', async (t) => {
  const deliveryResult = await runDelivery(t, deliveryManifest());
  if (!deliveryResult) return;
  assert.equal(deliveryResult.status, 0, deliveryResult.stderr || deliveryResult.stdout);
  assert.equal(JSON.parse(deliveryResult.stdout).passed, true);

  const requirements = requirementsManifest();
  const traceResult = await runTrace(t, requirements, traceDeliveryManifest(), traceManifest(requirements));
  assert.equal(traceResult.status, 0, traceResult.stderr || traceResult.stdout);
  assert.equal(JSON.parse(traceResult.stdout).gate_passed, true);
});

test('delivery completion_stage containers become deterministic blockers instead of unhashable tracebacks', async (t) => {
  for (const malformed of [[], { unexpected: 'stage' }]) {
    const payload = deliveryManifest();
    payload.completion_stage = malformed;
    const result = await runDelivery(t, payload);
    if (!result) return;
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Traceback|unhashable/i);
    const output = JSON.parse(result.stdout);
    assert.equal(output.passed, false);
    assert.ok(output.gaps.some((item) => item.includes('completion_stage must be one of')));
  }
});

test('closed-row status containers fail inside delivery gate semantics across every row family', async (t) => {
  const cases = [
    ['transitions', (payload) => payload.transitions[0]],
    ['companions', (payload) => payload.companions[0]],
    ['consumers', (payload) => payload.consumers[0]],
    ['validation.required_gates', (payload) => payload.validation.required_gates[0]],
    ['temporary_mechanisms', (payload) => payload.temporary_mechanisms[0]]
  ];

  for (const [label, select] of cases) {
    for (const malformed of [[], { unexpected: 'status' }]) {
      const payload = deliveryManifest();
      select(payload).status = malformed;
      const result = await runDelivery(t, payload);
      if (!result) return;
      assert.equal(result.status, 1, `${label}: ${result.stderr || result.stdout}`);
      assert.doesNotMatch(result.stderr, /Traceback|unhashable/i);
      const output = JSON.parse(result.stdout);
      assert.equal(output.passed, false);
      assert.ok(
        output.gaps.some((item) => item.startsWith(`${label}[1] is not closed:`)),
        `${label}: expected a structured closed-row blocker`
      );
    }
  }
});

test('trace delivery-link kind containers become TRACE_DELIVERY_LINK_INVALID instead of crashing', async (t) => {
  const requirements = requirementsManifest();
  for (const malformed of [[], { unexpected: 'kind' }]) {
    const trace = traceManifest(requirements);
    trace.criteria[0].delivery_links[0].kind = malformed;
    const result = await runTrace(t, requirements, traceDeliveryManifest(), trace);
    if (!result) return;
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Traceback|unhashable/i);
    const output = JSON.parse(result.stdout);
    assert.equal(output.gate_passed, false);
    assert.ok(output.blockers.some((item) =>
      item.code === 'TRACE_DELIVERY_LINK_INVALID'
      && item.path === 'trace.criteria[0].delivery_links[0]'
    ));
  }
});

test('trace shared-element kind containers become SHARED_ELEMENT_INVALID instead of crashing', async (t) => {
  const requirements = requirementsManifest();
  for (const malformed of [[], { unexpected: 'kind' }]) {
    const trace = traceManifest(requirements);
    trace.shared_delivery_elements = [{
      kind: malformed,
      name: 'create order',
      reason: 'synthetic malformed shared-element fixture'
    }];
    const result = await runTrace(t, requirements, traceDeliveryManifest(), trace);
    if (!result) return;
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Traceback|unhashable/i);
    const output = JSON.parse(result.stdout);
    assert.equal(output.gate_passed, false);
    assert.ok(output.blockers.some((item) =>
      item.code === 'SHARED_ELEMENT_INVALID'
      && item.path === 'trace.shared_delivery_elements[0]'
    ));
  }
});
