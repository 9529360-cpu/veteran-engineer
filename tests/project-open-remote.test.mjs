import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createVeteranApp } from '../src/app.mjs';
import { git, runProcess } from '../src/git.mjs';
import { acquireRemoteRepository, normalizeRemoteRepositoryUrl } from '../src/repository-acquisition.mjs';
import { cleanup, createGitRepo, tempDir } from './helpers.mjs';

async function createBareRemote(sourceRepo, root) {
  const remote = path.join(root, 'remote.git');
  await runProcess('git', ['clone', '--bare', sourceRepo, remote], { cwd: root });
  return { remote, url: pathToFileURL(remote).href };
}

test('project_open acquires a remote repository into a runtime-managed checkout and reuses it', async () => {
  const fixture = await createGitRepo();
  try {
    const remote = await createBareRemote(fixture.repo, fixture.root);
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
      projects: { [remote.url]: { requireValidation: true, requiredValidationCapabilities: ['remote-smoke'] } }
    }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const first = await app.callTool('project_open', {
      requestId: 'remote-open-1',
      repoUrl: remote.url
    });
    assert.equal(first.sourceKind, 'managed-remote');
    assert.equal(first.managedCheckout, true);
    assert.equal(first.checkout.managed, true);
    assert.equal(first.checkout.reused, false);
    assert.equal(first.sourceIdentity.head, fixture.head);
    assert.ok(first.repoPath.startsWith(path.join(fixture.stateRoot, 'projects')));
    assert.equal(first.remoteUrl, remote.url);
    assert.equal(first.requireValidation, true);
    assert.deepEqual(first.requiredValidationCapabilities, ['remote-smoke']);

    const second = await app.callTool('project_open', {
      requestId: 'remote-open-2',
      repoUrl: remote.url
    });
    assert.equal(second.id, first.id);
    assert.equal(second.repoPath, first.repoPath);
    assert.equal(second.checkout.reused, true);
    const state = await app.store.read();
    assert.equal(Object.values(state.projects).length, 1);
    assert.equal(state.projects[first.id].managedCheckout, true);
  } finally {
    await cleanup(fixture.root);
  }
});

test('managed remote checkout fast-forwards to the tracked origin on a later open', async () => {
  const fixture = await createGitRepo();
  try {
    const remote = await createBareRemote(fixture.repo, fixture.root);
    const branch = (await git(fixture.repo, ['branch', '--show-current'])).stdout.trim();
    await git(fixture.repo, ['remote', 'add', 'origin', remote.url]);
    await git(fixture.repo, ['push', '-u', 'origin', branch]);

    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const first = await app.callTool('project_open', { requestId: 'remote-refresh-1', repoUrl: remote.url });

    await fs.writeFile(path.join(fixture.repo, 'next.txt'), 'next\n');
    await git(fixture.repo, ['add', 'next.txt']);
    await git(fixture.repo, ['commit', '-q', '-m', 'next']);
    await git(fixture.repo, ['push', 'origin', branch]);
    const nextHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();

    const second = await app.callTool('project_open', { requestId: 'remote-refresh-2', repoUrl: remote.url });
    assert.notEqual(nextHead, first.sourceIdentity.head);
    assert.equal(second.sourceIdentity.head, nextHead);
    assert.equal(second.checkout.reused, true);
    assert.equal(second.checkout.refreshed, true);
  } finally {
    await cleanup(fixture.root);
  }
});

test('managed remote checkout refuses to refresh a dirty or locally diverged source checkout', async () => {
  const fixture = await createGitRepo();
  try {
    const remote = await createBareRemote(fixture.repo, fixture.root);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const opened = await app.callTool('project_open', { requestId: 'remote-dirty-1', repoUrl: remote.url });
    await fs.writeFile(path.join(opened.repoPath, 'dirty.txt'), 'dirty\n');
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-dirty-2', repoUrl: remote.url }),
      (error) => error.code === 'PROJECT_REMOTE_CHECKOUT_DIRTY'
    );

    await fs.rm(path.join(opened.repoPath, 'dirty.txt'));
    await git(opened.repoPath, ['config', 'user.name', 'Veteran Test']);
    await git(opened.repoPath, ['config', 'user.email', 'veteran-test@example.invalid']);
    await fs.writeFile(path.join(opened.repoPath, 'local.txt'), 'local\n');
    await git(opened.repoPath, ['add', 'local.txt']);
    await git(opened.repoPath, ['commit', '-q', '-m', 'local-only']);
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-diverged-1', repoUrl: remote.url }),
      (error) => error.code === 'PROJECT_REMOTE_CHECKOUT_DIVERGED'
    );
  } finally {
    await cleanup(fixture.root);
  }
});

test('remote onboarding rejects ambiguous or credential-bearing repository sources', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-invalid-none' }),
      (error) => error.code === 'PROJECT_SOURCE_INVALID'
    );
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-invalid-both', repoPath: fixture.repo, repoUrl: 'https://github.com/example/repo.git' }),
      (error) => error.code === 'PROJECT_SOURCE_INVALID'
    );
    assert.throws(
      () => normalizeRemoteRepositoryUrl('https://token:secret@github.com/example/repo.git'),
      (error) => error.code === 'PROJECT_REMOTE_URL_CREDENTIALS_FORBIDDEN'
    );
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-secret-url', repoUrl: 'https://token:secret@github.com/example/repo.git' }),
      (error) => error.code === 'PROJECT_REMOTE_URL_CREDENTIALS_FORBIDDEN'
    );
    const afterSecretRejection = await app.store.read();
    assert.equal(JSON.stringify(afterSecretRejection).includes('token:secret'), false);
    assert.match(afterSecretRejection.requests['remote-secret-url'].fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.throws(
      () => normalizeRemoteRepositoryUrl('ext::sh -c exploit'),
      (error) => error.code === 'PROJECT_REMOTE_URL_UNSUPPORTED'
    );
  } finally {
    await cleanup(fixture.root);
  }
});

test('project state redacts credentials from an existing local origin URL', async () => {
  const fixture = await createGitRepo();
  try {
    await git(fixture.repo, ['remote', 'add', 'origin', 'https://user:secret@example.com/acme/repo.git']);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'local-origin-redaction',
      repoPath: fixture.repo
    });
    assert.equal(project.remoteUrl, 'https://example.com/acme/repo.git');
    const state = await app.store.read();
    assert.equal(state.projects[project.id].remoteUrl, 'https://example.com/acme/repo.git');
    assert.equal(JSON.stringify(state).includes('secret'), false);
  } finally {
    await cleanup(fixture.root);
  }
});

test('concurrent remote acquisition serializes one managed checkout', async () => {
  const fixture = await createGitRepo();
  const root = await tempDir('veteran-managed-acquire-');
  try {
    const remote = await createBareRemote(fixture.repo, fixture.root);
    const managedRoot = path.join(root, 'projects');
    const [left, right] = await Promise.all([
      acquireRemoteRepository({ repoUrl: remote.url, managedRoot }),
      acquireRemoteRepository({ repoUrl: remote.url, managedRoot })
    ]);
    assert.equal(left.repoPath, right.repoPath);
    assert.equal([left.reused, right.reused].filter(Boolean).length, 1);
    assert.equal((await git(left.repoPath, ['status', '--porcelain'])).stdout.trim(), '');
  } finally {
    await cleanup(root);
    await cleanup(fixture.root);
  }
});
