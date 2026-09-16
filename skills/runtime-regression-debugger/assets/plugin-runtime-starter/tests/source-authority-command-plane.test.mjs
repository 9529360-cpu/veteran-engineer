import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git, sourceIdentity } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function createDivergedCheckout(fixture) {
  await git(fixture.repo, ['branch', '-M', 'main']);
  const authorityHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(fixture.repo, ['remote', 'add', 'origin', 'https://example.invalid/acme/source-authority.git']);
  await git(fixture.repo, ['update-ref', 'refs/remotes/origin/main', authorityHead]);
  await git(fixture.repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  await git(fixture.repo, ['checkout', '-q', '-b', 'feature/local-context']);
  await fs.writeFile(path.join(fixture.repo, 'authority.txt'), 'feature\n');
  await git(fixture.repo, ['add', 'authority.txt']);
  await git(fixture.repo, ['commit', '-q', '-m', 'feature context']);
  const featureHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return { authorityHead, featureHead };
}

function task(id = 'A') {
  return {
    id,
    contract: 'inspect authoritative source',
    owner: 'src',
    dependencies: [],
    writeSet: [],
    risk: 'low'
  };
}

test('project and mission distinguish observed checkout from repository source authority', async () => {
  const fixture = await createGitRepo({ files: { 'authority.txt': 'main\n', 'src/a.txt': 'a\n' } });
  try {
    const { authorityHead, featureHead } = await createDivergedCheckout(fixture);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });

    assert.equal(project.sourceIdentity.head, featureHead);
    assert.equal(project.sourceIdentity.branch, 'feature/local-context');
    assert.equal(project.sourceAuthority.contract, 'veteran-source-authority-v1');
    assert.equal(project.sourceAuthority.scope, 'remote-default');
    assert.equal(project.sourceAuthority.ref, 'refs/remotes/origin/main');
    assert.equal(project.sourceAuthority.head, authorityHead);
    assert.equal(project.sourceAuthority.branch, 'main');
    assert.equal(project.sourceAuthority.aligned, false);

    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'stay on the repository authority line',
      doneDefinition: 'mission base is origin main rather than the incidental checkout',
      tasks: [task()]
    });
    assert.equal(planned.mission.baseSourceIdentity.head, authorityHead);
    assert.equal(planned.mission.baseSourceIdentity.branch, 'main');
    assert.equal(planned.mission.baseSourceAuthority.ref, 'refs/remotes/origin/main');
    assert.equal(planned.mission.observedSourceIdentityAtPlan.head, featureHead);
  } finally {
    await cleanup(fixture.root);
  }
});

test('planner provider reads the authoritative tree through an isolated worktree', async () => {
  const fixture = await createGitRepo({ files: { 'authority.txt': 'main\n', 'src/a.txt': 'a\n' } });
  try {
    const { authorityHead, featureHead } = await createDivergedCheckout(fixture);
    const planner = path.join(fixture.root, 'planner.cjs');
    await fs.writeFile(planner, `const fs=require('fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);const source=fs.readFileSync('authority.txt','utf8').trim();if(p.project.sourceAuthority.ref!=='refs/remotes/origin/main')process.exit(5);process.stdout.write(JSON.stringify({tasks:[{id:'A',contract:'source='+source,owner:'src',dependencies:[],writeSet:[],risk:'low'}]}));});\n`);
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: { plannerProvider: { command: process.execPath, args: [planner] } }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    assert.equal(project.sourceIdentity.head, featureHead);

    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'plan from actual project authority',
      doneDefinition: 'planner must see main, not feature checkout'
    });

    assert.equal(planned.mission.baseSourceIdentity.head, authorityHead);
    assert.equal(planned.tasks[0].contract, 'source=main');
    assert.equal((await sourceIdentity(fixture.repo)).head, featureHead, 'planning must not rewrite the caller checkout');
  } finally {
    await cleanup(fixture.root);
  }
});

test('worker dispatch and candidate preflight stay on frozen authority while checkout remains on a feature branch', async () => {
  const fixture = await createGitRepo({ files: { 'authority.txt': 'main\n', 'src/a.txt': 'a\n' } });
  try {
    const { authorityHead, featureHead } = await createDivergedCheckout(fixture);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'dispatch from repository authority',
      doneDefinition: 'worker base and candidate source remain main',
      tasks: [task()]
    });

    const execution = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    assert.equal(execution.waveBase, authorityHead);
    assert.equal(execution.dispatched.length, 1);
    assert.equal((await sourceIdentity(execution.dispatched[0].worktreePath)).head, authorityHead);
    assert.equal(execution.dispatched[0].packet.mission.baseHead, authorityHead);
    assert.equal(execution.dispatched[0].packet.mission.sourceAuthority.ref, 'refs/remotes/origin/main');
    assert.equal((await sourceIdentity(fixture.repo)).head, featureHead);

    const preflight = await app.services.candidateService.preflight({ missionId: planned.mission.id });
    assert.equal(preflight.missionId, planned.mission.id);
    assert.equal(preflight.candidateId, null);
    assert.equal(preflight.ready, true);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.sourceHead, authorityHead);
    assert.equal(preflight.sourceBranch, 'main');
    assert.equal(preflight.sourceAuthority.ref, 'refs/remotes/origin/main');
    assert.equal(preflight.sourceDrift, false);
  } finally {
    await cleanup(fixture.root);
  }
});

test('first dispatch fails closed when the authoritative ref advances after planning', async () => {
  const fixture = await createGitRepo({ files: { 'authority.txt': 'main\n', 'src/a.txt': 'a\n' } });
  try {
    const { authorityHead, featureHead } = await createDivergedCheckout(fixture);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'freeze the real repository base',
      doneDefinition: 'source drift is caught before dispatch',
      tasks: [task()]
    });
    assert.equal(planned.mission.baseSourceIdentity.head, authorityHead);

    await git(fixture.repo, ['update-ref', 'refs/remotes/origin/main', featureHead, authorityHead]);
    await assert.rejects(
      app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false }),
      (error) => error.code === 'MISSION_BASE_STALE'
        && error.details.planned === authorityHead
        && error.details.live === featureHead
        && error.details.authorityRef === 'refs/remotes/origin/main'
    );
  } finally {
    await cleanup(fixture.root);
  }
});
