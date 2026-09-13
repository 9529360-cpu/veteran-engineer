import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('validation uses operator capability catalog and raw validation requires second explicit opt-in', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{ name: 'node-pass', command: [process.execPath, '-e', "const fs=require('fs');process.exit(fs.existsSync('src/a.txt')?0:2)"] }],
        workerPolicy: { allowRawValidation: true }
      }
    }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const caps = await app.services.validationService.capabilities({ projectId: project.id });
    assert.deepEqual(caps.map((item) => item.name), ['node-pass']);
    const catalog = await app.services.validationService.run({ projectId: project.id, capability: 'node-pass' });
    assert.equal(catalog.passed, true);
    await assert.rejects(
      app.services.validationService.run({ projectId: project.id, rawCommand: [process.execPath, '-e', 'process.exit(0)'], confirmRawValidation: false }),
      (error) => error.code === 'RAW_VALIDATION_NOT_ALLOWED'
    );
    const raw = await app.services.validationService.run({ projectId: project.id, rawCommand: [process.execPath, '-e', 'process.exit(0)'], confirmRawValidation: true });
    assert.equal(raw.passed, true);
  } finally {
    await cleanup(root);
  }
});

test('configured semantic reviewer provider executes its bounded protocol and returns normally', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const reviewer = path.join(root, 'reviewer.cjs');
    await fs.writeFile(reviewer, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);if(p.protocol!=='veteran-reviewer-v1')process.exit(3);process.stdout.write(JSON.stringify({passed:true,findings:[]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { reviewerProvider: { command: process.execPath, args: [reviewer] }, requireSemanticReview: true } }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'review', doneDefinition: 'reviewed', tasks: [{ id: 'T1', contract: 'noop', owner: 'root', dependencies: [], writeSet: [], risk: 'low' }] });
    await app.store.transaction('test_task_done', (state) => { state.tasks[`${planned.mission.id}:T1`].status = 'done'; });
    const result = await app.services.reviewService.semantic({ missionId: planned.mission.id });
    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.semanticReview.status, 'passed');
    assert.ok(status.mission.semanticReview.commitSha);
  } finally {
    await cleanup(root);
  }
});
