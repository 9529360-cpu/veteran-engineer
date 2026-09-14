import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function temporaryEnv(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function literalPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function evidenceArtifact(app, evidenceId) {
  const [evidence] = await app.services.evidenceService.query({ ids: [evidenceId] });
  const artifact = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
  return { evidence, artifact };
}

test('planner provider redacts explicitly allowlisted environment values before durable task state and evidence', async () => {
  const secret = 'planner-"secret"-7f2a';
  const secretPattern = literalPattern(secret);
  const restoreEnv = temporaryEnv({ VETERAN_PLANNER_EVIDENCE_SECRET: secret });
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    const planner = path.join(root, 'planner.cjs');
    await fs.writeFile(planner, `const secret=process.env.VETERAN_PLANNER_EVIDENCE_SECRET;let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{JSON.parse(input);process.stderr.write('planner stderr '+secret);process.stdout.write(JSON.stringify({tasks:[{id:'T1',contract:'Inspect '+secret,owner:'src',dependencies:[],writeSet:[],risk:'low',notes:{detail:secret}}]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { plannerProvider: { command: process.execPath, args: [planner], envAllowlist: ['VETERAN_PLANNER_EVIDENCE_SECRET'] } } }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'redact planner', doneDefinition: 'no secret persists' });

    assert.doesNotMatch(JSON.stringify(planned), secretPattern);
    assert.match(planned.tasks[0].contract, /\[REDACTED\]/);
    assert.equal(planned.tasks[0].notes.detail, '[REDACTED]');

    const { evidence, artifact } = await evidenceArtifact(app, planned.mission.planningExperience.evidenceId);
    assert.doesNotMatch(JSON.stringify(evidence), secretPattern);
    assert.doesNotMatch(artifact, secretPattern);
    assert.match(artifact, /\[REDACTED\]/);
  } finally {
    restoreEnv();
    await cleanup(root);
  }
});

test('semantic reviewer redacts explicitly allowlisted environment values before findings and evidence', async () => {
  const secret = 'reviewer-"secret"-8b3c';
  const secretPattern = literalPattern(secret);
  const restoreEnv = temporaryEnv({ VETERAN_REVIEWER_EVIDENCE_SECRET: secret });
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const reviewer = path.join(root, 'reviewer.cjs');
    await fs.writeFile(reviewer, `const secret=process.env.VETERAN_REVIEWER_EVIDENCE_SECRET;let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{JSON.parse(input);process.stderr.write('reviewer stderr '+secret);process.stdout.write(JSON.stringify({passed:false,findings:[{severity:'high',code:'SECRET_ECHO',message:'finding '+secret,detail:{secret}}]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { reviewerProvider: { command: process.execPath, args: [reviewer], envAllowlist: ['VETERAN_REVIEWER_EVIDENCE_SECRET'] }, requireSemanticReview: true } }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'review redaction', doneDefinition: 'no secret persists', tasks: [{ id: 'T1', contract: 'noop', owner: 'root', dependencies: [], writeSet: [], risk: 'low' }] });
    await app.store.transaction('test_task_done', (state) => { state.tasks[`${planned.mission.id}:T1`].status = 'done'; });

    const result = await app.services.reviewService.semantic({ missionId: planned.mission.id });
    assert.equal(result.passed, false);
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
    assert.match(result.findings[0].message, /\[REDACTED\]/);
    assert.equal(result.findings[0].detail.secret, '[REDACTED]');

    const { evidence, artifact } = await evidenceArtifact(app, result.evidenceId);
    assert.doesNotMatch(JSON.stringify(evidence), secretPattern);
    assert.doesNotMatch(artifact, secretPattern);
    assert.match(artifact, /\[REDACTED\]/);
  } finally {
    restoreEnv();
    await cleanup(root);
  }
});
