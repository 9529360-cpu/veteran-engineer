import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configure(stateRoot, workerScript, feedbackCommand) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      validationCapabilities: [{ name: 'live-product', command: feedbackCommand }],
      runtimeFeedbackCapabilities: ['live-product'],
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [workerScript] } }
      }
    }
  }, null, 2)}\n`);
}

test('completed engineering wave materializes exact integrated source and records non-gating runtime feedback', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');\n`);
    await configure(stateRoot, worker, [process.execPath, '-e', "const fs=require('fs');process.exit(fs.readFileSync('src/a.txt','utf8')==='after\\n'?0:9)"]);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.deepEqual(project.runtimeFeedbackCapabilities, ['live-product']);
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'close the engineering feedback loop',
      doneDefinition: 'integrated change is observed in a materialized runtime',
      tasks: [{ id: 'T1', contract: 'change runtime-visible product state', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, true);
    assert.equal(result.runtimeFeedback.recorded, true);
    assert.equal(result.runtimeFeedback.passed, true);
    assert.equal(result.runtimeFeedback.capabilities[0].capability, 'live-product');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.runtimeFeedback.status, 'passed');
    assert.equal(status.mission.runtimeFeedback.latestRound.commitSha, status.tasks[0].integrationSha);
    assert.equal(status.mission.validation.status, 'pending', 'development feedback must not impersonate final validation');
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'user checkout remains untouched');
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await cleanup(root);
  }
});

test('failed runtime feedback remains visible but does not block the next engineering wave', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');if(process.env.VETERAN_TASK_ID==='T1')fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed-a\\n');else fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'changed-b\\n');\n`);
    await configure(stateRoot, worker, [process.execPath, '-e', 'process.exit(7)']);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'continue from runtime evidence',
      doneDefinition: 'both dependent waves integrate while feedback remains inspectable',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b after a', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, false);
    let status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.runtimeFeedback.status, 'failed');
    assert.equal(status.mission.validation.status, 'pending');

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].ok, true);
    assert.equal(second.runtimeFeedback.passed, false);
    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 2);
    assert.equal(status.mission.runtimeFeedback.rounds.length, 2);
    assert.equal(status.tasks.every((task) => task.status === 'done'), true);
  } finally {
    await cleanup(root);
  }
});

test('runtime feedback target override is confined to integrated mission identities', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities: [{ name: 'smoke', command: [process.execPath, '-e', 'process.exit(0)'] }] } }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'scope feedback target', doneDefinition: 'arbitrary revisions are rejected', tasks: [{ id: 'T1', contract: 'noop', owner: 'src', dependencies: [], writeSet: [], risk: 'low' }] });
    await assert.rejects(
      app.services.validationService.run({ projectId: project.id, missionId: planned.mission.id, capability: 'smoke', purpose: 'runtime-feedback', targetCommitSha: 'deadbeef' }),
      (error) => error.code === 'RUNTIME_FEEDBACK_TARGET_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});
