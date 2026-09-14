import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { ProjectService } from '../src/project-service.mjs';
import { MissionService } from '../src/mission-service.mjs';
import { EvidenceService } from '../src/evidence-service.mjs';
import { WorktreeManager } from '../src/worktree-manager.mjs';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { WorkerOrchestrator } from '../src/worker-orchestrator.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function buildRuntime(fixture, workerConfig) {
  const store = await new StateStore({ root: fixture.stateRoot }).init();
  const projectService = new ProjectService({
    store,
    operatorConfig: {
      defaults: {
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          defaultWorker: 'test-worker',
          workers: { 'test-worker': workerConfig }
        }
      },
      projects: {}
    }
  });
  const missionService = new MissionService({ store, projectService });
  const evidenceService = new EvidenceService({ store });
  const worktreeManager = new WorktreeManager({ store });
  const workerAdapter = new WorkerAdapter();
  const orchestrator = new WorkerOrchestrator({ store, projectService, missionService, worktreeManager, workerAdapter, evidenceService });
  const project = await projectService.open({ repoPath: fixture.repo });
  return { store, missionService, workerAdapter, orchestrator, project };
}

async function planSingleTask(rt, id) {
  return rt.missionService.plan({
    projectId: rt.project.id,
    goal: `exercise ${id}`,
    doneDefinition: `${id} reaches a truthful terminal state`,
    tasks: [{
      id,
      contract: `run ${id}`,
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low',
      worker: 'test-worker'
    }]
  });
}

test('operator cancellation lands as cancelled with dedicated evidence and remains retryable', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const marker = path.join(fixture.root, 'cancel-ready.txt');
  const worker = path.join(fixture.root, 'cancel-worker.mjs');
  try {
    await fs.writeFile(worker, [
      "import fs from 'node:fs/promises';",
      `await fs.writeFile(${JSON.stringify(marker)}, 'ready\\n');`,
      'setInterval(() => {}, 1000);'
    ].join('\n'));
    const rt = await buildRuntime(fixture, { type: 'custom', command: process.execPath, args: [worker], timeoutMs: 10_000 });
    const planned = await planSingleTask(rt, 'CANCEL');
    const missionId = planned.mission.id;
    const execution = rt.orchestrator.execute({ missionId, runWorkers: true });
    await waitForFile(marker);

    const active = rt.workerAdapter.snapshot();
    assert.equal(active.length, 1);
    assert.equal(active[0].taskKey, `${missionId}:CANCEL`);
    assert.equal(active[0].termination, null);

    const requested = await rt.orchestrator.cancelWorker({ missionId, taskId: 'CANCEL' });
    assert.equal(requested.signalled, true);
    const result = await execution;
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'WORKER_CANCELLED');
    assert.equal(result.results[0].runtime.termination?.reason, 'operator-cancel');

    const status = await rt.missionService.status({ missionId });
    assert.equal(status.tasks[0].status, 'cancelled');
    assert.equal(status.tasks[0].dispatches.at(-1).status, 'cancelled');
    assert.equal(status.tasks[0].dispatches.at(-1).termination?.reason, 'operator-cancel');
    assert.equal(status.mission.status, 'blocked');
    assert.deepEqual(rt.workerAdapter.snapshot(), []);

    const timeline = await rt.missionService.timeline({ missionId });
    assert.ok(timeline.some((event) => event.type === 'worker_cancel_requested' && event.taskId === 'CANCEL'));
    assert.ok(timeline.some((event) => event.type === 'worker_cancelled' && event.taskId === 'CANCEL' && event.code === 'WORKER_CANCELLED'));

    const retried = await rt.orchestrator.retryWorker({ missionId, taskId: 'CANCEL' });
    assert.equal(retried.status, 'planned');
    const afterRetry = await rt.missionService.status({ missionId });
    assert.equal(afterRetry.mission.status, 'ready');
  } finally {
    await cleanup(fixture.root);
  }
});

test('worker timeout remains failed but is classified separately from generic worker failure', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const worker = path.join(fixture.root, 'timeout-worker.mjs');
  try {
    await fs.writeFile(worker, 'setInterval(() => {}, 1000);\n');
    const rt = await buildRuntime(fixture, { type: 'custom', command: process.execPath, args: [worker], timeoutMs: 250 });
    const planned = await planSingleTask(rt, 'TIMEOUT');
    const missionId = planned.mission.id;
    const result = await rt.orchestrator.execute({ missionId, runWorkers: true });

    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'WORKER_TIMEOUT');
    assert.equal(result.results[0].runtime.termination?.reason, 'timeout');
    assert.ok(result.results[0].runtime.durationMs >= 200);

    const status = await rt.missionService.status({ missionId });
    assert.equal(status.tasks[0].status, 'failed');
    assert.equal(status.tasks[0].dispatches.at(-1).status, 'failed');
    assert.equal(status.tasks[0].dispatches.at(-1).error.code, 'WORKER_TIMEOUT');
    assert.equal(status.tasks[0].dispatches.at(-1).termination?.reason, 'timeout');
    assert.equal(status.mission.status, 'blocked');

    const timeline = await rt.missionService.timeline({ missionId });
    assert.ok(timeline.some((event) => event.type === 'worker_timed_out' && event.taskId === 'TIMEOUT' && event.code === 'WORKER_TIMEOUT'));
  } finally {
    await cleanup(fixture.root);
  }
});
