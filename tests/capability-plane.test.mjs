import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeRuntimeResourceConflicts,
  bindRuntimeResources,
  buildCapabilitySnapshot,
  normalizeTaskCapabilityContract,
  runtimeResourcesConflict,
  taskCapabilityReadiness
} from '../src/capability-plane.mjs';
import { computeWaves } from '../src/mission-service.mjs';

function task(id, overrides = {}) {
  return {
    id,
    contract: `contract ${id}`,
    owner: `owner ${id}`,
    dependencies: [],
    writeSet: [],
    runtimeResources: [],
    sensingCapabilities: [],
    executionCapabilities: [],
    ...overrides
  };
}

test('capability contract normalizes coordination keys into project-exclusive resources', () => {
  const normalized = normalizeTaskCapabilityContract({
    sensingCapabilities: ['browser', 'browser'],
    executionCapabilities: ['docker'],
    coordinationKeys: ['schema'],
    runtimeResources: [{ key: 'port:3000', scope: 'task', mode: 'exclusive' }]
  }, 'T1');
  assert.deepEqual(normalized.sensingCapabilities, ['browser']);
  assert.deepEqual(normalized.executionCapabilities, ['docker']);
  assert.deepEqual(normalized.coordinationKeys, ['schema']);
  assert.deepEqual(normalized.runtimeResources, [
    { key: 'coordination:schema', scope: 'project', mode: 'exclusive' },
    { key: 'port:3000', scope: 'task', mode: 'exclusive' }
  ]);
});

test('resource identities isolate task-scoped resources but serialize project-exclusive resources', () => {
  const taskPort = [{ key: 'port:3000', scope: 'task', mode: 'exclusive' }];
  assert.equal(runtimeResourcesConflict(taskPort, taskPort, { projectId: 'p', missionId: 'm', taskId: 'a' }, { projectId: 'p', missionId: 'm', taskId: 'b' }), false);

  const schema = [{ key: 'coordination:schema', scope: 'project', mode: 'exclusive' }];
  assert.equal(runtimeResourcesConflict(schema, schema, { projectId: 'p', missionId: 'm1', taskId: 'a' }, { projectId: 'p', missionId: 'm2', taskId: 'b' }), true);
  assert.equal(runtimeResourcesConflict(schema, schema, { projectId: 'p1', missionId: 'm1', taskId: 'a' }, { projectId: 'p2', missionId: 'm2', taskId: 'b' }), false);
});

test('mission waves account for runtime-resource conflicts in addition to file write conflicts', () => {
  const shared = [{ key: 'database:integration', scope: 'project', mode: 'exclusive' }];
  const tasks = [
    task('A', { writeSet: ['src/a'], runtimeResources: shared }),
    task('B', { writeSet: ['src/b'], runtimeResources: shared }),
    task('C', { writeSet: ['src/c'], runtimeResources: [{ key: 'browser-profile', scope: 'task', mode: 'exclusive' }] })
  ];
  assert.deepEqual(computeWaves(tasks), [['A', 'C'], ['B']]);
});

test('capability readiness distinguishes sensing from execution requirements', () => {
  const project = {
    validationCapabilities: ['browser'],
    runtimeFeedbackCapabilities: ['observability'],
    workerPolicy: { capabilities: ['docker', 'networkless-worker'] }
  };
  assert.deepEqual(taskCapabilityReadiness(task('A', {
    sensingCapabilities: ['source-identity', 'browser', 'observability'],
    executionCapabilities: ['docker']
  }), project), {
    ready: true,
    missingSensing: [],
    missingExecution: [],
    available: {
      sensing: ['browser', 'mission-state', 'observability', 'source-identity', 'task-state'],
      execution: ['docker', 'networkless-worker']
    }
  });
  const missing = taskCapabilityReadiness(task('B', { executionCapabilities: ['gpu'] }), project);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingExecution, ['gpu']);
});

test('active lease conflicts are reported across missions sharing project resources', () => {
  const project = { id: 'p' };
  const mission = { id: 'm2' };
  const candidate = task('B', { runtimeResources: [{ key: 'database:test', scope: 'project', mode: 'exclusive' }] });
  const state = {
    tasks: {
      'm1:A': {
        id: 'A', missionId: 'm1', status: 'executing',
        capabilityLease: {
          resources: bindRuntimeResources([{ key: 'database:test', scope: 'project', mode: 'exclusive' }], { projectId: 'p', missionId: 'm1', taskId: 'A' })
        }
      }
    }
  };
  const conflicts = activeRuntimeResourceConflicts({ state, task: candidate, mission, project });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].missionId, 'm1');
  assert.equal(conflicts[0].taskId, 'A');
});

test('capability snapshot binds source freshness, wave requirements, and active leases', () => {
  const project = { id: 'p', validationCapabilities: ['browser'], runtimeFeedbackCapabilities: [], workerPolicy: { capabilities: ['docker'] } };
  const mission = {
    id: 'm', phase: 'execution', status: 'ready', nextWaveIndex: 0, waves: [['A']],
    runtimeFeedback: { latestRound: { commitSha: 'old', scope: 'checkpoint', passed: false, aggregateEvidenceId: 'e1' } }
  };
  const tasks = [task('A', { sensingCapabilities: ['browser'], executionCapabilities: ['docker'] })];
  const snapshot = buildCapabilitySnapshot({ project, mission, tasks, liveSourceIdentity: { head: 'new', dirty: false }, state: { tasks: {} } });
  assert.equal(snapshot.contract, 'veteran-capability-snapshot-v1');
  assert.equal(snapshot.wave[0].capabilityReady, true);
  assert.equal(snapshot.runtimeFeedback.sourceBoundToLiveHead, false);
});
