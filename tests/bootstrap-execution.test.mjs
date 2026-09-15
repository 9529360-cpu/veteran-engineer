import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { ProjectBootstrapExecutor } from '../src/bootstrap-executor.mjs';
import { createGitRepo, cleanup, waitForProcessStopped } from './helpers.mjs';

const packageJson = `${JSON.stringify({ name: 'bootstrap-fixture', version: '1.0.0', packageManager: 'npm@10.0.0' }, null, 2)}\n`;
const packageLock = `${JSON.stringify({ name: 'bootstrap-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'bootstrap-fixture', version: '1.0.0' } } }, null, 2)}\n`;

async function installFakeNpm(root, source) {
  const bin = path.join(root, 'fake-bin');
  await fs.mkdir(bin, { recursive: true });
  const npm = path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (process.platform === 'win32') {
    const script = path.join(bin, 'fake-npm.cjs');
    await fs.writeFile(script, source);
    await fs.writeFile(npm, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    await fs.writeFile(npm, `#!${process.execPath}\n${source}`);
    await fs.chmod(npm, 0o755);
  }
  return bin;
}

async function configureWorker(stateRoot, workerScript) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [workerScript] } }
      }
    }
  }, null, 2)}\n`);
}

async function setupMission({ fakeNpmSource, withLock = true, workerSource = null }) {
  const files = { 'package.json': packageJson, 'src/a.txt': 'before\n' };
  if (withLock) files['package-lock.json'] = packageLock;
  const fixture = await createGitRepo({ files });
  const marker = path.join(fixture.root, 'bootstrap-marker.txt');
  const workerMarker = path.join(fixture.root, 'worker-marker.txt');
  const fakeBin = await installFakeNpm(fixture.root, fakeNpmSource || `
const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('10.0.0'); process.exit(0); }
if (process.env.BOOTSTRAP_SECRET_TEST) process.exit(41);
if (process.env.BOOTSTRAP_ALLOWED_TEST !== 'allowed-value') process.exit(42);
fs.appendFileSync(process.env.BOOTSTRAP_MARKER, 'run\\n');
`);
  const worker = path.join(fixture.root, 'worker.cjs');
  await fs.writeFile(worker, workerSource || `
const fs=require('node:fs'),p=require('node:path');
if(!fs.existsSync(${JSON.stringify(marker)})) process.exit(51);
fs.writeFileSync(${JSON.stringify(workerMarker)}, 'ran');
fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');
`);
  await configureWorker(fixture.stateRoot, worker);
  const previous = {
    PATH: process.env.PATH,
    secret: process.env.BOOTSTRAP_SECRET_TEST,
    allowed: process.env.BOOTSTRAP_ALLOWED_TEST,
    marker: process.env.BOOTSTRAP_MARKER
  };
  process.env.PATH = `${fakeBin}${path.delimiter}${previous.PATH || ''}`;
  process.env.BOOTSTRAP_SECRET_TEST = 'super-secret-bootstrap-value';
  process.env.BOOTSTRAP_ALLOWED_TEST = 'allowed-value';
  process.env.BOOTSTRAP_MARKER = marker;
  const restore = () => {
    if (previous.PATH === undefined) delete process.env.PATH; else process.env.PATH = previous.PATH;
    if (previous.secret === undefined) delete process.env.BOOTSTRAP_SECRET_TEST; else process.env.BOOTSTRAP_SECRET_TEST = previous.secret;
    if (previous.allowed === undefined) delete process.env.BOOTSTRAP_ALLOWED_TEST; else process.env.BOOTSTRAP_ALLOWED_TEST = previous.allowed;
    if (previous.marker === undefined) delete process.env.BOOTSTRAP_MARKER; else process.env.BOOTSTRAP_MARKER = previous.marker;
  };
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.services.projectService.open({ repoPath: fixture.repo });
  const planned = await app.services.missionService.plan({
    projectId: project.id,
    goal: 'prepare then change',
    doneDefinition: 'worker ran after bootstrap',
    tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
  });
  return { ...fixture, app, project, missionId: planned.mission.id, marker, workerMarker, restore };
}

const fullAuthorization = {
  execute: true,
  allowNetwork: true,
  allowThirdPartyCode: true,
  envAllowlist: ['BOOTSTRAP_ALLOWED_TEST', 'BOOTSTRAP_MARKER']
};

test('authorized mission bootstrap runs in the isolated task worktree before the worker and request replay is idempotent', async () => {
  const fixture = await setupMission({});
  try {
    assert.equal(fixture.project.bootstrapPlan.status, 'planned');
    assert.deepEqual(fixture.project.bootstrapPlan.steps[0].command, ['npm', 'ci']);
    const args = { requestId: 'bootstrap-exec-1', missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: fullAuthorization };
    const first = await fixture.app.callTool('mission_execute', args);
    assert.equal(first.results[0].ok, true);
    assert.equal(first.results[0].bootstrap.status, 'completed');
    assert.ok(first.results[0].bootstrapEvidenceId);
    assert.equal((await fs.readFile(fixture.marker, 'utf8')).trim(), 'run');
    assert.equal(await fs.readFile(fixture.workerMarker, 'utf8'), 'ran');

    const bootstrapEvidence = await fixture.app.services.evidenceService.query({ missionId: fixture.missionId, taskId: 'T1', type: 'bootstrap' });
    assert.equal(bootstrapEvidence.length, 1);
    assert.doesNotMatch(JSON.stringify(bootstrapEvidence[0]), /super-secret-bootstrap-value/);
    const replay = await fixture.app.callTool('mission_execute', args);
    assert.deepEqual(replay, first);
    assert.equal((await fs.readFile(fixture.marker, 'utf8')).trim(), 'run', 'idempotent replay must not execute bootstrap twice');
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('mission execution remains backward compatible and never bootstraps without explicit authorization', async () => {
  const fixture = await setupMission({ workerSource: `
