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

test('capability snapshot distinguishes dispatch-only declarations from runtime-managed structural proof', async () => {
  const fixture = await createGitRepo();
  try {
    const digest = 'a'.repeat(64);
    const app = await appWithWorker(fixture.stateRoot, {
      enabled: true,
      maxWorkers: 1,
      capabilities: [],
      worker: {
        type: 'container',
        engine: 'docker',
        image: `example.invalid/worker@sha256:${digest}`,
        containerCommand: ['node', '/worker.mjs']
      }
    });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'report execution truth by mode',
      doneDefinition: 'runtime-managed readiness reflects structural worker proof',
      tasks: [{
        id: 'A',
        contract: 'bounded task',
        owner: 'src',
        writeSet: ['src'],
        risk: 'low',
        executionCapabilities: ['container-worker', 'network-isolated', 'read-only-rootfs']
      }]
    });

    const readiness = await app.handlers.mission_readiness({ missionId: planned.mission.id });
    const wave = readiness.capabilitySnapshot.wave[0];
    assert.equal(wave.capabilityReady, false);
    assert.equal(wave.dispatchOnlyCapabilityReady, false);
    assert.equal(wave.runtimeManagedCapabilityReady, true);
    assert.deepEqual(wave.runtimeManagedMissingSensing, []);
    assert.deepEqual(wave.runtimeManagedMissingExecution, []);
    assert.deepEqual(wave.runtimeManagedExecutionBlockers, []);
    assert.equal(wave.runtimeManagedExecution.workerType, 'container');
    assert.equal(wave.runtimeManagedExecution.policyValid, true);
    for (const capability of ['container-worker', 'network-isolated', 'read-only-rootfs']) {
      assert.ok(wave.runtimeManagedExecution.derivedCapabilities.includes(capability));
    }
  } finally {
    await cleanup(fixture.root);
  }
});
