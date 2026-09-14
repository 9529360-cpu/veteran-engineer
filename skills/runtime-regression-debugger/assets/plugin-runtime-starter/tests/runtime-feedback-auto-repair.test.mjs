import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configure(stateRoot, workerScript, { autoRepair = true, maxRepairAttempts = 1, projectFeedback = false } = {}) {
  await fs.mkdir(stateRoot, { recursive: true });
  const capability = {
    name: 'live-product',
    command: [process.execPath, '-e', "const fs=require('fs');process.exit(fs.readFileSync('src/a.txt','utf8')==='fixed\\n'?0:7)"]
  };
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      validationCapabilities: [capability],
      runtimeFeedbackCapabilities: projectFeedback ? ['live-product'] : [],
      runtimeFeedbackPolicy: { autoRepair, maxRepairAttempts },
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [workerScript] } }
      }
    }
  }, null, 2)}\n`);
}

test('failed task-owned runtime feedback schedules one bounded repair wave that consumes the feedback', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));const target=p.join(process.env.VETERAN_WORKTREE,'src','a.txt');if(process.env.VETERAN_TASK_ID==='T1'){if(packet.runtimeFeedback!==null)process.exit(21);fs.writeFileSync(target,'broken\\n');}else{if(!packet.task.id.startsWith('T1-rf1'))process.exit(22);if(packet.runtimeFeedback?.sourceBound!==true||packet.runtimeFeedback?.passed!==false)process.exit(23);if(packet.task.writeSet.length!==1||packet.task.writeSet[0]!=='src/a.txt')process.exit(24);fs.writeFileSync(target,'fixed\\n');}\n`);
    await configure(stateRoot, worker);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.deepEqual(project.runtimeFeedbackPolicy, { autoRepair: true, maxRepairAttempts: 1 });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'repair observed product behavior',
      doneDefinition: 'runtime feedback converges after one bounded repair',
      tasks: [{
        id: 'T1',
        contract: 'make src/a.txt satisfy live product behavior',
        owner: 'src/a.txt',
        dependencies: [],
        writeSet: ['src/a.txt'],
        risk: 'low',
        validationCapability: 'live-product'
      }]
    });

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, false);
    assert.equal(first.runtimeFeedback.repair.scheduled, true);
    assert.equal(first.runtimeFeedback.repair.taskIds.length, 1);
    let status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.waves.length, 2);
    const repairTask = status.tasks.find((task) => task.id === first.runtimeFeedback.repair.taskIds[0]);
    assert.ok(repairTask);
    assert.equal(repairTask.status, 'planned');
    assert.deepEqual(repairTask.writeSet, ['src/a.txt']);
    assert.equal(repairTask.owner, 'src/a.txt');
    assert.equal(repairTask.validationCapability, 'live-product');
    assert.equal(repairTask.feedbackRemediation.rootTaskId, 'T1');
    assert.equal(repairTask.feedbackRemediation.attempt, 1);

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].ok, true);
    assert.equal(second.runtimeFeedback.passed, true);
    assert.equal(second.runtimeFeedback.repair.scheduled, false);
    assert.equal(second.runtimeFeedback.repair.reason, 'feedback-does-not-require-repair');
    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 2);
    assert.equal(status.mission.runtimeFeedback.repairWaves.length, 1);
    assert.equal(status.tasks.every((task) => task.status === 'done'), true);

    const transition = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(transition.phase, 'validation');
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await cleanup(root);
  }
});

test('auto repair stops at the configured attempt bound instead of creating an infinite loop', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'broken\\n');\n`);
    await configure(stateRoot, worker, { autoRepair: true, maxRepairAttempts: 1 });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'bound unsuccessful runtime repair',
      doneDefinition: 'only one repair attempt may be scheduled',
      tasks: [{ id: 'T1', contract: 'try to satisfy live product behavior', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low', validationCapability: 'live-product' }]
    });
    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.repair.scheduled, true);
    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.runtimeFeedback.passed, false);
    assert.equal(second.runtimeFeedback.repair.scheduled, false);
    assert.equal(second.runtimeFeedback.repair.reason, 'repair-attempts-exhausted');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.waves.length, 2);
    assert.equal(status.mission.runtimeFeedback.repairWaves.length, 1);
    assert.equal(status.tasks.filter((task) => task.feedbackRemediation).length, 1);
  } finally {
    await cleanup(root);
  }
});

test('project-level feedback without an explicit task validation owner never invents a repair write scope', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'broken\\n');\n`);
    await configure(stateRoot, worker, { autoRepair: true, maxRepairAttempts: 2, projectFeedback: true });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'keep global feedback advisory without an owner',
      doneDefinition: 'no repair scope is fabricated',
      tasks: [{ id: 'T1', contract: 'change a', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, false);
    assert.equal(first.runtimeFeedback.repair.scheduled, false);
    assert.equal(first.runtimeFeedback.repair.reason, 'no-owned-failed-capability');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.waves.length, 1);
    assert.equal(status.tasks.length, 1);
  } finally {
    await cleanup(root);
  }
});

test('runtime feedback repair policy rejects malformed or unbounded attempt settings', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { runtimeFeedbackPolicy: { autoRepair: true, maxRepairAttempts: 4 } } })}\n`);
    await assert.rejects(
      createVeteranApp({ stateRoot }).then((app) => app.services.projectService.open({ repoPath: repo })),
      (error) => error.code === 'OPERATOR_CONFIG_INVALID' && error.details?.path === 'defaults.runtimeFeedbackPolicy.maxRepairAttempts'
    );
  } finally {
    await cleanup(root);
  }
});