const fs=require('node:fs'),p=require('node:path');
fs.writeFileSync(${JSON.stringify('WORKER_MARKER_PLACEHOLDER')}, 'ran');
fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');
` });
  try {
    const worker = path.join(fixture.root, 'worker.cjs');
    const current = await fs.readFile(worker, 'utf8');
    await fs.writeFile(worker, current.replace('WORKER_MARKER_PLACEHOLDER', fixture.workerMarker.replaceAll('\\', '\\\\')));
    const result = await fixture.app.callTool('mission_execute', { requestId: 'bootstrap-no-auth', missionId: fixture.missionId, runWorkers: true });
    assert.equal(result.results[0].ok, true);
    await assert.rejects(fs.readFile(fixture.marker, 'utf8'), (error) => error.code === 'ENOENT');
    assert.equal((await fixture.app.services.evidenceService.query({ missionId: fixture.missionId, type: 'bootstrap' })).length, 0);
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('bootstrap authorization fails closed on network and third-party-code risk classes before running npm', async () => {
  for (const [requestId, authorization, expectedCode] of [
    ['bootstrap-network-gate', { execute: true, allowNetwork: false, allowThirdPartyCode: true, envAllowlist: ['BOOTSTRAP_MARKER'] }, 'BOOTSTRAP_NETWORK_AUTHORIZATION_REQUIRED'],
    ['bootstrap-code-gate', { execute: true, allowNetwork: true, allowThirdPartyCode: false, envAllowlist: ['BOOTSTRAP_MARKER'] }, 'BOOTSTRAP_THIRD_PARTY_CODE_AUTHORIZATION_REQUIRED']
  ]) {
    const fixture = await setupMission({});
    try {
      const result = await fixture.app.callTool('mission_execute', { requestId, missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: authorization });
      assert.equal(result.results.length, 0);
      assert.equal(result.preparationFailures[0].code, expectedCode);
      await assert.rejects(fs.readFile(fixture.marker, 'utf8'), (error) => error.code === 'ENOENT');
      await assert.rejects(fs.readFile(fixture.workerMarker, 'utf8'), (error) => error.code === 'ENOENT');
      const failures = await fixture.app.services.evidenceService.query({ missionId: fixture.missionId, taskId: 'T1', type: 'bootstrap-failure' });
      assert.equal(failures.length, 1);
      assert.match(failures[0].summary, new RegExp(expectedCode));
    } finally {
      fixture.restore();
      await cleanup(fixture.root);
    }
  }
});

test('manual-only bootstrap plans are never auto-executed even with broad authorization', async () => {
  const fixture = await setupMission({ withLock: false });
  try {
    assert.equal(fixture.project.bootstrapPlan.status, 'manual');
    const result = await fixture.app.callTool('mission_execute', { requestId: 'bootstrap-manual', missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: fullAuthorization });
    assert.equal(result.results.length, 0);
    assert.equal(result.preparationFailures[0].code, 'BOOTSTRAP_MANUAL_REQUIRED');
    await assert.rejects(fs.readFile(fixture.marker, 'utf8'), (error) => error.code === 'ENOENT');
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('bootstrap step failure is recorded without persisting package-manager stderr or parent secrets', async () => {
  const fixture = await setupMission({ fakeNpmSource: `
