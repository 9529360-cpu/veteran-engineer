import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { compileProjectCommandPlan } from '../src/project-command-plan.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function profile(overrides = {}) {
  return {
    contract: 'veteran-project-environment-v1',
    runtimeFamilies: ['node'],
    manifests: [
      { path: 'package.json', kind: 'node-package' },
      { path: 'package-lock.json', kind: 'node-lock-npm' }
    ],
    packageManagers: {
      node: { selected: 'npm', declared: null, lockfileCandidates: ['npm'], ambiguous: false },
      python: [],
      jvmBuildTools: []
    },
    node: {
      engines: {},
      scriptNames: ['build', 'check', 'dev', 'lint', 'test', 'test:e2e', 'typecheck'],
      startScriptNames: ['dev'],
      validationScriptNames: ['build', 'check', 'lint', 'test', 'test:e2e', 'typecheck'],
      workspaces: false
    },
    container: { dockerfiles: [], composeFiles: [], devcontainer: false },
    monorepo: { detected: false, markers: [] },
    envTemplates: [],
    versionHints: [],
    warnings: [],
    ...overrides
  };
}

function readiness(overrides = {}) {
  return {
    contract: 'veteran-project-environment-readiness-v1',
    status: 'ready',
    usable: true,
    verified: true,
    checks: [
      { id: 'node', available: true, compatibility: null },
      { id: 'node-package-manager:npm', available: true, compatibility: null }
    ],
    issues: [],
    ...overrides
  };
}

test('project command plan derives safe invocations from script names without persisting script bodies', () => {
  const plan = compileProjectCommandPlan(profile(), readiness(), { changedPaths: ['src/app.mjs'] });
  assert.equal(plan.contract, 'veteran-project-command-plan-v1');
  assert.equal(plan.autoExecute, false);
  assert.equal(plan.executionPolicy, 'caller-reviewed');
  assert.deepEqual(plan.start[0].command, ['npm', 'run', 'dev']);
  assert.deepEqual(plan.validation.minimal.map((item) => item.command), [['npm', 'run', 'check']]);
  assert.equal(plan.validation.minimal[0].source, 'package.json#scripts.check');
  assert.doesNotMatch(JSON.stringify(plan), /node --test|eslint|DO_NOT_PERSIST/);
});

test('unsafe package script names are discovered as metadata but never converted into invocations', () => {
  const p = profile({
    node: {
      engines: {},
      scriptNames: ['--help', 'safe:test'],
      startScriptNames: [],
      validationScriptNames: ['--help', 'safe:test'],
      workspaces: false
    }
  });
  const plan = compileProjectCommandPlan(p, readiness(), { changedPaths: ['src/app.mjs'] });
  assert.equal(plan.commands.some((item) => item.script === '--help'), false);
  assert.equal(plan.commands.some((item) => item.script === 'safe:test'), true);
  assert.ok(plan.issues.some((item) => item.code === 'COMMAND_SCRIPT_NAME_UNSAFE'));
});

test('minimal validation prefers typecheck plus unit test for source changes when no aggregate check exists', () => {
  const p = profile({
    node: {
      engines: {},
      scriptNames: ['build', 'lint', 'test', 'test:e2e', 'typecheck'],
      startScriptNames: [],
      validationScriptNames: ['build', 'lint', 'test', 'test:e2e', 'typecheck'],
      workspaces: false
    }
  });
  const plan = compileProjectCommandPlan(p, readiness(), { changedPaths: ['src/service.ts'] });
  assert.deepEqual(plan.validation.minimal.map((item) => item.script), ['typecheck', 'test']);
  assert.equal(plan.validation.broader.some((item) => item.script === 'test:e2e'), true);
});

