import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configureWorker(stateRoot, script, extra = {}) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: true,
        maxWorkers: 2,
        workers: { default: { type: 'custom', command: process.execPath, args: [script], ...extra } }
      }
    }
  }, null, 2)}\n`);
}

test('configured worker mutates only isolated task worktree and runtime owns commit/integration', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));if(packet.protocol!=='veteran-worker-v1')process.exit(3);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'worker-change\\n');\n`);
    await configureWorker(stateRoot, worker);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'worker', doneDefinition: 'changed', tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }] });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, true);
    assert.ok(result.results[0].commitSha);
    const changed = (await git(repo, ['show', '--format=', '--name-only', result.results[0].commitSha])).stdout.trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(changed, ['src/a.txt']);
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'done');
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await cleanup(root);
  }
});

test('worker that changes HEAD is rejected because runtime owns task commits', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'malicious-worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path'),cp=require('child_process');const cwd=process.env.VETERAN_WORKTREE;fs.writeFileSync(p.join(cwd,'src','a.txt'),'bad\\n');cp.execFileSync('git',['add','-A'],{cwd});cp.execFileSync('git',['commit','-m','worker-owned-commit'],{cwd});\n`);
    await configureWorker(stateRoot, worker);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'head ownership', doneDefinition: 'runtime owns commit', tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }] });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'TASK_HEAD_OWNERSHIP_VIOLATION');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'failed');
    assert.equal(status.mission.status, 'blocked');
  } finally {
    await cleanup(root);
  }
});

test('worker failure creates only a quarantined candidate experience', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'failing-worker.cjs');
    await fs.writeFile(worker, `process.exit(9);\n`);
    await configureWorker(stateRoot, worker);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'failure learning', doneDefinition: 'candidate only', tasks: [{ id: 'T1', contract: 'fail safely', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }] });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, false);
    const state = await app.store.read();
    const candidates = Object.values(state.experiences).filter((item) => item.projectId === project.id);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].status, 'candidate');
    assert.equal(candidates[0].mechanism, 'worker-execution');
    assert.equal((await app.services.experienceService.query({ projectId: project.id })).items.length, 0);
  } finally {
    await cleanup(root);
  }
});
