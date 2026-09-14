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

function validationCapability(name) {
  return { name, command: ['node', '--version'] };
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

test('capability contract rejects coercible identities and explicit malformed resource metadata', () => {
  for (const value of [42, true, {}, ['nested']]) {
    assert.throws(() => normalizeTaskCapabilityContract({ sensingCapabilities: [value] }, 'T1'), /must be a string/);
    assert.throws(() => normalizeTaskCapabilityContract({ executionCapabilities: [value] }, 'T1'), /must be a string/);
    assert.throws(() => normalizeTaskCapabilityContract({ coordinationKeys: [value] }, 'T1'), /must be a string/);
  }
  assert.throws(() => normalizeTaskCapabilityContract({ runtimeResources: [{ key: 42 }] }, 'T1'), /must be a string/);
  assert.throws(() => normalizeTaskCapabilityContract({ runtimeResources: [{ key: 'db', scope: 42 }] }, 'T1'), /must be a string/);
  assert.throws(() => normalizeTaskCapabilityContract({ runtimeResources: [{ key: 'db', mode: false }] }, 'T1'), /must be a string/);
  assert.throws(() => normalizeTaskCapabilityContract({ runtimeResources: [{ key: 'db', scope: '' }] }, 'T1'), /non-empty string/);
  assert.throws(() => normalizeTaskCapabilityContract({ runtimeResources: [{ key: 'db', mode: '' }] }, 'T1'), /non-empty string/);
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

test('capability readiness derives sensing names from validation catalog objects and separates execution requirements', () => {
  const project = {
    validationCapabilities: [validationCapability('browser')],
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

test('capability snapshot binds source freshness, catalog-derived sensing, wave requirements, and active leases', () => {
  const project = { id: 'p', validationCapabilities: [validationCapability('browser')], runtimeFeedbackCapabilities: [], workerPolicy: { capabilities: ['docker'] } };
  const mission = {
    id: 'm', phase: 'execution', status: 'ready', nextWaveIndex: 0, waves: [['A']],
    runtimeFeedback: { latestRound: { commitSha: 'old', scope: 'checkpoint', passed: false, aggregateEvidenceId: 'e1' } }
  };
  const tasks = [task('A', { sensingCapabilities: ['browser'], executionCapabilities: ['docker'] })];
  const snapshot = buildCapabilitySnapshot({ project, mission, tasks, liveSourceIdentity: { head: 'new', dirty: false }, state: { tasks: {} } });
  assert.equal(snapshot.contract, 'veteran-capability-snapshot-v1');
  assert.deepEqual(snapshot.availableCapabilities.sensing, ['browser', 'mission-state', 'source-identity', 'task-state']);
  assert.equal(snapshot.wave[0].capabilityReady, true);
  assert.equal(snapshot.runtimeFeedback.sourceBoundToLiveHead, false);
});

test('capability snapshot exposes only resource claims visible to the current mission and project', () => {
  const project = { id: 'p1', validationCapabilities: [], runtimeFeedbackCapabilities: [], workerPolicy: { capabilities: [] } };
  const mission = { id: 'm1', phase: 'execution', status: 'ready', nextWaveIndex: 0, waves: [['A']] };
  const tasks = [task('A')];
  const leaseTask = (id, missionId, resources, context) => ({
    id,
    missionId,
    status: 'executing',
    capabilityLease: {
      id: `lease-${id}`,
      resources: bindRuntimeResources(resources, context)
    }
  });
  const state = {
    tasks: {
      own: leaseTask('OWN', 'm1', [
        { key: 'port', scope: 'task', mode: 'exclusive' },
        { key: 'own-profile', scope: 'mission', mode: 'exclusive' }
      ], { projectId: 'p1', missionId: 'm1', taskId: 'OWN' }),
      sameProject: leaseTask('PROJECT', 'm2', [
        { key: 'database', scope: 'project', mode: 'exclusive' },
        { key: 'foreign-profile', scope: 'mission', mode: 'exclusive' },
        { key: 'foreign-port', scope: 'task', mode: 'exclusive' }
      ], { projectId: 'p1', missionId: 'm2', taskId: 'PROJECT' }),
      sameProjectPrivate: leaseTask('MISSION', 'm2', [
        { key: 'profile-only', scope: 'mission', mode: 'exclusive' }
      ], { projectId: 'p1', missionId: 'm2', taskId: 'MISSION' }),
      foreignProject: leaseTask('FOREIGN', 'm3', [
        { key: 'database', scope: 'project', mode: 'exclusive' }
      ], { projectId: 'p2', missionId: 'm3', taskId: 'FOREIGN' }),
      global: leaseTask('GLOBAL', 'm4', [
        { key: 'release-lane', scope: 'global', mode: 'exclusive' },
        { key: 'other-project-db', scope: 'project', mode: 'exclusive' },
        { key: 'other-private', scope: 'mission', mode: 'exclusive' }
      ], { projectId: 'p2', missionId: 'm4', taskId: 'GLOBAL' })
    }
  };
  const snapshot = buildCapabilitySnapshot({ project, mission, tasks, liveSourceIdentity: { head: 'h', dirty: false }, state });
  const byTask = new Map(snapshot.activeLeases.map((lease) => [lease.taskId, lease]));
  assert.deepEqual([...byTask.keys()].sort(), ['GLOBAL', 'OWN', 'PROJECT']);
  assert.deepEqual(byTask.get('OWN').resources.map((resource) => resource.identity).sort(), [
    'mission:p1:m1:own-profile',
    'task:p1:m1:OWN:port'
  ]);
  assert.deepEqual(byTask.get('PROJECT').resources.map((resource) => resource.identity), [
    'project:p1:database'
  ]);
  assert.deepEqual(byTask.get('GLOBAL').resources.map((resource) => resource.identity), [
    'global:release-lane'
  ]);
});