test('test-file change chooses repository test script while documentation-only change stays command-free', () => {
  const p = profile({
    node: {
      engines: {},
      scriptNames: ['build', 'lint', 'test', 'test:e2e', 'typecheck'],
      startScriptNames: [],
      validationScriptNames: ['build', 'lint', 'test', 'test:e2e', 'typecheck'],
      workspaces: false
    }
  });
  const tests = compileProjectCommandPlan(p, readiness(), { changedPaths: ['tests/widget.test.mjs'] });
  assert.deepEqual(tests.validation.minimal.map((item) => item.script), ['test']);

  const docs = compileProjectCommandPlan(p, readiness(), { changedPaths: ['docs/architecture.md', 'README.md'] });
  assert.equal(docs.validation.status, 'ready');
  assert.equal(docs.validation.reason, 'documentation-only-change');
  assert.deepEqual(docs.validation.minimal, []);
});

test('dirty command authority fails closed instead of guessing from stale package metadata', () => {
  const plan = compileProjectCommandPlan(profile(), readiness(), { changedPaths: ['package.json', 'src/app.mjs'] });
  assert.equal(plan.authorityDirty, true);
  assert.equal(plan.status, 'degraded');
  assert.deepEqual(plan.validation.minimal, []);
  assert.ok(plan.issues.some((item) => item.code === 'COMMAND_AUTHORITY_DIRTY'));
});

test('command readiness follows the owning Node toolchain rather than unrelated polyglot blockers', () => {
  const degraded = readiness({ status: 'blocked', usable: false, issues: [{ code: 'HOST_TOOL_MISSING', tool: 'go' }] });
  const plan = compileProjectCommandPlan(profile(), degraded, { changedPaths: ['src/app.mjs'] });
  assert.equal(plan.commands.every((item) => item.runnable), true);
  assert.deepEqual(plan.validation.minimal.map((item) => item.script), ['check']);

  const npmMissing = readiness({
    checks: [
      { id: 'node', available: true, compatibility: null },
      { id: 'node-package-manager:npm', available: false, compatibility: null }
    ]
  });
  const blocked = compileProjectCommandPlan(profile(), npmMissing, { changedPaths: ['src/app.mjs'] });
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.validation.minimal, []);
  assert.ok(blocked.issues.some((item) => item.code === 'COMMAND_PACKAGE_MANAGER_NOT_READY'));
});

test('project snapshot refreshes minimal validation from dirty paths without persisting package script bodies', async () => {
  const secretScript = 'DO_NOT_PERSIST_THIS_COMMAND --token=secret';
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({
      private: true,
      scripts: {
        dev: secretScript,
        check: 'node --check src/app.mjs',
        test: 'node --test'
      }
    }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify({ lockfileVersion: 3 })}\n`,
    'src/app.mjs': 'export const value = 1;\n'
  } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const opened = await app.services.projectService.open({ repoPath: repo });
    assert.equal(opened.commandPlan.contract, 'veteran-project-command-plan-v1');
    assert.equal(opened.commandPlan.status, 'discovery-only');
    assert.deepEqual(opened.commandPlan.validation.minimal, []);
    assert.deepEqual(opened.commandPlan.start[0].command, ['npm', 'run', 'dev']);
    assert.doesNotMatch(JSON.stringify(opened.commandPlan), /DO_NOT_PERSIST_THIS_COMMAND|--token=secret/);

    await fs.writeFile(path.join(repo, 'src/app.mjs'), 'export const value = 2;\n');
    const changed = await app.services.projectService.snapshot({ projectId: opened.id });
    assert.deepEqual(changed.sourceIdentity.dirtyPaths, ['src/app.mjs']);
    assert.deepEqual(changed.commandPlan.validation.minimal.map((item) => item.script), ['check']);
    assert.deepEqual(changed.commandPlan.validation.minimal[0].command, ['npm', 'run', 'check']);

    const packagePath = path.join(repo, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    packageJson.scripts.verify = 'node --test';
    await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const authorityDirty = await app.services.projectService.snapshot({ projectId: opened.id });
    assert.equal(authorityDirty.commandPlan.authorityDirty, true);
    assert.deepEqual(authorityDirty.commandPlan.validation.minimal, []);
    assert.ok(authorityDirty.commandPlan.issues.some((item) => item.code === 'COMMAND_AUTHORITY_DIRTY'));
  } finally {
    await cleanup(root);
  }
});
