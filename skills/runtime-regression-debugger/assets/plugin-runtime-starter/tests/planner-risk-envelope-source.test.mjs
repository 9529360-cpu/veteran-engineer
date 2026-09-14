import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

test('planner provider receives whether the mission risk envelope was defaulted or explicit', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    const planner = path.join(root, 'planner.cjs');
    await fs.writeFile(planner, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);if(p.protocol!=='veteran-planner-v1')process.exit(3);const expected=p.mission.goal==='default envelope'?'default':'explicit';if(p.mission.riskEnvelope!=='medium'||p.mission.riskEnvelopeSource!==expected)process.exit(4);process.stdout.write(JSON.stringify({tasks:[{id:'T1',contract:'Inspect src/a.txt',owner:'src',dependencies:[],writeSet:[],risk:'low'}]}));});\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { plannerProvider: { command: process.execPath, args: [planner] } } }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });

    const baseline = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'default envelope',
      doneDefinition: 'planner sees default authority'
    });
    assert.equal(baseline.mission.executionStrategy.riskEnvelopeSource, 'baseline');
    assert.equal(baseline.mission.executionStrategy.taskClass, 'light');

    const explicit = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'explicit envelope',
      doneDefinition: 'planner sees explicit authority',
      riskEnvelope: 'medium'
    });
    assert.equal(explicit.mission.executionStrategy.riskEnvelopeSource, 'explicit');
    assert.equal(explicit.mission.executionStrategy.taskClass, 'moderate');
  } finally {
    await cleanup(root);
  }
});