if (process.argv[2] === '--version') { console.log('10.0.0'); process.exit(0); }
console.error('registry-error super-secret-bootstrap-value');
process.exit(9);
` });
  try {
    const result = await fixture.app.callTool('mission_execute', { requestId: 'bootstrap-failure', missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: fullAuthorization });
    assert.equal(result.results.length, 0);
    assert.equal(result.preparationFailures[0].code, 'BOOTSTRAP_STEP_FAILED');
    const failures = await fixture.app.services.evidenceService.query({ missionId: fixture.missionId, taskId: 'T1', type: 'bootstrap-failure' });
    assert.equal(failures.length, 1);
    assert.doesNotMatch(JSON.stringify(failures[0]), /registry-error|super-secret-bootstrap-value/);
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('bootstrap rejects repository-visible mutation before any worker starts', async () => {
  const fixture = await setupMission({ fakeNpmSource: `
const fs=require('node:fs');
if (process.argv[2] === '--version') { console.log('10.0.0'); process.exit(0); }
fs.writeFileSync('package-lock.json', fs.readFileSync('package-lock.json','utf8') + ' ');
` });
  try {
    const result = await fixture.app.callTool('mission_execute', { requestId: 'bootstrap-mutation', missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: fullAuthorization });
    assert.equal(result.results.length, 0);
    assert.equal(result.preparationFailures[0].code, 'BOOTSTRAP_WORKTREE_MUTATION');
    await assert.rejects(fs.readFile(fixture.workerMarker, 'utf8'), (error) => error.code === 'ENOENT');
    assert.equal(await fs.readFile(path.join(fixture.repo, 'package-lock.json'), 'utf8'), packageLock, 'source checkout remains untouched');
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('bootstrap authorization is validated before mission admission and dispatch-only mode cannot execute it', async () => {
  const fixture = await setupMission({});
  try {
    await assert.rejects(
      fixture.app.callTool('mission_execute', { requestId: 'bootstrap-bad-env', missionId: fixture.missionId, runWorkers: true, bootstrapAuthorization: { execute: true, allowNetwork: true, allowThirdPartyCode: true, envAllowlist: ['BAD=NAME'] } }),
      (error) => error.code === 'BOOTSTRAP_AUTHORIZATION_INVALID'
    );
    await assert.rejects(
      fixture.app.callTool('mission_execute', { requestId: 'bootstrap-dispatch-only', missionId: fixture.missionId, runWorkers: false, bootstrapAuthorization: fullAuthorization }),
      (error) => error.code === 'BOOTSTRAP_EXECUTION_REQUIRES_RUN_WORKERS'
    );
    const status = await fixture.app.services.missionService.status({ missionId: fixture.missionId });
    assert.equal(status.tasks[0].status, 'planned');
    assert.equal(status.tasks[0].dispatches.length, 0);
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('authorized bootstrap refreshes host readiness before execution instead of trusting the project-open snapshot', async () => {
  const fixture = await createGitRepo({ files: { 'package.json': packageJson, 'package-lock.json': packageLock, 'src/a.txt': 'before\n' } });
  const markerFile = path.join(fixture.root, 'refresh-marker.txt');
  const fakeBin = await installFakeNpm(fixture.root, `
