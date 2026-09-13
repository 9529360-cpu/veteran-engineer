import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { assessProjectEnvironmentReadiness, evaluateVersionRequirement } from '../src/project-environment-readiness.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function baseProfile(overrides = {}) {
  return {
    contract: 'veteran-project-environment-v1',
    runtimeFamilies: ['node'],
    manifests: [{ path: 'package.json', kind: 'node-package' }, { path: 'pnpm-lock.yaml', kind: 'node-lock-pnpm' }],
    packageManagers: {
      node: { selected: 'pnpm', declared: { name: 'pnpm', version: '9.15.4', source: 'package.json#packageManager' }, lockfileCandidates: ['pnpm'], ambiguous: false },
      python: [],
      jvmBuildTools: []
    },
    node: { engines: { node: '>=20 <23' }, scriptNames: ['test'], startScriptNames: [], validationScriptNames: ['test'], workspaces: false },
    container: { dockerfiles: [], composeFiles: [], devcontainer: false },
    monorepo: { detected: false, markers: [] },
    envTemplates: [],
    versionHints: [],
    warnings: [],
    ...overrides
  };
}

function fakeProbe(table, calls) {
  return async (spec) => {
    calls.push(spec.id);
    return table[spec.id] || { available: false, exitCode: null, version: null, reason: 'not-found' };
  };
}

test('bounded version evaluator handles common exact, wildcard, comparison, caret, and tilde requirements', () => {
  assert.equal(evaluateVersionRequirement('v22.4.1', '>=20 <23').matches, true);
  assert.equal(evaluateVersionRequirement('22.4.1', '22.x').matches, true);
  assert.equal(evaluateVersionRequirement('22.4.1', '^22.1.0').matches, true);
  assert.equal(evaluateVersionRequirement('22.4.1', '~22.4.0').matches, true);
  assert.equal(evaluateVersionRequirement('22.4.1', '~22').matches, true);
  assert.equal(evaluateVersionRequirement('0.2.9', '^0.2.3').matches, true);
  assert.equal(evaluateVersionRequirement('0.3.0', '^0.2.3').matches, false);
  assert.equal(evaluateVersionRequirement('21.9.0', '22').matches, false);
  assert.equal(evaluateVersionRequirement('22.4.1', '>=20 || ^18').supported, false);
  assert.equal(evaluateVersionRequirement('22.4.1', 'lts/*').supported, false);
});

test('environment readiness reports a ready Node host when runtime and selected package manager satisfy repository evidence', async () => {
  const calls = [];
  const readiness = await assessProjectEnvironmentReadiness(baseProfile(), {
    cwd: process.cwd(),
    surfaceProfile: 'local-stdio',
    probe: fakeProbe({
      node: { available: true, exitCode: 0, version: '22.4.1', reason: 'ok' },
      'node-package-manager:pnpm': { available: true, exitCode: 0, version: '9.15.4', reason: 'ok' }
    }, calls)
  });
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.usable, true);
  assert.equal(readiness.verified, true);
  assert.deepEqual(calls, ['node', 'node-package-manager:pnpm']);
  assert.deepEqual(readiness.issues, []);
});

test('environment readiness blocks on known version mismatch or missing selected package manager', async () => {
  const readiness = await assessProjectEnvironmentReadiness(baseProfile(), {
    probe: async (spec) => spec.id === 'node'
      ? { available: true, exitCode: 0, version: '18.20.4', reason: 'ok' }
      : { available: false, exitCode: null, version: null, reason: 'not-found' }
  });
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.usable, false);
  assert.deepEqual(readiness.issues.map((item) => item.code).sort(), ['HOST_TOOL_MISSING', 'HOST_TOOL_VERSION_MISMATCH']);
});

test('environment readiness refuses to guess an ambiguous Node package manager and does not probe either candidate', async () => {
  const calls = [];
  const profile = baseProfile({
    packageManagers: {
      node: { selected: null, declared: { name: 'pnpm', version: '9.15.4' }, lockfileCandidates: ['pnpm', 'yarn'], ambiguous: true },
      python: [],
      jvmBuildTools: []
    }
  });
  const readiness = await assessProjectEnvironmentReadiness(profile, {
    probe: fakeProbe({ node: { available: true, exitCode: 0, version: '22.4.1', reason: 'ok' } }, calls)
  });
  assert.equal(readiness.status, 'blocked');
  assert.deepEqual(calls, ['node']);
  assert.equal(readiness.issues[0].code, 'HOST_PACKAGE_MANAGER_AMBIGUOUS');
});

