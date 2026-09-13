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
import { assertPathsWithinScope, changedPaths, git } from '../src/git.mjs';
import { createGitRepo, cleanup, tempDir } from './helpers.mjs';

async function buildRuntime(repo, stateRoot) {
  const store = await new StateStore({ root: stateRoot }).init();
  const projectService = new ProjectService({ store });
  const missionService = new MissionService({ store, projectService });
  const evidenceService = new EvidenceService({ store });
  const worktreeManager = new WorktreeManager({ store });
  const workerAdapter = new WorkerAdapter();
  const orchestrator = new WorkerOrchestrator({ store, projectService, missionService, worktreeManager, workerAdapter, evidenceService });
  const project = await projectService.open({ repoPath: repo });
  return { store, projectService, missionService, evidenceService, worktreeManager, workerAdapter, orchestrator, project };
}

test('dispatch-only worker packet lives outside task worktree, cannot be re-dispatched, and external result advances wave', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const rt = await buildRuntime(repo, stateRoot);
    const planned = await rt.missionService.plan({
      projectId: rt.project.id,
      goal: 'change a',
      doneDefinition: 'a changed',
      tasks: [{ id: 'T1', contract: 'update src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const missionId = planned.mission.id;
    const first = await rt.orchestrator.execute({ missionId, runWorkers: false });
    assert.equal(first.dispatched.length, 1);
    const dispatch = first.dispatched[0];
    assert.ok(dispatch.packetPath.startsWith(rt.store.artifactsDir));
    assert.equal(dispatch.packetPath.startsWith(dispatch.worktreePath), false);
    assert.equal((await changedPaths(dispatch.worktreePath, head)).length, 0, 'worker packet must not dirty task worktree');

    const second = await rt.orchestrator.execute({ missionId, runWorkers: false });
    assert.equal(second.reason, 'wave-has-outstanding-dispatches');
    assert.equal(second.pending[0].dispatchId, dispatch.dispatchId);

    await fs.writeFile(path.join(dispatch.worktreePath, 'src/a.txt'), 'after\n');
    const committed = await rt.orchestrator.commitExternalTaskResult({ missionId, taskId: 'T1' });
    assert.equal(committed.waveAdvanced, true);
    assert.ok(committed.commitSha);
    const status = await rt.missionService.status({ missionId });
    assert.equal(status.tasks[0].status, 'done');
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n', 'user checkout must remain untouched');
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'user branch HEAD must remain unchanged');

    const transition = await rt.orchestrator.execute({ missionId, runWorkers: false });
    assert.equal(transition.phase, 'validation');
  } finally {
    await cleanup(root);
  }
});

test('broad write scope still rejects symlink traversal outside repository', async () => {
  const { root, repo } = await createGitRepo();
  try {
    const outside = await tempDir('veteran-outside-');
    try {
      const target = path.join(outside, 'secret.txt');
      await fs.writeFile(target, 'secret\n');
      await fs.symlink(outside, path.join(repo, 'escape-link'), process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(
        assertPathsWithinScope(repo, ['escape-link/secret.txt'], ['.']),
        (error) => error.code === 'SYMLINK_SCOPE_VIOLATION'
      );
    } finally {
      await cleanup(outside);
    }
  } finally {
    await cleanup(root);
  }
});

test('Codex worker preset uses workspace-write sandbox and refuses dangerous bypass flags', async () => {
  const { resolveWorkerConfig } = await import('../src/worker-adapter.mjs');
  const project = { workerPolicy: { defaultWorker: 'codex', codex: { command: 'codex' } } };
  const config = resolveWorkerConfig(project, 'default');
  assert.equal(config.type, 'codex');
  assert.deepEqual(config.args.slice(0, 5), ['exec', '--sandbox', 'workspace-write', '--ephemeral', '--color']);
  assert.equal(config.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(config.args.at(-1), '-');
  assert.throws(
    () => resolveWorkerConfig({ workerPolicy: { defaultWorker: 'codex', codex: { extraArgs: ['--dangerously-bypass-approvals-and-sandbox'] } } }, 'default'),
    (error) => error.code === 'CODEX_PRESET_DANGEROUS_FLAG'
  );
});