const fs=require('node:fs');
if (process.argv[2] === '--version') { console.log(fs.existsSync(${JSON.stringify(markerFile)}) ? '10.0.0' : '9.0.0'); process.exit(0); }
fs.appendFileSync(process.env.BOOTSTRAP_MARKER, 'run\\n');
`);
  const worker = path.join(fixture.root, 'worker.cjs');
  await fs.writeFile(worker, `const fs=require('node:fs'),p=require('node:path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');`);
  await configureWorker(fixture.stateRoot, worker);
  const previousPath = process.env.PATH;
  const previousMarker = process.env.BOOTSTRAP_MARKER;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath || ''}`;
  process.env.BOOTSTRAP_MARKER = path.join(fixture.root, 'bootstrap-refresh-ran.txt');
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    assert.equal(project.bootstrapPlan.status, 'blocked');
    await fs.writeFile(markerFile, 'host-tool-updated');
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'refresh readiness', doneDefinition: 'bootstrap uses current host', tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }] });
    const result = await app.callTool('mission_execute', {
      requestId: 'bootstrap-readiness-refresh', missionId: planned.mission.id, runWorkers: true,
      bootstrapAuthorization: { execute: true, allowNetwork: true, allowThirdPartyCode: true, envAllowlist: ['BOOTSTRAP_MARKER'] }
    });
    assert.equal(result.results[0].ok, true);
    assert.equal((await app.services.projectService.get(project.id)).bootstrapPlan.status, 'planned');
    assert.equal((await fs.readFile(process.env.BOOTSTRAP_MARKER, 'utf8')).trim(), 'run');
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousMarker === undefined) delete process.env.BOOTSTRAP_MARKER; else process.env.BOOTSTRAP_MARKER = previousMarker;
    await cleanup(fixture.root);
  }
});

test('bootstrap env allowlist cannot opt back into the real HOME or config-home boundary', async () => {
  const fixture = await setupMission({});
  try {
    await assert.rejects(
      fixture.app.callTool('mission_execute', {
        requestId: 'bootstrap-protected-home', missionId: fixture.missionId, runWorkers: true,
        bootstrapAuthorization: { execute: true, allowNetwork: true, allowThirdPartyCode: true, envAllowlist: ['HOME'] }
      }),
      (error) => error.code === 'BOOTSTRAP_AUTHORIZATION_INVALID'
    );
  } finally {
    fixture.restore();
    await cleanup(fixture.root);
  }
});

test('bootstrap executor timeout terminates the package-manager process tree', async () => {
  if (process.platform === 'win32') return;
  const fixture = await createGitRepo({ files: { 'package.json': packageJson, 'package-lock.json': packageLock } });
  const childPidFile = path.join(fixture.root, 'bootstrap-child.pid');
  const runner = path.join(fixture.root, 'hang.cjs');
  await fs.writeFile(runner, `
const fs=require('node:fs'),cp=require('node:child_process');
const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));
setInterval(()=>{},1000);
`);
  try {
    const executor = new ProjectBootstrapExecutor({ stepTimeoutMs: 1000 });
    const plan = {
      contract: 'veteran-project-bootstrap-plan-v1', status: 'planned', autoExecute: false, requiresAuthorization: true,
      steps: [{ id: 'test:hang', command: [process.execPath, runner], cwd: '.', network: false, reproducible: true, executesThirdPartyCode: false, requiresAuthorization: true, executionPolicy: 'approval-required' }], issues: []
    };
    await assert.rejects(
      executor.prepare({ worktreePath: fixture.repo, plan, authorization: { execute: true, allowNetwork: false, allowThirdPartyCode: false } }),
      (error) => error.code === 'BOOTSTRAP_STEP_TIMEOUT'
    );
    const childPid = Number(await fs.readFile(childPidFile, 'utf8'));
    assert.equal(
      await waitForProcessStopped(childPid, { timeoutMs: 2_000, pollMs: 50 }),
      true,
      'bootstrap timeout must not leave package-manager descendants running'
    );
  } finally {
    await cleanup(fixture.root);
  }
});