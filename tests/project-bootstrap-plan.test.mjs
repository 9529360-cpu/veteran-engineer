import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { compileProjectBootstrapPlan } from '../src/project-bootstrap-plan.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function readiness(overrides = {}) {
  return {
    contract: 'veteran-project-environment-readiness-v1',
    status: 'ready',
    usable: true,
    verified: true,
    checks: [],
    issues: [],
    ...overrides
  };
}

function profile(overrides = {}) {
  return {
    contract: 'veteran-project-environment-v1',
    runtimeFamilies: ['node'],
    manifests: [
      { path: 'package.json', kind: 'node-package' },
      { path: 'pnpm-lock.yaml', kind: 'node-lock-pnpm' }
    ],
    packageManagers: {
      node: { selected: 'pnpm', declared: { name: 'pnpm', version: '9.15.4' }, lockfileCandidates: ['pnpm'], ambiguous: false },
      python: [],
      jvmBuildTools: []
    },
    node: { engines: {}, scriptNames: [], startScriptNames: [], validationScriptNames: [], workspaces: false },
    container: { dockerfiles: [], composeFiles: [], devcontainer: false },
    monorepo: { detected: false, markers: [] },
    envTemplates: [],
    versionHints: [],
    warnings: [],
    ...overrides
  };
}

test('bootstrap plan selects frozen pnpm install and never marks dependency installation for auto execution', () => {
  const plan = compileProjectBootstrapPlan(profile(), readiness({ checks: [{ id: 'node-package-manager:pnpm', version: '9.15.4', available: true }] }));
  assert.equal(plan.contract, 'veteran-project-bootstrap-plan-v1');
  assert.equal(plan.status, 'planned');
  assert.equal(plan.autoExecute, false);
  assert.equal(plan.requiresAuthorization, true);
  assert.deepEqual(plan.steps[0].command, ['pnpm', 'install', '--frozen-lockfile']);
  assert.equal(plan.steps[0].reproducible, true);
  assert.equal(plan.steps[0].requiresAuthorization, true);
  assert.equal(plan.steps[0].executesThirdPartyCode, true);
});

test('bootstrap plan refuses to guess ambiguous Node package-manager authority', () => {
  const p = profile({
    packageManagers: { node: { selected: null, declared: null, lockfileCandidates: ['pnpm', 'yarn'], ambiguous: true }, python: [], jvmBuildTools: [] }
  });
  const plan = compileProjectBootstrapPlan(p, readiness());
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.issues[0].code, 'BOOTSTRAP_PACKAGE_MANAGER_AMBIGUOUS');
});

test('bootstrap plan keeps missing-lock installs manual-only instead of pretending they are reproducible', () => {
  const p = profile({ manifests: [{ path: 'package.json', kind: 'node-package' }] });
  const plan = compileProjectBootstrapPlan(p, readiness());
  assert.equal(plan.status, 'manual');
  assert.deepEqual(plan.steps[0].command, ['pnpm', 'install']);
  assert.equal(plan.steps[0].reproducible, false);
  assert.equal(plan.steps[0].executionPolicy, 'manual-only');
  assert.ok(plan.issues.some((item) => item.code === 'BOOTSTRAP_LOCKFILE_MISSING'));
});

test('bootstrap plan selects Yarn generation-specific immutable/frozen lockfile behavior only with version evidence', () => {
  const p = profile({
    manifests: [{ path: 'package.json', kind: 'node-package' }, { path: 'yarn.lock', kind: 'node-lock-yarn' }],
    packageManagers: { node: { selected: 'yarn', declared: null, lockfileCandidates: ['yarn'], ambiguous: false }, python: [], jvmBuildTools: [] }
  });
  const berry = compileProjectBootstrapPlan(p, readiness({ checks: [{ id: 'node-package-manager:yarn', version: '4.2.0', available: true }] }));
  assert.deepEqual(berry.steps[0].command, ['yarn', 'install', '--immutable']);
  const classic = compileProjectBootstrapPlan(p, readiness({ checks: [{ id: 'node-package-manager:yarn', version: '1.22.22', available: true }] }));
  assert.deepEqual(classic.steps[0].command, ['yarn', 'install', '--frozen-lockfile']);
  const unknown = compileProjectBootstrapPlan(p, readiness());
  assert.equal(unknown.status, 'manual');
  assert.deepEqual(unknown.steps, []);
  assert.ok(unknown.issues.some((item) => item.code === 'BOOTSTRAP_YARN_GENERATION_UNVERIFIED'));
});

test('bootstrap plan blocks execution when host readiness is blocked even if a reproducible strategy exists', () => {
  const plan = compileProjectBootstrapPlan(profile(), readiness({ status: 'blocked', usable: false }));
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.steps.length === 1);
  assert.equal(plan.issues[0].code, 'BOOTSTRAP_HOST_NOT_READY');
});

test('bootstrap plan is conservative across Python, Rust, Go, and JVM ecosystems', () => {
  const p = profile({
    runtimeFamilies: ['python', 'rust', 'go', 'jvm'],
    manifests: [
      { path: 'requirements.txt', kind: 'python-requirements' },
      { path: 'Cargo.toml', kind: 'rust-cargo' },
      { path: 'Cargo.lock', kind: 'rust-lock' },
      { path: 'go.mod', kind: 'go-module' },
      { path: 'pom.xml', kind: 'jvm-maven' }
    ],
    packageManagers: { node: null, python: ['pip'], jvmBuildTools: ['maven'] },
    node: null
  });
  const plan = compileProjectBootstrapPlan(p, readiness());
  assert.equal(plan.status, 'manual');
  const rust = plan.steps.find((step) => step.id === 'rust:cargo');
  const go = plan.steps.find((step) => step.id === 'go:modules');
  assert.deepEqual(rust.command, ['cargo', 'fetch', '--locked']);
  assert.equal(rust.executesThirdPartyCode, false);
  assert.deepEqual(go.command, ['go', 'mod', 'download']);
  assert.equal(go.executionPolicy, 'manual-only');
  assert.ok(plan.issues.some((item) => item.code === 'BOOTSTRAP_PYTHON_INTERPRETER_INVOCATION_UNRESOLVED'));
  assert.ok(plan.issues.some((item) => item.code === 'BOOTSTRAP_STRATEGY_UNSUPPORTED' && item.owner === 'jvm'));
});

test('project_open persists bootstrap plan and project_snapshot refreshes it when lockfile authority changes', async () => {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmVersion = execFileSync(npmCommand, ['--version'], { encoding: 'utf8' }).trim();
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({ private: true, packageManager: `npm@${npmVersion}`, scripts: { test: 'node --test' } }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify({ lockfileVersion: 3 })}\n`
  } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const opened = await app.services.projectService.open({ repoPath: repo });
    assert.equal(opened.bootstrapPlan.contract, 'veteran-project-bootstrap-plan-v1');
    assert.equal(opened.bootstrapPlan.autoExecute, false);
    assert.deepEqual(opened.bootstrapPlan.steps[0].command, ['npm', 'ci']);

    await fs.rm(path.join(repo, 'package-lock.json'));
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-q', '-m', 'remove lockfile']);
    const snap = await app.services.projectService.snapshot({ projectId: opened.id });
    assert.equal(snap.bootstrapPlan.status, 'manual');
    assert.deepEqual(snap.bootstrapPlan.steps[0].command, ['npm', 'install']);
    assert.equal(snap.bootstrapPlan.steps[0].executionPolicy, 'manual-only');
  } finally {
    await cleanup(root);
  }
});
