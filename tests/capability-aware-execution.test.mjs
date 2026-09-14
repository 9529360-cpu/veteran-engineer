import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { CapabilityAwareWorkerOrchestrator } from '../src/capability-aware-worker-orchestrator.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function createConfiguredApp(stateRoot, workerPolicy = {}) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: false,
        maxWorkers: 2,
        capabilities: [],
        ...workerPolicy
      }
    }
  }, null, 2)}\n`);
  return createVeteranApp({ stateRoot });
}

function missionTask(id, overrides = {}) {
  return {
    id,
    contract: `implement ${id}`,
    owner: `owner-${id}`,
    writeSet: [`src/${id.toLowerCase()}`],
    risk: 'low',
    ...overrides
  };
}

test('mission readiness exposes capability sensing without growing the MCP tool surface', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createConfiguredApp(fixture.stateRoot, { capabilities: ['networkless-worker'] });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'sense execution readiness',
      doneDefinition: 'report missing worker capability before execution',
      tasks: [missionTask('A', { executionCapabilities: ['docker'] })]
    });

    const readiness = await app.handlers.mission_readiness({ missionId: planned.mission.id });
    assert.equal(readiness.capabilitySnapshot.contract, 'veteran-capability-snapshot-v1');
    assert.equal(readiness.capabilitySnapshot.wave[0].taskId, 'A');
    assert.equal(readiness.capabilitySnapshot.wave[0].capabilityReady, false);
    assert.deepEqual(readiness.capabilitySnapshot.availableCapabilities.execution, ['networkless-worker']);
  } finally {
    await cleanup(fixture.root);
  }
});

test('mission execution blocks before dispatch when required execution capability is unavailable', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createConfiguredApp(fixture.stateRoot, { capabilities: ['networkless-worker'] });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'exercise execution capability gating',
      doneDefinition: 'dispatch only with required capability',
      tasks: [missionTask('A', { executionCapabilities: ['docker'] })]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    assert.equal(result.reason, 'capability-preflight-blocked');
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].reason, 'capability-missing');
    assert.deepEqual(result.blocked[0].missingExecution, ['docker']);
    assert.equal(result.capabilitySnapshot.wave[0].capabilityReady, false);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'planned');
    assert.equal(status.tasks[0].dispatches.length, 0);
    assert.equal(status.tasks[0].capabilityLease, null);
  } finally {
    await cleanup(fixture.root);
  }
});

test('project-exclusive runtime resource lease blocks a competing mission until the first task finishes', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createConfiguredApp(fixture.stateRoot);
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const resource = [{ key: 'database:integration', scope: 'project', mode: 'exclusive' }];
    const first = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'first mission',
      doneDefinition: 'hold project resource',
      tasks: [missionTask('A', { runtimeResources: resource })]
    });
    const second = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'second mission',
      doneDefinition: 'wait for project resource',
      tasks: [missionTask('B', { runtimeResources: resource })]
    });

    const firstDispatch = await app.services.workerOrchestrator.execute({ missionId: first.mission.id, runWorkers: false });
    assert.equal(firstDispatch.dispatched.length, 1);
    const firstStatus = await app.services.missionService.status({ missionId: first.mission.id });
    assert.ok(firstStatus.tasks[0].capabilityLease);
    assert.equal(firstStatus.tasks[0].capabilityLease.resources[0].identity, `project:${project.id}:database:integration`);

    const blocked = await app.services.workerOrchestrator.execute({ missionId: second.mission.id, runWorkers: false });
    assert.equal(blocked.reason, 'capability-preflight-blocked');
    assert.equal(blocked.blocked[0].reason, 'runtime-resource-conflict');
    assert.equal(blocked.blocked[0].conflicts[0].missionId, first.mission.id);
    assert.equal(blocked.blocked[0].conflicts[0].taskId, 'A');

    await app.services.workerOrchestrator.commitExternalTaskResult({ missionId: first.mission.id, taskId: 'A' });
    const completedFirst = await app.services.missionService.status({ missionId: first.mission.id });
    assert.equal(completedFirst.tasks[0].status, 'done');
    assert.equal(completedFirst.tasks[0].capabilityLease, null);

    const secondDispatch = await app.services.workerOrchestrator.execute({ missionId: second.mission.id, runWorkers: false });
    assert.equal(secondDispatch.dispatched.length, 1);
  } finally {
    await cleanup(fixture.root);
  }
});

test('uncertain execution keeps its runtime resource lease when the delegate throws after start', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createConfiguredApp(fixture.stateRoot, {
      enabled: true,
      worker: { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] }
    });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'retain isolation across uncertain execution outcome',
      doneDefinition: 'lease remains while worker status is executing',
      tasks: [missionTask('A', { runtimeResources: [{ key: 'queue:integration', scope: 'project', mode: 'exclusive' }] })]
    });
    const delegate = {
      execute: async () => {
        await app.store.transaction('test_worker_started', (state) => {
          state.tasks[`${planned.mission.id}:A`].status = 'executing';
        }, { missionId: planned.mission.id });
        throw Object.assign(new Error('simulated acknowledgement loss'), { code: 'SIMULATED_UNKNOWN' });
      }
    };
    const guarded = new CapabilityAwareWorkerOrchestrator({
      delegate,
      store: app.store,
      projectService: app.services.projectService,
      missionService: app.services.missionService
    });

    await assert.rejects(
      guarded.execute({ missionId: planned.mission.id, runWorkers: true }),
      (error) => error.code === 'SIMULATED_UNKNOWN'
    );
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'executing');
    assert.ok(status.tasks[0].capabilityLease);
    assert.equal(status.tasks[0].capabilityLease.resources[0].identity, `project:${project.id}:queue:integration`);
  } finally {
    await cleanup(fixture.root);
  }
});
