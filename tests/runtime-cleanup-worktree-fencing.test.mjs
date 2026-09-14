import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { RuntimeService } from '../src/runtime-service.mjs';
import { cleanup, createGitRepo, tempDir } from './helpers.mjs';

async function worktreeRegistered(repo, target) {
  const result = await git(repo, ['worktree', 'list', '--porcelain']);
  const normalized = path.resolve(target);
  return result.stdout.split(/\r?\n/).some((line) => {
    if (!line.startsWith('worktree ')) return false;
    return path.resolve(line.slice('worktree '.length)) === normalized;
  });
}

function emptyState() {
  return { requests: {}, projects: {}, missions: {}, tasks: {}, runtime: { candidates: {} } };
}

test('runtime_cleanup fences transient worktree removal while worktree-producing requests are unresolved', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    await app.callTool('project_open', {
      requestId: 'cleanup-worktree-project-blocked',
      repoPath: fixture.repo
    });
    const transient = path.join(app.store.worktreesDir, 'validation-race-test');
    await git(fixture.repo, ['worktree', 'add', '--detach', transient, fixture.head]);
    assert.equal(await worktreeRegistered(fixture.repo, transient), true);

    await app.store.transaction('test_seed_worktree_cleanup_blockers', (state) => {
      state.requests['mission-execute-unknown-test'] = {
        requestId: 'mission-execute-unknown-test',
        operation: 'mission_execute',
        fingerprint: 'test',
        status: 'unknown',
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        error: null
      };
      state.requests['validation-started-test'] = {
        requestId: 'validation-started-test',
        operation: 'validation_run',
        fingerprint: 'test',
        status: 'started',
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        error: null
      };
    });

    const result = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-worktree-blocked-apply',
      apply: true
    });

    assert.deepEqual(result.worktrees.blockers, [
      { requestId: 'mission-execute-unknown-test', operation: 'mission_execute', status: 'unknown' },
      { requestId: 'validation-started-test', operation: 'validation_run', status: 'started' }
    ]);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.worktrees.prunedProjects, []);
    await fs.access(transient);
    assert.equal(await worktreeRegistered(fixture.repo, transient), true, 'cleanup must not remove or prune an in-flight validation/mission worktree');
  } finally {
    await cleanup(fixture.root);
  }
});

test('runtime_cleanup rechecks durable worktree ownership immediately before deletion', async () => {
  const root = await tempDir('veteran-cleanup-worktree-race-');
  const taskPath = path.join(root, 'task-race');
  try {
    await fs.mkdir(taskPath, { recursive: true });
    const before = emptyState();
    const after = emptyState();
    after.tasks['mission:T1'] = {
      id: 'T1',
      missionId: 'mission',
      status: 'executing',
      dispatches: [{ worktreePath: taskPath }]
    };
    let reads = 0;
    const store = {
      worktreesDir: root,
      async read() {
        reads += 1;
        return reads === 1 ? before : after;
      }
    };
    const runtime = new RuntimeService({ store, experienceService: {} });

    const result = await runtime.cleanup({ apply: true });

    assert.deepEqual(result.orphans, ['task-race']);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.worktrees.skipped, [{ name: 'task-race', reason: 'now-referenced' }]);
    await fs.access(taskPath);
  } finally {
    await cleanup(root);
  }
});

test('runtime_cleanup prunes stale Git worktree registrations after filesystem cleanup is safe', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'cleanup-worktree-project-prune',
      repoPath: fixture.repo
    });
    const stale = path.join(app.store.worktreesDir, 'validation-stale-registration');
    await git(fixture.repo, ['worktree', 'add', '--detach', stale, fixture.head]);
    assert.equal(await worktreeRegistered(fixture.repo, stale), true);
    await fs.rm(stale, { recursive: true, force: true });
    assert.equal(await worktreeRegistered(fixture.repo, stale), true, 'manual directory removal should leave a stale Git worktree registration before prune');

    const result = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-worktree-prune-apply',
      apply: true
    });

    assert.equal(result.worktrees.blockers.length, 0);
    assert.equal(result.worktrees.pruneErrors.length, 0);
    assert.ok(result.worktrees.prunedProjects.includes(project.id));
    assert.equal(await worktreeRegistered(fixture.repo, stale), false, 'cleanup must prune stale Git worktree metadata once mutation fencing is clear');
  } finally {
    await cleanup(fixture.root);
  }
});
