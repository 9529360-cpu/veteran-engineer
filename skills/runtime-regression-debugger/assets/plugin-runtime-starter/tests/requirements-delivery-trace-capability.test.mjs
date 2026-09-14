import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gate = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'requirements_delivery_trace_gate.py');

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

function requirementsManifest() {
  return {
    acceptance_criteria: [
      { id: 'AC-1', requirement_id: 'R-1', given: 'valid cart', when: 'checkout', then: 'one order is committed', evidence: 'integration' },
      { id: 'AC-2', requirement_id: 'R-1', given: 'lost response', when: 'request retries', then: 'the same order is returned', evidence: 'regression' }
    ]
  };
}

function deliveryManifest() {
  return {
    schema: 'veteran-delivery-slice-v2',
    change_identity: { change_id: 'PR-42' },
    write_set: { actual: ['src/orders.ts', 'tests/checkout.test.ts', 'docs/runbook.md'] },
    transitions: [{ name: 'create order' }],
    companions: [{ name: 'cache invalidation' }],
    consumers: [{ name: 'payment worker' }]
  };
}

function traceManifest() {
  return {
    schema: 'veteran-requirements-delivery-trace-v1',
    change_id: 'PR-42',
    criteria: [
      {
        criterion_id: 'AC-1',
        status: 'done',
        implementation_owners: ['OrderService'],
        implementation_paths: ['src/orders.ts'],
        validation_evidence: ['integration: checkout -> orders DB'],
        delivery_links: [
          { kind: 'transition', name: 'create order' },
          { kind: 'consumer', name: 'payment worker' }
        ]
      },
      {
        criterion_id: 'AC-2',
        status: 'done',
        implementation_owners: ['OrderService'],
        implementation_paths: ['tests/checkout.test.ts'],
        validation_evidence: ['regression: retry after lost response'],
        delivery_links: [{ kind: 'companion', name: 'cache invalidation' }]
      }
    ],
    shared_paths: [{ path: 'docs/runbook.md', reason: 'operator recovery procedure supports the slice' }],
    shared_delivery_elements: []
  };
}

async function runTrace(t, requirements, delivery, trace) {
  if (!(await exists(gate))) {
    t.skip('source Skill requirements-delivery trace gate is not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-req-delivery-trace-'));
  try {
    const reqPath = path.join(dir, 'requirements.json');
    const deliveryPath = path.join(dir, 'delivery.json');
    const tracePath = path.join(dir, 'trace.json');
    await Promise.all([
      fs.writeFile(reqPath, JSON.stringify(requirements), 'utf8'),
      fs.writeFile(deliveryPath, JSON.stringify(delivery), 'utf8'),
      fs.writeFile(tracePath, JSON.stringify(trace), 'utf8')
    ]);
    const result = runPython(gate, [reqPath, deliveryPath, tracePath, '--json']);
    assert.ok(result, 'python is required by the Skill gate regression');
    return { result, payload: JSON.parse(result.stdout) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('requirements-to-delivery trace gate proves every acceptance criterion reaches implementation and delivery evidence', async (t) => {
  const out = await runTrace(t, requirementsManifest(), deliveryManifest(), traceManifest());
  if (!out) return;
  assert.equal(out.result.status, 0, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.gate_passed, true);
  assert.deepEqual(out.payload.blockers, []);
  assert.equal(out.payload.counts.acceptance_criteria, 2);
  assert.equal(out.payload.counts.traced_criteria, 2);
  assert.equal(out.payload.counts.actual_write_set, 3);
  assert.equal(out.payload.counts.delivery_elements, 3);
});

test('requirements-to-delivery trace gate exposes dropped acceptance, orphan writes, and unowned delivery responsibilities', async (t) => {
  const trace = traceManifest();
  trace.criteria.pop();
  trace.shared_paths = [];
  const out = await runTrace(t, requirementsManifest(), deliveryManifest(), trace);
  if (!out) return;
  assert.notEqual(out.result.status, 0);
  assert.equal(out.payload.gate_passed, false);
  const codes = new Set(out.payload.blockers.map((item) => item.code));
  assert.ok(codes.has('ACCEPTANCE_CRITERION_UNTRACED'));
  assert.ok(codes.has('DELIVERY_PATH_UNTRACED'));
  assert.ok(codes.has('DELIVERY_ELEMENT_UNTRACED'));
});