test('unsupported version grammar and unavailable Docker are explicit degraded evidence rather than guessed blockers', async () => {
  const calls = [];
  const profile = baseProfile({
    node: { engines: { node: '>=20 || ^18' }, scriptNames: [], startScriptNames: [], validationScriptNames: [], workspaces: false },
    packageManagers: { node: { selected: null, declared: null, lockfileCandidates: [], ambiguous: false }, python: [], jvmBuildTools: [] },
    container: { dockerfiles: ['Dockerfile'], composeFiles: [], devcontainer: false }
  });
  const readiness = await assessProjectEnvironmentReadiness(profile, {
    probe: fakeProbe({ node: { available: true, exitCode: 0, version: '22.4.1', reason: 'ok' } }, calls)
  });
  assert.equal(readiness.status, 'degraded');
  assert.equal(readiness.usable, true);
  assert.ok(readiness.issues.some((item) => item.code === 'HOST_TOOL_REQUIREMENT_UNVERIFIED'));
  assert.ok(readiness.issues.some((item) => item.code === 'HOST_PACKAGE_MANAGER_UNRESOLVED'));
  const dockerIssue = readiness.issues.find((item) => item.tool === 'docker');
  assert.equal(dockerIssue.severity, 'warning');
  assert.deepEqual(calls, ['node', 'docker-cli']);
});



test('python requirements verify pip through the resolved interpreter instead of assuming pip exists', async () => {
  const calls = [];
  const profile = baseProfile({
    runtimeFamilies: ['python'],
    manifests: [{ path: 'requirements.txt', kind: 'python-requirements' }],
    packageManagers: { node: null, python: ['pip'], jvmBuildTools: [] },
    node: null,
    versionHints: [{ path: '.python-version', value: '3.12' }]
  });
  const readiness = await assessProjectEnvironmentReadiness(profile, {
    probe: async (spec) => {
      calls.push({ id: spec.id, command: spec.command, args: spec.args });
      if (spec.id === 'python') return { available: true, exitCode: 0, version: '3.12.8', reason: 'ok' };
      if (spec.id === 'python-package-manager:pip') return { available: false, exitCode: 1, version: null, reason: 'nonzero-exit' };
      return { available: false, exitCode: null, version: null, reason: 'not-found' };
    }
  });
  assert.equal(readiness.status, 'blocked');
  assert.ok(readiness.issues.some((item) => item.code === 'HOST_TOOL_MISSING' && item.tool === 'pip'));
  const pipCall = calls.find((item) => item.id === 'python-package-manager:pip');
  assert.equal(pipCall.command, 'python3');
  assert.deepEqual(pipCall.args, ['-m', 'pip', '--version']);
});

test('project_open persists host readiness and project_snapshot refreshes known Node version compatibility', async () => {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({ private: true, scripts: { test: 'node --test' } }, null, 2)}\n`,
    '.nvmrc': `${nodeMajor}\n`
  } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const opened = await app.services.projectService.open({ repoPath: repo });
    assert.equal(opened.environmentReadiness.contract, 'veteran-project-environment-readiness-v1');
    const nodeCheck = opened.environmentReadiness.checks.find((item) => item.id === 'node');
    assert.equal(nodeCheck.available, true);
    assert.equal(nodeCheck.compatibility, 'match');
    assert.equal(opened.environmentReadiness.surfaceProfile, 'local-stdio');

    await fs.writeFile(path.join(repo, '.nvmrc'), '999\n');
    await git(repo, ['add', '.nvmrc']);
    await git(repo, ['commit', '-q', '-m', 'raise node requirement']);
    const snap = await app.services.projectService.snapshot({ projectId: opened.id });
    assert.equal(snap.environmentReadiness.status, 'blocked');
    assert.ok(snap.environmentReadiness.issues.some((item) => item.code === 'HOST_TOOL_VERSION_MISMATCH' && item.tool === 'node'));
  } finally {
    await cleanup(root);
  }
});
