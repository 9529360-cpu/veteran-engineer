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
import { sourceIdentity } from '../src/git.mjs';
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
  return { store, missionService, worktreeManager, workerAdapter, orchestrator, project };
}

async function planSingleTask(rt, id) {
  return rt.missionService.plan({
    projectId: rt.project.id,
    goal: `exercise mission cancellation race ${id}`,
    doneDefinition: `${id} cannot outlive durable mission cancellation`,
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

test('durable mission cancellation plus mission drain stays terminal after worker cancellation settles', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const ready = path.join(fixture.root, 'cancel-ready.txt');
  const worker = path.join(fixture.root, 'cancel-worker.mjs');
  try {
    await fs.writeFile(worker, [
      "import fs from 'node:fs/promises';",
      `await fs.writeFile(${JSON.stringify(ready)}, 'ready\\n');`,
      'setInterval(() => {}, 1000);'
    ].join('\n'));
    const rt = await buildRuntime(fixture, { type: 'custom', command: process.execPath, args: [worker], timeoutMs: 10_000 });
    const planned = await planSingleTask(rt, 'CANCEL');
    const missionId = planned.mission.id;
    const execution = rt.orchestrator.execute({ missionId, runWorkers: true });
    await waitForFile(ready);

    await rt.missionService.cancel({ missionId, reason: 'race-regression' });
    const drained = rt.workerAdapter.cancelMission(missionId);
    assert.equal(drained.requested, 1);
    assert.equal(drained.accepted, 1);

    const result = await execution;
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'WORKER_CANCELLED');

    const status = await rt.missionService.status({ missionId });
    assert.equal(status.mission.status, 'cancelled');
    assert.equal(status.mission.nextWaveIndex, 0);
    assert.equal(status.tasks[0].status, 'cancelled');
    assert.equal(status.tasks[0].dispatches.at(-1).status, 'cancelled');
    assert.equal(status.tasks[0].dispatches.at(-1).termination?.reason, 'operator-cancel');

    const timeline = await rt.missionService.timeline({ missionId });
    assert.ok(timeline.some((event) => event.type === 'mission_cancelled'));
    assert.ok(timeline.some((event) => event.type === 'worker_cancelled' && event.missionCancelled === true));
    assert.equal(timeline.some((event) => event.type === 'mission_wave_completed'), false);
    assert.deepEqual(rt.workerAdapter.snapshot(), []);
  } finally {
    await cleanup(fixture.root);
  }
});

test('late successful worker result is discarded and mission integration worktree is reset when cancellation wins', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const ready = path.join(fixture.root, 'success-ready.txt');
  const release = path.join(fixture.root, 'success-release.txt');
  const worker = path.join(fixture.root, 'success-worker.mjs');
  try {
    await fs.writeFile(worker, [
      "import fs from 'node:fs/promises';",
      "import path from 'node:path';",
      `const ready = ${JSON.stringify(ready)};`,
      `const release = ${JSON.stringify(release)};`,
      "await fs.writeFile(ready, 'ready\\n');",
      'while (true) {',
      "  try { await fs.access(release); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }",
      '}',
      "await fs.writeFile(path.join(process.cwd(), 'src/a.txt'), 'after\\n');"
    ].join('\n'));
    const rt = await buildRuntime(fixture, { type: 'custom', command: process.execPath, args: [worker], timeoutMs: 10_000 });
    const planned = await planSingleTask(rt, 'SUCCESS');
    const missionId = planned.mission.id;
    const execution = rt.orchestrator.execute({ missionId, runWorkers: true });
    await waitForFile(ready);

    await rt.missionService.cancel({ missionId, reason: 'late-success-regression' });
    await fs.writeFile(release, 'release\n');
    await execution;

    const status = await rt.missionService.status({ missionId });
    const dispatch = status.tasks[0].dispatches.at(-1);
    assert.equal(status.mission.status, 'cancelled');
    assert.equal(status.mission.nextWaveIndex, 0);
    assert.equal(status.tasks[0].status, 'cancelled');
    assert.equal(dispatch.status, 'cancelled');
    assert.equal(dispatch.error.code, 'MISSION_CANCELLED');
    assert.equal(typeof dispatch.discardedCommitSha, 'string');
    assert.ok(dispatch.discardedCommitSha.length >= 7);
    assert.deepEqual(dispatch.discardedChangedPaths, ['src/a.txt']);

    const missionWorktree = rt.worktreeManager.missionPath(planned.mission);
    const missionIdentity = await sourceIdentity(missionWorktree);
    assert.equal(missionIdentity.head, fixture.head, 'cancelled mission must not retain the late worker cherry-pick');
    assert.equal(await fs.readFile(path.join(missionWorktree, 'src/a.txt'), 'utf8'), 'before\n');
    assert.equal(await fs.readFile(path.join(fixture.repo, 'src/a.txt'), 'utf8'), 'before\n');

    const timeline = await rt.missionService.timeline({ missionId });
    assert.ok(timeline.some((event) => event.type === 'worker_result_discarded_after_mission_cancel' && event.taskId === 'SUCCESS'));
    assert.equal(timeline.some((event) => event.type === 'task_integrated'), false);
    assert.equal(timeline.some((event) => event.type === 'mission_wave_completed'), false);
  } finally {
    await cleanup(fixture.root);
  }
});
