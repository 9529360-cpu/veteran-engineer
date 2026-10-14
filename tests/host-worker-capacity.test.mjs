import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectHostWorkerCapacity } from '../src/host-worker-capacity.mjs';
import { missionExecutionCapacity, compileMissionExecutionStrategy } from '../src/adaptive-mission-strategy.mjs';
import { projectPolicy } from '../src/operator-config.mjs';

const GIB = 1024 * 1024 * 1024;

function task(id, risk = 'low') {
  return { id, risk, riskAssessment: { source: 'inferred' }, writeSet: ['src/' + id + '.js'], dependencies: [] };
}

function host(cpu, memorySlots) {
  return {
    contract: 'veteran-host-worker-capacity-v1',
    source: 'test-host',
    effectiveCpuSlots: cpu,
    estimatedMemorySlots: memorySlots,
    cpuParallelism: cpu,
    availableMemoryMiB: memorySlots * 512,
    workerMemoryMiB: 512,
    cgroupBound: false
  };
}

test('resource probe respects real CPU quota and cgroup remaining memory', () => {
  const resources = inspectHostWorkerCapacity({
    cpuParallelism: 48,
    freeMemoryBytes: 64 * GIB,
    totalMemoryBytes: 128 * GIB,
    quotaCores: 20.5,
    cgroup: { limit: 8 * GIB, used: 6 * GIB },
    workerMemoryMiB: 512
  });
  assert.equal(resources.effectiveCpuSlots, 20);
  assert.equal(resources.cgroupBound, true);
  assert.equal(resources.availableMemoryMiB, 2 * 1024);
  assert.ok(resources.estimatedMemorySlots > 0);
  assert.ok(resources.estimatedMemorySlots < 20);
});

test('large independent task wave can auto-plan twenty real worker slots on a capable host', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => task('T' + i));
  const policy = projectPolicy({ defaults: { workerPolicy: { enabled: true } } }, '/repo');
  assert.equal(policy.workerPolicy.maxWorkers, null);
  const resources = host(40, 35);
  const strategy = compileMissionExecutionStrategy({
    tasks, waves: [tasks.map(x => x.id)], project: { workerPolicy: policy.workerPolicy },
    resources
  });
  assert.equal(strategy.executionMode, 'parallel-mission');
  assert.equal(strategy.concurrency.maxConcurrentWorkers, 20);
  const budget = missionExecutionCapacity({
    state: { tasks: {} },
    mission: { id: 'mission', waves: [tasks.map(x => x.id)], executionStrategy: strategy },
    project: { workerPolicy: policy.workerPolicy }, runWorkers: true, resources
  });
  assert.equal(budget.capacity, 20);
  assert.equal(budget.configuredMaxWorkers, 40);
  assert.equal(budget.hostResources.effectiveCpuSlots, 40);
});

test('auto admission scales down with free memory, CPU quota and existing agent occupancy', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => task('T' + i));
  const project = { workerPolicy: { enabled: true, maxWorkers: null } };
  const strategy = compileMissionExecutionStrategy({
    tasks, waves: [tasks.map(x => x.id)], project, resources: host(40, 30)
  });
  const state = { tasks: Object.fromEntries(Array.from({ length: 4 }, (_, i) => ['other:' + i, {
    id: 'T' + i, missionId: 'other', status: 'executing'
  }])) };
  const mission = { id: 'mission', waves: [tasks.map(x => x.id)], executionStrategy: strategy };
  assert.equal(missionExecutionCapacity({
    state, mission, project, runWorkers: true, resources: host(40, 3)
  }).capacity, 3);
  assert.equal(missionExecutionCapacity({
    state, mission, project, runWorkers: true, resources: host(5, 20)
  }).capacity, 1);
  assert.equal(missionExecutionCapacity({
    state, mission, project, runWorkers: true, resources: host(40, 0)
  }).reason, 'host-memory-admission-full');
});

test('explicit operator ceiling is still authoritative even with forty host slots', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => task('T' + i));
  const project = { workerPolicy: { enabled: true, maxWorkers: 3 } };
  const strategy = compileMissionExecutionStrategy({
    tasks, waves: [tasks.map(x => x.id)], project, resources: host(40, 40)
  });
  assert.equal(strategy.concurrency.configuredMaxWorkers, 3);
  const budget = missionExecutionCapacity({
    state: { tasks: {} }, mission: { id: 'm', executionStrategy: strategy }, project, runWorkers: true, resources: host(40, 40)
  });
  assert.equal(budget.capacity, 3);
});

test('high-risk and critical missions avoid unsafe full-team parallelism', () => {
  for (const [risk, expected] of [['high', 2], ['critical', 1]]) {
    const tasks = Array.from({ length: 20 }, (_, i) => task('T' + i, risk));
    const project = { workerPolicy: { enabled: true, maxWorkers: null } };
    const strategy = compileMissionExecutionStrategy({
      tasks, waves: [tasks.map(x => x.id)], project, resources: host(40, 40)
    });
    const budget = missionExecutionCapacity({
      state: { tasks: {} }, mission: { id: 'm', executionStrategy: strategy }, project, runWorkers: true, resources: host(40, 40)
    });
    assert.equal(strategy.concurrency.maxConcurrentWorkers, expected);
    assert.equal(budget.capacity, expected);
  }
});

test('single-task work does not cause unnecessary subagent fan-out', () => {
  const tasks = [task('T1')];
  const project = { workerPolicy: { enabled: true, maxWorkers: null } };
  const strategy = compileMissionExecutionStrategy({ tasks, waves: [['T1']], project, resources: host(40, 40) });
  assert.equal(strategy.executionMode, 'single-worker');
  assert.equal(strategy.concurrency.maxConcurrentWorkers, 1);
});

test('memory per worker may be configured while default worker execution remains disabled', () => {
  const auto = projectPolicy({}, '/repo');
  assert.equal(auto.workerPolicy.enabled, false);
  assert.equal(auto.workerPolicy.maxWorkers, null);
  assert.throws(
    () => projectPolicy({ defaults: { workerPolicy: { memoryMiBPerWorker: 0 } } }, '/repo'),
    (e) => e.code === 'OPERATOR_CONFIG_INVALID'
  );
});
