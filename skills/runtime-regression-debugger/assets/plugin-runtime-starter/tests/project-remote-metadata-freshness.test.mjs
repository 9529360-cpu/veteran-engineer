import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('project_open clears a removed local origin instead of retaining stale durable remote metadata', async () => {
  const fixture = await createGitRepo();
  try {
    const remoteUrl = 'https://example.invalid/acme/repo.git';
    await git(fixture.repo, ['remote', 'add', 'origin', remoteUrl]);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });

    const first = await app.callTool('project_open', {
      requestId: 'project-remote-present',
      repoPath: fixture.repo
    });
    assert.equal(first.remoteUrl, remoteUrl);

    await git(fixture.repo, ['remote', 'remove', 'origin']);

    const second = await app.callTool('project_open', {
      requestId: 'project-remote-removed',
      repoPath: fixture.repo
    });
    assert.equal(second.id, first.id, 'reopening the same repository must reuse project identity');
    assert.equal(second.remoteUrl, null, 'current absence of origin must clear stale remote metadata');

    const state = await app.store.read();
    assert.equal(Object.keys(state.projects).length, 1);
    assert.equal(state.projects[first.id].remoteUrl, null);
  } finally {
    await cleanup(fixture.root);
  }
});
