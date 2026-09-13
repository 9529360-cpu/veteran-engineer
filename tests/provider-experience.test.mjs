import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function seedExperiences(app, projectId) {
  const active = await app.services.experienceService.commit({
    projectId,
    mechanism: 'planning',
    statement: 'Active reviewed project fact',
    kind: 'invariant',
    equivalenceClass: 'active-only'
  });
  await app.services.experienceService.review({ experienceId: active.id, action: 'activate' });
  const candidate = await app.services.experienceService.commit({
    projectId,
    mechanism: 'planning',
    statement: 'Candidate must remain quarantined',
    kind: 'invariant',
    equivalenceClass: 'candidate-only'
  });
  return { active, candidate };
}

test('planner provider receives reviewed active experience only and core validates its proposed DAG', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    const planner = path.join(root, 'planner.cjs');
    await fs.writeFile(planner, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);if(p.protocol!=='veteran-planner-v1')process.exit(3);if(p.projectExperience.length!==1||p.projectExperience[0].statement!=='Active reviewed project fact')process.exit(4);process.stdout.write(JSON.stringify({tasks:[{id:'T1',contract:'Update src/a.txt',owner:'src',dependencies:[],writeSet:['src'],risk:'low'}]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { plannerProvider: { command: process.execPath, args: [planner] } } }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const { active, candidate } = await seedExperiences(app, project.id);
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'provider plan', doneDefinition: 'valid DAG from provider' });
    assert.equal(planned.tasks.length, 1);
    assert.deepEqual(planned.mission.planningExperience.ids, [active.id]);
    assert.equal(planned.mission.planningExperience.ids.includes(candidate.id), false);
    assert.ok(planned.mission.planningExperience.evidenceId);
    const state = await app.store.read();
    assert.ok(state.experiences[active.id].usage.count >= 1);
    assert.equal(state.experiences[candidate.id].usage.count, 0);
  } finally {
    await cleanup(root);
  }
});

test('worker packet routes active experience but never candidate experience', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const { active, candidate } = await seedExperiences(app, project.id);
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'worker context',
      doneDefinition: 'packet is governed',
      tasks: [{ id: 'T1', contract: 'Inspect only', owner: 'src', dependencies: [], writeSet: [], risk: 'low' }]
    });
    const dispatched = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    const packet = dispatched.dispatched[0].packet;
    assert.deepEqual(packet.projectExperience.map((item) => item.id), [active.id]);
    assert.equal(packet.projectExperience.some((item) => item.id === candidate.id), false);
    assert.match(packet.experiencePrecedence, /repository\/runtime evidence outranks/i);
  } finally {
    await cleanup(root);
  }
});

test('semantic reviewer provider receives active experience only', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const reviewer = path.join(root, 'reviewer.cjs');
    await fs.writeFile(reviewer, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);if(p.protocol!=='veteran-reviewer-v1')process.exit(3);if(p.projectExperience.length!==1||p.projectExperience[0].statement!=='Active reviewed project fact')process.exit(4);process.stdout.write(JSON.stringify({passed:true,findings:[]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { reviewerProvider: { command: process.execPath, args: [reviewer] }, requireSemanticReview: true } }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await seedExperiences(app, project.id);
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'review', doneDefinition: 'reviewed', tasks: [{ id: 'T1', contract: 'noop', owner: 'root', dependencies: [], writeSet: [], risk: 'low' }] });
    await app.store.transaction('test_task_done', (state) => { state.tasks[`${planned.mission.id}:T1`].status = 'done'; });
    const result = await app.services.reviewService.semantic({ missionId: planned.mission.id });
    assert.equal(result.passed, true);
  } finally {
    await cleanup(root);
  }
});
