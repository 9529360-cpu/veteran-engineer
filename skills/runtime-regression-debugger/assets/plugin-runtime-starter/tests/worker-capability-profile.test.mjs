import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeManagedExecutionReadiness, workerCapabilityProfile } from '../src/worker-capability-profile.mjs';

function task(overrides = {}) {
  return { id: 'A', worker: 'default', risk: 'low', writeSet: ['src/a'], executionCapabilities: [], ...overrides };
}

function project(workerPolicy) {
  return { workerPolicy };
}

test('operator declarations cannot spoof structural worker isolation capabilities', () => {
  const p = project({
    enabled: true,
    capabilities: ['network-isolated', 'read-only-rootfs'],
    worker: { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] }
  });
  const readiness = runtimeManagedExecutionReadiness(task({ executionCapabilities: ['network-isolated'] }), p);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missingExecution, ['network-isolated']);
  assert.equal(readiness.profile.policyValid, true);
  assert.deepEqual(readiness.profile.derivedCapabilities, ['local-worker', 'worker-execution', 'worker-type:custom']);
});

test('valid container worker proves its structural execution capabilities from config', () => {
  const digest = 'a'.repeat(64);
  const p = project({
    enabled: true,
    capabilities: [],
    worker: {
      type: 'container',
      engine: 'docker',
      image: `example.invalid/worker@sha256:${digest}`,
      containerCommand: ['node', '/worker.mjs']
    }
  });
  const required = ['worker-execution', 'worker-type:container', 'container-worker', 'container-engine:docker', 'network-isolated', 'read-only-rootfs'];
  const readiness = runtimeManagedExecutionReadiness(task({ executionCapabilities: required }), p);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missingExecution, []);
  assert.equal(readiness.profile.policyValid, true);
  for (const capability of required) assert.ok(readiness.profile.derivedCapabilities.includes(capability));
});

test('invalid or disallowed worker policy cannot produce derived execution proof', () => {
  const p = project({
    enabled: true,
    allowUnconfinedCustomWorkers: false,
    capabilities: ['worker-execution'],
    worker: { type: 'custom-unconfined', command: process.execPath }
  });
  const profile = workerCapabilityProfile(p, task());
  assert.equal(profile.configured, true);
  assert.equal(profile.policyValid, false);
  assert.equal(profile.configError.code, 'UNCONFINED_WORKER_NOT_ALLOWED');
  assert.deepEqual(profile.derivedCapabilities, []);

  const readiness = runtimeManagedExecutionReadiness(task({ executionCapabilities: ['worker-execution'] }), p);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.includes('UNCONFINED_WORKER_NOT_ALLOWED'));
  assert.deepEqual(readiness.missingExecution, ['worker-execution']);
});
