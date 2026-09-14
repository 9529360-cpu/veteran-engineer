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

const localProject = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };

function localTask(id = 'T1') {
  return { id, key: `M1:${id}`, risk: 'low', writeSet: ['src'] };
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

test('WorkerAdapter refuses packet paths inside the writable task worktree before spawn', async () => {
  const root = await tempDir('veteran-worker-packet-scope-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const packetPath = path.join(worktreePath, 'packet.json');
    const marker = path.join(root, 'spawned.txt');
    await fs.mkdir(worktreePath, { recursive: true });
    const adapter = new WorkerAdapter();
    await assert.rejects(
      adapter.run({
        project: localProject,
        mission: { id: 'M1' },
        task: localTask(),
        worktreePath,
        packet: { protocol: 'veteran-worker-v1' },
        packetPath,
        config: { type: 'custom', command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'spawned')`] }
      }),
      (error) => error.code === 'WORKER_PACKET_PATH_INVALID'
    );
    await assert.rejects(fs.access(packetPath), (error) => error.code === 'ENOENT');
    await assert.rejects(fs.access(marker), (error) => error.code === 'ENOENT');
    assert.deepEqual(adapter.snapshot(), []);
  } finally {
    await cleanup(root);
  }
});

test('WorkerAdapter sanitizes default packet filenames derived from task identity', async () => {
  const root = await tempDir('veteran-worker-packet-name-');
  try {
    const worktreePath = path.join(root, 'worktree');
    await fs.mkdir(worktreePath, { recursive: true });
    const task = localTask('../escape/../../task');
    const adapter = new WorkerAdapter();
    const result = await adapter.run({
      project: localProject,
      mission: { id: 'M1' },
      task,
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      config: { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] }
    });
    assert.equal(result.code, 0);
    assert.equal(path.dirname(path.resolve(result.packetPath)), path.resolve(root));
    assert.equal(path.basename(result.packetPath).includes(path.sep), false);
    assert.match(path.basename(result.packetPath), /^\.veteran-task-[a-z0-9._-]+-\d+\.json$/);
  } finally {
    await cleanup(root);
  }
});

test('local worker receives a dispatch runtime namespace and randomized disposable temp directory', async () => {
  const root = await tempDir('veteran-worker-runtime-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const workerPath = path.join(root, 'worker.mjs');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(workerPath, [
      "import fs from 'node:fs/promises';",
      "import path from 'node:path';",
      "const tmp = process.env.TMPDIR || process.env.TMP || process.env.TEMP;",
      "await fs.writeFile(path.join(tmp, 'probe.txt'), 'owned\\n');",
      "process.stdout.write(JSON.stringify({ runtimeNamespace: process.env.VETERAN_RUNTIME_NAMESPACE, tmp }));"
    ].join('\n'));
    const adapter = new WorkerAdapter();
    const result = await adapter.run({
      project: localProject,
      mission: { id: 'M1' },
      task: localTask(),
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(root, 'dispatch-123.json'),
      config: { type: 'custom', command: process.execPath, args: [workerPath] }
    });
    assert.equal(result.code, 0);
    assert.equal(result.termination, null);
    assert.ok(result.durationMs >= 0);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.runtimeNamespace, 'M1:T1:dispatch-123');
    assert.equal(result.runtimeNamespace, observed.runtimeNamespace);
    assert.match(observed.tmp.replaceAll('\\', '/'), /\/veteran-engineer-m1-t1-dispatch-123-[^/]+$/);
    await assert.rejects(fs.stat(observed.tmp), (error) => error.code === 'ENOENT', 'task-owned temp directory must be cleaned after worker exit');
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
