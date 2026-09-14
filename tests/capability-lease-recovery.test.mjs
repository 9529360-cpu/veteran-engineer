import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function lease(task, mission, project, key) {
  return {
    id: `lease-${task.id}`,
    reservationId: `reservation-${task.id}`,
    missionId: mission.id,
    projectId: project.id,
    taskId: task.id,
    resources: [{ key, scope: 'project', mode: 'exclusive', identity: `project:${project.id}:${key}` }],
    sensingCapabilities: [],
    executionCapabilities: [],
    executionProfile: null,
    runWorkers: false,
    reservedAt: new Date().toISOString()
  };
}

test('mission resume releases orphan pre-dispatch leases but retains outstanding leases', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'recover capability leases',
      doneDefinition: 'planned orphan released while dispatched work remains isolated',
      tasks: [
        { id: 'A', contract: 'pre-dispatch crash window', owner: 'a', writeSet: ['a'], risk: 'low' },
        { id: 'B', contract: 'outstanding external worker', owner: 'b', writeSet: ['b'], risk: 'low' }
      ]
    });

    await app.store.transaction('test_capability_lease_recovery_seed', (state) => {
      const a = state.tasks[`${planned.mission.id}:A`];
      const b = state.tasks[`${planned.mission.id}:B`];
      a.capabilityLease = lease(a, planned.mission, project, 'database:orphan');
      b.status = 'dispatched';
      b.capabilityLease = lease(b, planned.mission, project, 'database:live');
    }, { missionId: planned.mission.id });

    const resumed = await app.handlers.mission_resume({ missionId: planned.mission.id });
    assert.deepEqual(resumed.capabilityLeaseReconciliation.released.map((item) => item.taskId), ['A']);
    assert.deepEqual(resumed.capabilityLeaseReconciliation.retained.map((item) => item.taskId), ['B']);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const byId = new Map(status.tasks.map((task) => [task.id, task]));
    assert.equal(byId.get('A').status, 'planned');
    assert.equal(byId.get('A').capabilityLease, null);
    assert.equal(byId.get('B').status, 'dispatched');
    assert.ok(byId.get('B').capabilityLease);
  } finally {
    await cleanup(fixture.root);
  }
});
