import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function appWithWorker(stateRoot, workerPolicy) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { workerPolicy } }, null, 2)}\n`);
  return createVeteranApp({ stateRoot });
}

test('runtime-managed execution rejects spoofed structural capability before spawning worker', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await appWithWorker(fixture.stateRoot, {
      enabled: true,
      maxWorkers: 1,
      capabilities: ['network-isolated'],
      worker: { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] }
    });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'require real isolation proof',
      doneDefinition: 'do not run an unqualified worker',
      tasks: [{
        id: 'A',
        contract: 'bounded task',
        owner: 'src',
        writeSet: ['src'],
        risk: 'low',
        executionCapabilities: ['network-isolated']
      }]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.reason, 'capability-preflight-blocked');
    assert.deepEqual(result.blocked[0].missingExecution, ['network-isolated']);
    assert.deepEqual(result.blocked[0].executionBlockers, []);
    assert.equal(result.blocked[0].runtimeManagedExecution.workerType, 'custom');
    assert.equal(result.blocked[0].runtimeManagedExecution.policyValid, true);
    assert.ok(!result.blocked[0].runtimeManagedExecution.derivedCapabilities.includes('network-isolated'));

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'planned');
    assert.equal(status.tasks[0].attempts, 0);
    assert.equal(status.tasks[0].dispatches.length, 0);
  } finally {
    await cleanup(fixture.root);
  }
});
