import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CredentialBroker,
  EnvironmentCredentialProvider,
  normalizeCredentialReferences
} from '../src/credential-broker.mjs';
import { ProjectBootstrapExecutor, normalizeBootstrapAuthorization } from '../src/bootstrap-executor.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';
import { createVeteranApp } from '../src/app.mjs';

function plan(command) {
  return {
    contract: 'veteran-project-bootstrap-plan-v1',
    status: 'planned',
    autoExecute: false,
    requiresAuthorization: true,
    steps: [{
      id: 'credential:test',
      command,
      cwd: '.',
      network: false,
      reproducible: true,
      executesThirdPartyCode: false,
      requiresAuthorization: true,
      executionPolicy: 'approval-required'
    }],
    issues: []
  };
}

test('legacy envAllowlist is normalized into credential references without embedding secret values', () => {
  const previous = process.env.VETERAN_CREDENTIAL_LEGACY;
  process.env.VETERAN_CREDENTIAL_LEGACY = 'legacy-secret-value';
  try {
    const normalized = normalizeBootstrapAuthorization({ execute: true, envAllowlist: ['VETERAN_CREDENTIAL_LEGACY'] });
    assert.equal(normalized.contract, 'veteran-bootstrap-authorization-v1');
    assert.deepEqual(normalized.credentialRefs, [{
      contract: 'veteran-credential-reference-v1',
      provider: 'environment',
      name: 'VETERAN_CREDENTIAL_LEGACY',
      targetEnv: 'VETERAN_CREDENTIAL_LEGACY'
    }]);
    assert.doesNotMatch(JSON.stringify(normalized), /legacy-secret-value/);
    assert.deepEqual(normalizeBootstrapAuthorization(normalized), normalized, 'normalization must be idempotent across worker -> executor handoff');
  } finally {
    if (previous === undefined) delete process.env.VETERAN_CREDENTIAL_LEGACY;
    else process.env.VETERAN_CREDENTIAL_LEGACY = previous;
  }
});

test('credential broker resolves named references ephemerally and supports injected future providers', async () => {
  const calls = [];
  const broker = new CredentialBroker({ providers: {
    vault: {
      async resolve({ name, targetEnv }) {
        calls.push({ name, targetEnv });
        return 'vault-secret-value';
      }
    }
  } });
  const result = await broker.materialize([{ provider: 'vault', name: 'npm/read-token', targetEnv: 'NPM_TOKEN' }]);
  assert.deepEqual(result.targets, ['NPM_TOKEN']);
  assert.equal(result.env.NPM_TOKEN, 'vault-secret-value');
  assert.deepEqual(calls, [{ name: 'npm/read-token', targetEnv: 'NPM_TOKEN' }]);
});

test('environment provider fails closed for missing credentials and never substitutes empty values', async () => {
  const broker = new CredentialBroker({ providers: { environment: new EnvironmentCredentialProvider({ environment: {} }) } });
  await assert.rejects(
    broker.materialize([{ provider: 'environment', name: 'MISSING_TOKEN', targetEnv: 'NPM_TOKEN' }]),
    (error) => error.code === 'CREDENTIAL_NOT_AVAILABLE'
  );
});

test('credential references reject unknown providers, duplicate targets, and execution-control env targets', async () => {
  assert.throws(
    () => normalizeCredentialReferences([{ provider: 'environment', name: 'A', targetEnv: 'NODE_OPTIONS' }]),
    (error) => error.code === 'CREDENTIAL_TARGET_INVALID'
  );
  assert.throws(
    () => normalizeCredentialReferences([
      { provider: 'environment', name: 'A', targetEnv: 'NPM_TOKEN' },
      { provider: 'environment', name: 'B', targetEnv: 'NPM_TOKEN' }
    ]),
    (error) => error.code === 'CREDENTIAL_TARGET_DUPLICATE'
  );
  const broker = new CredentialBroker();
  await assert.rejects(
    broker.materialize([{ provider: 'missing-provider', name: 'A', targetEnv: 'NPM_TOKEN' }]),
    (error) => error.code === 'CREDENTIAL_PROVIDER_NOT_FOUND'
  );
});

