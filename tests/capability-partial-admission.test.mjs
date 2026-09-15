import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function configuredApp(stateRoot, workerPolicy = {}) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: false,
        maxWorkers: 3,
        capabilities: [],
        ...workerPolicy
      }
    }
  }, null, 2)}\n`);
  return createVeteranApp({ stateRoot });
}

function task(id, overrides = {}) {
  return {
    id,
    contract: `implement ${id}`,
    owner: `owner-${id}`,
    dependencies: [],
    writeSet: [`src/${id.toLowerCase()}.txt`],
    risk: 'low',
    ...overrides
  };
}

test('one capability-blocked task does not stall safe ready siblings', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n', 'src/c.txt': 'c\n' } });
  try {
    const app = await configuredApp(fixture.stateRoot);
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'keep safe work moving around a local capability blocker',
      doneDefinition: 'ready siblings dispatch while the blocked task remains planned',
      tasks: [
        task('A', { executionCapabilities: ['docker'] }),
        task('B'),
        task('C')
      ]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    assert.deepEqual(result.dispatched.map((item) => item.taskId), ['B', 'C']);
    assert.deepEqual(result.capabilityBlocked.map((item) => item.taskId), ['A']);
    assert.equal(result.capabilityBlocked[0].reason, 'capability-missing');
    assert.deepEqual(result.capabilityBlocked[0].missingExecution, ['docker']);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const byId = new Map(status.tasks.map((item) => [item.id, item]));
    assert.equal(byId.get('A').status, 'planned');
    assert.equal(byId.get('A').dispatches.length, 0);
    assert.equal(byId.get('A').capabilityLease, null);
    assert.equal(byId.get('B').status, 'dispatched');
    assert.equal(byId.get('C').status, 'dispatched');
    assert.ok(byId.get('B').capabilityLease);
    assert.ok(byId.get('C').capabilityLease);
  } finally {
    await cleanup(fixture.root);
  }
});

test('same-admission resource conflict defers only the conflicting sibling and fills capacity from later work', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n', 'src/c.txt': 'c\n' } });
  try {
    const app = await configuredApp(fixture.stateRoot);
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const exclusive = [{ key: 'database:integration', scope: 'project', mode: 'exclusive' }];
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'fill safe capacity around a same-wave resource conflict',
      doneDefinition: 'independent later work is not idled by one conflicting sibling',
      tasks: [
        task('A', { runtimeResources: exclusive }),
        task('B', { runtimeResources: exclusive }),
        task('C')
      ]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    assert.deepEqual(result.dispatched.map((item) => item.taskId), ['A', 'C']);
    assert.deepEqual(result.capabilityBlocked.map((item) => item.taskId), ['B']);
    assert.equal(result.capabilityBlocked[0].reason, 'same-admission-resource-conflict');

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const byId = new Map(status.tasks.map((item) => [item.id, item]));
    assert.equal(byId.get('B').status, 'planned');
    assert.equal(byId.get('B').capabilityLease, null);
    assert.equal(byId.get('A').status, 'dispatched');
    assert.equal(byId.get('C').status, 'dispatched');
  } finally {
    await cleanup(fixture.root);
  }
});
