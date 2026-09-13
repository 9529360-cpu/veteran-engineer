import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { inspectProjectEnvironment } from '../src/project-environment.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const nodePackage = {
  name: 'sample-app',
  private: true,
  packageManager: 'pnpm@9.15.4',
  engines: { node: '>=20', pnpm: '>=9' },
  workspaces: ['apps/*', 'packages/*'],
  scripts: {
    dev: 'DO_NOT_PERSIST_THIS_COMMAND --token=secret',
    start: 'node server.js',
    'test:e2e': 'playwright test',
    lint: 'eslint .',
    build: 'next build'
  }
};

test('environment inspection recovers root toolchain evidence without persisting command bodies or env secrets', async () => {
  const { root, repo } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify(nodePackage, null, 2)}\n`,
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
    'Dockerfile': 'FROM node:22\n',
    'compose.dev.yaml': 'services: {}\n',
    '.devcontainer/devcontainer.json': '{"name":"dev"}\n',
    '.env.example': 'DATABASE_URL=postgres://example\n',
    '.env.local': 'REAL_SECRET=do-not-read\n',
    '.nvmrc': '22\n'
  }});
  try {
    const profile = await inspectProjectEnvironment(repo);
    assert.equal(profile.contract, 'veteran-project-environment-v1');
    assert.deepEqual(profile.runtimeFamilies, ['node']);
    assert.equal(profile.packageManagers.node.selected, 'pnpm');
    assert.equal(profile.packageManagers.node.declared.version, '9.15.4');
    assert.deepEqual(profile.node.startScriptNames, ['dev', 'start']);
    assert.deepEqual(profile.node.validationScriptNames, ['build', 'lint', 'test:e2e']);
    assert.equal(profile.node.engines.node, '>=20');
    assert.equal(profile.monorepo.detected, true);
    assert.deepEqual(profile.container.dockerfiles, ['Dockerfile']);
    assert.deepEqual(profile.container.composeFiles, ['compose.dev.yaml']);
    assert.equal(profile.container.devcontainer, true);
    assert.deepEqual(profile.envTemplates, ['.env.example']);
    assert.deepEqual(profile.versionHints, [{ path: '.nvmrc', value: '22' }]);
    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /DO_NOT_PERSIST_THIS_COMMAND/);
    assert.doesNotMatch(serialized, /REAL_SECRET/);
    assert.doesNotMatch(serialized, /DATABASE_URL/);
  } finally {
    await cleanup(root);
  }
});

test('environment inspection reports conflicting Node package-manager evidence instead of guessing', async () => {
  const { root, repo } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({ packageManager: 'pnpm@9.0.0', scripts: {} })}\n`,
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'yarn.lock': '# yarn lock\n'
  }});
  try {
    const profile = await inspectProjectEnvironment(repo);
    assert.equal(profile.packageManagers.node.selected, null);
    assert.equal(profile.packageManagers.node.ambiguous, true);
    assert.deepEqual(profile.packageManagers.node.lockfileCandidates, ['pnpm', 'yarn']);
  } finally {
    await cleanup(root);
  }
});

test('environment inspection identifies polyglot build families from repository-root manifests', async () => {
  const { root, repo } = await createGitRepo({ files: {
    'pyproject.toml': '[project]\nname="api"\n',
    'uv.lock': 'version = 1\n',
    'go.mod': 'module example.invalid/service\n',
    'Cargo.toml': '[package]\nname="worker"\nversion="0.1.0"\n',
    'pom.xml': '<project/>\n'
  }});
  try {
    const profile = await inspectProjectEnvironment(repo);
    assert.deepEqual(profile.runtimeFamilies, ['python', 'go', 'rust', 'jvm']);
    assert.deepEqual(profile.packageManagers.python, ['uv']);
    assert.deepEqual(profile.packageManagers.jvmBuildTools, ['maven']);
  } finally {
    await cleanup(root);
  }
});

test('project_open persists an environment profile and project_snapshot refreshes it after repository change', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({ packageManager: 'npm@10.8.2', scripts: { test: 'node --test' } })}\n`,
    'package-lock.json': '{"lockfileVersion":3}\n'
  }});
  try {
    const app = await createVeteranApp({ stateRoot });
    const opened = await app.services.projectService.open({ repoPath: repo });
    assert.equal(opened.environmentProfile.packageManagers.node.selected, 'npm');
    assert.deepEqual(opened.environmentProfile.node.validationScriptNames, ['test']);

    await fs.writeFile(path.join(repo, 'go.mod'), 'module example.invalid/later\n');
    await git(repo, ['add', 'go.mod']);
    await git(repo, ['commit', '-q', '-m', 'add go module']);
    const snap = await app.services.projectService.snapshot({ projectId: opened.id });
    assert.deepEqual(snap.environmentProfile.runtimeFamilies, ['node', 'go']);
    assert.equal(snap.sourceIdentity.head, (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim());
  } finally {
    await cleanup(root);
  }
});

test('malformed package metadata degrades to bounded warnings instead of blocking repository takeover', async () => {
  const { root, repo } = await createGitRepo({ files: {
    'package.json': '{ not-json',
    'package-lock.json': '{"lockfileVersion":3}\n'
  }});
  try {
    const profile = await inspectProjectEnvironment(repo);
    assert.equal(profile.packageManagers.node.selected, 'npm');
    assert.equal(profile.node, null);
    assert.deepEqual(profile.warnings, [{ code: 'ENVIRONMENT_PACKAGE_JSON_INVALID', path: 'package.json' }]);
  } finally {
    await cleanup(root);
  }
});

test('environment inspection ignores symlinked project metadata rather than following repository-external state', async () => {
  const { root, repo } = await createGitRepo();
  try {
    const external = path.join(root, 'external-package.json');
    await fs.writeFile(external, JSON.stringify({ scripts: { dev: 'leak-secret-command' } }));
    await fs.symlink(external, path.join(repo, 'package.json'));
    const profile = await inspectProjectEnvironment(repo);
    assert.equal(profile.node, null);
    assert.deepEqual(profile.runtimeFamilies, []);
    assert.deepEqual(profile.warnings, [{ code: 'ENVIRONMENT_SYMLINK_IGNORED', path: 'package.json' }]);
    assert.doesNotMatch(JSON.stringify(profile), /leak-secret-command/);
  } finally {
    await cleanup(root);
  }
});
