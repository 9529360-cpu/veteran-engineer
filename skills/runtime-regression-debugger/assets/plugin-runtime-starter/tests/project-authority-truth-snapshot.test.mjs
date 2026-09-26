import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git, sourceIdentity } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function divergeEnvironment(fixture) {
  await git(fixture.repo, ['branch', '-M', 'main']);
  const authorityHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(fixture.repo, ['remote', 'add', 'origin', 'https://example.invalid/acme/project-truth.git']);
  await git(fixture.repo, ['update-ref', 'refs/remotes/origin/main', authorityHead]);
  await git(fixture.repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

  await git(fixture.repo, ['checkout', '-q', '-b', 'feature/misleading-environment']);
  await fs.writeFile(path.join(fixture.repo, 'package.json'), `${JSON.stringify({
    name: 'feature-view',
    private: true,
    packageManager: 'pnpm@9.15.0',
    scripts: { test: 'node --test' }
  }, null, 2)}\n`);
  await fs.rm(path.join(fixture.repo, 'package-lock.json'));
  await fs.writeFile(path.join(fixture.repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  await fs.writeFile(path.join(fixture.repo, 'pyproject.toml'), '[project]\nname = "feature-only-python"\n');
  await git(fixture.repo, ['add', '-A']);
  await git(fixture.repo, ['commit', '-q', '-m', 'misleading feature environment']);
  const featureHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return { authorityHead, featureHead };
}

test('project environment, readiness, bootstrap, and planner awareness stay bound to repository authority', async () => {
  const fixture = await createGitRepo({
    files: {
      'package.json': `${JSON.stringify({
        name: 'authority-view',
        private: true,
        packageManager: 'npm@10.8.0',
        scripts: { test: 'node --test' }
      }, null, 2)}\n`,
      'package-lock.json': '{}\n',
      'src/a.txt': 'a\n'
    }
  });
  try {
    const { authorityHead, featureHead } = await divergeEnvironment(fixture);
    const planner = path.join(fixture.root, 'planner.cjs');
    await fs.writeFile(planner, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);const families=p.projectAwareness?.environment?.runtimeFamilies||[];if(families.length!==1||families[0]!=='node')process.exit(6);if(p.project.sourceIdentity.head!==p.project.sourceAuthority.head)process.exit(7);process.stdout.write(JSON.stringify({tasks:[{id:'A',contract:'authority environment is node/npm',owner:'src',dependencies:[],writeSet:[],risk:'low'}]}));});\n`);
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: { plannerProvider: { command: process.execPath, args: [planner] } }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });

    assert.equal(project.sourceIdentity.head, featureHead);
    assert.equal(project.sourceIdentity.branch, 'feature/misleading-environment');
    assert.equal(project.sourceAuthority.head, authorityHead);
    assert.equal(project.sourceAuthority.ref, 'refs/remotes/origin/main');
    assert.equal(project.environmentSourceIdentity.head, authorityHead);
    assert.equal(project.environmentSourceIdentity.dirty, false);
    assert.deepEqual(project.environmentProfile.runtimeFamilies, ['node']);
    assert.equal(project.environmentProfile.packageManagers.node.selected, 'npm');
    assert.ok(project.environmentProfile.manifests.some((item) => item.kind === 'node-lock-npm'));
    assert.ok(!project.environmentProfile.manifests.some((item) => item.kind === 'node-lock-pnpm'));
    assert.ok(!project.environmentProfile.manifests.some((item) => item.kind === 'python-project'));
    assert.ok(project.bootstrapPlan.steps.some((step) => step.id === 'node:npm' && step.command.join(' ') === 'npm ci'));
    assert.ok(!project.bootstrapPlan.steps.some((step) => step.owner === 'python' || step.id === 'node:pnpm'));
    assert.equal(project.commandPlan.contract, 'veteran-project-command-plan-v1');
    assert.equal(project.commandPlan.packageManager, 'npm');
    const authorityCommandPlanStatus = project.commandPlan.status;
    assert.deepEqual(project.commandPlan.changedPaths, []);
    assert.deepEqual(project.commandPlan.validation.minimal, []);
    assert.deepEqual(project.commandPlan.commands.map((item) => item.script), ['test']);
    assert.equal((await sourceIdentity(fixture.repo)).head, featureHead, 'project inspection must not switch/reset the caller checkout');

    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'plan from repository truth',
      doneDefinition: 'planner sees the authority-bound environment profile'
    });
    assert.equal(planned.mission.baseSourceIdentity.head, authorityHead);
    assert.equal(planned.tasks[0].contract, 'authority environment is node/npm');

    const localPackagePath = path.join(fixture.repo, 'package.json');
    const localPackage = JSON.parse(await fs.readFile(localPackagePath, 'utf8'));
    localPackage.scripts.verify = 'node --test';
    await fs.writeFile(localPackagePath, `${JSON.stringify(localPackage, null, 2)}\n`);
    await fs.writeFile(path.join(fixture.repo, 'Cargo.toml'), '[package]\nname = "dirty-feature-only"\nversion = "0.0.0"\n');
    const refreshed = await app.services.projectService.snapshot({ projectId: project.id });
    assert.equal(refreshed.sourceIdentity.dirty, true);
    assert.ok(refreshed.sourceIdentity.dirtyPaths.includes('package.json'));
    assert.ok(refreshed.sourceIdentity.dirtyPaths.includes('Cargo.toml'));
    assert.equal(refreshed.environmentSourceIdentity.head, authorityHead);
    assert.equal(refreshed.environmentSourceIdentity.dirty, false);
    assert.deepEqual(refreshed.environmentProfile.runtimeFamilies, ['node']);
    assert.ok(!refreshed.environmentProfile.runtimeFamilies.includes('rust'));
    assert.equal(refreshed.commandPlan.packageManager, 'npm');
    assert.equal(refreshed.commandPlan.status, authorityCommandPlanStatus);
    assert.equal(refreshed.commandPlan.authorityDirty, false);
    assert.deepEqual(refreshed.commandPlan.changedPaths, []);
    assert.deepEqual(refreshed.commandPlan.commands.map((item) => item.script), ['test']);
    assert.equal(refreshed.commandPlan.commands.some((item) => item.script === 'verify'), false);
    assert.equal((await sourceIdentity(fixture.repo)).head, featureHead);
  } finally {
    await cleanup(fixture.root);
  }
});