test('bootstrap executor accepts credential references without persisting the secret in execution result or repository', async () => {
  const fixture = await createGitRepo({ files: { 'check.cjs': `
const fs=require('node:fs');
if(process.env.NPM_TOKEN !== 'ephemeral-token-value') process.exit(23);
fs.writeFileSync(process.env.OUTSIDE_MARKER, 'ok');
` } });
  const marker = path.join(fixture.root, 'credential-used.txt');
  const previousToken = process.env.VETERAN_NPM_TOKEN;
  const previousMarker = process.env.OUTSIDE_MARKER;
  process.env.VETERAN_NPM_TOKEN = 'ephemeral-token-value';
  process.env.OUTSIDE_MARKER = marker;
  try {
    const executor = new ProjectBootstrapExecutor();
    const result = await executor.prepare({
      worktreePath: fixture.repo,
      plan: plan([process.execPath, 'check.cjs']),
      authorization: {
        execute: true,
        credentialRefs: [
          { provider: 'environment', name: 'VETERAN_NPM_TOKEN', targetEnv: 'NPM_TOKEN' },
          { provider: 'environment', name: 'OUTSIDE_MARKER', targetEnv: 'OUTSIDE_MARKER' }
        ]
      }
    });
    assert.equal(result.status, 'completed');
    assert.equal(await fs.readFile(marker, 'utf8'), 'ok');
    assert.doesNotMatch(JSON.stringify(result), /ephemeral-token-value/);
    const repoFiles = await fs.readdir(fixture.repo);
    assert.equal(repoFiles.includes('credential-used.txt'), false);
  } finally {
    if (previousToken === undefined) delete process.env.VETERAN_NPM_TOKEN; else process.env.VETERAN_NPM_TOKEN = previousToken;
    if (previousMarker === undefined) delete process.env.OUTSIDE_MARKER; else process.env.OUTSIDE_MARKER = previousMarker;
    await cleanup(fixture.root);
  }
});

test('bootstrap credential resolution failure happens before the package-manager command is started', async () => {
  const fixture = await createGitRepo({ files: { 'marker.cjs': `require('node:fs').writeFileSync('should-not-run.txt','ran')` } });
  try {
    const executor = new ProjectBootstrapExecutor({
      credentialBroker: new CredentialBroker({ providers: { environment: new EnvironmentCredentialProvider({ environment: {} }) } })
    });
    await assert.rejects(
      executor.prepare({
        worktreePath: fixture.repo,
        plan: plan([process.execPath, 'marker.cjs']),
        authorization: { execute: true, credentialRefs: [{ provider: 'environment', name: 'MISSING', targetEnv: 'NPM_TOKEN' }] }
      }),
      (error) => error.code === 'CREDENTIAL_NOT_AVAILABLE'
    );
    await assert.rejects(fs.readFile(path.join(fixture.repo, 'should-not-run.txt')), (error) => error.code === 'ENOENT');
  } finally {
    await cleanup(fixture.root);
  }
});


test('mission bootstrap resolves credential references without persisting the secret value in durable state or evidence', async () => {
  const secretValue = 'credential-plane-secret-value-9f4c';
  const fixture = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({ name: 'credential-mission', version: '1.0.0', packageManager: 'npm@10.0.0' }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify({ name: 'credential-mission', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'credential-mission', version: '1.0.0' } } }, null, 2)}\n`,
    'src/a.txt': 'before\n'
  } });
  const bin = path.join(fixture.root, 'fake-bin');
  await fs.mkdir(bin, { recursive: true });
  const npm = path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmSource = `
if (process.argv[2] === '--version') { console.log('10.0.0'); process.exit(0); }
if (process.env.NPM_TOKEN !== ${JSON.stringify(secretValue)}) process.exit(73);
`;
  if (process.platform === 'win32') {
    const script = path.join(bin, 'fake-npm.cjs');
    await fs.writeFile(script, npmSource);
    await fs.writeFile(npm, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    await fs.writeFile(npm, `#!${process.execPath}\n${npmSource}`);
    await fs.chmod(npm, 0o755);
  }
  const worker = path.join(fixture.root, 'worker.cjs');
  await fs.writeFile(worker, `const fs=require('node:fs'),p=require('node:path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');`);
  await fs.mkdir(fixture.stateRoot, { recursive: true });
  await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { workerPolicy: { enabled: true, maxWorkers: 1, workers: { default: { type: 'custom', command: process.execPath, args: [worker] } } } } }, null, 2)}\n`);

  const previousPath = process.env.PATH;
  const previousSecret = process.env.VETERAN_NPM_TOKEN;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  process.env.VETERAN_NPM_TOKEN = secretValue;
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'prove credential persistence boundary',
      doneDefinition: 'bootstrap and worker complete without secret persistence',
      tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const result = await app.callTool('mission_execute', {
      requestId: 'credential-plane-durable-boundary',
      missionId: planned.mission.id,
      runWorkers: true,
      bootstrapAuthorization: {
        execute: true,
        allowNetwork: true,
        allowThirdPartyCode: true,
        credentialRefs: [{ provider: 'environment', name: 'VETERAN_NPM_TOKEN', targetEnv: 'NPM_TOKEN' }]
      }
    });
    assert.equal(result.results[0].ok, true);
    const state = await app.store.read();
    const evidence = await app.services.evidenceService.query({ missionId: planned.mission.id });
    assert.doesNotMatch(JSON.stringify(state), new RegExp(secretValue));
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secretValue));
    const durableFiles = await fs.readdir(fixture.stateRoot);
    for (const name of durableFiles.filter((item) => item.endsWith('.json') || item.endsWith('.jsonl'))) {
      const text = await fs.readFile(path.join(fixture.stateRoot, name), 'utf8');
      assert.doesNotMatch(text, new RegExp(secretValue), `secret leaked into ${name}`);
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousSecret === undefined) delete process.env.VETERAN_NPM_TOKEN; else process.env.VETERAN_NPM_TOKEN = previousSecret;
    await cleanup(fixture.root);
  }
});
