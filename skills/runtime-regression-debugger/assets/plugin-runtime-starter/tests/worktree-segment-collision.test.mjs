import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

test('lossy task identifiers receive distinct worktree paths and branches', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'worktree-collision-open',
      repoPath: fixture.repo
    });
    const planned = await app.callTool('mission_plan', {
      requestId: 'worktree-collision-plan',
      projectId: project.id,
      goal: 'prove lossy task ids cannot share worktrees',
      doneDefinition: 'both tasks are independently dispatchable',
      tasks: [
        { id: 'A-B', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'A/B', contract: 'own src/b.txt', owner: 'src/b.txt', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });

    const dispatched = await app.callTool('mission_execute', {
      requestId: 'worktree-collision-execute',
      missionId: planned.mission.id,
      runWorkers: false
    });
    assert.equal(dispatched.preparationFailures.length, 0);
    assert.equal(dispatched.dispatched.length, 2);

    const byTask = new Map(dispatched.dispatched.map((item) => [item.taskId, item]));
    const literal = byTask.get('A-B');
    const lossy = byTask.get('A/B');
    assert.ok(literal);
    assert.ok(lossy);
    assert.notEqual(literal.worktreePath, lossy.worktreePath);
    await fs.access(path.join(literal.worktreePath, '.git'));
    await fs.access(path.join(lossy.worktreePath, '.git'));

    const literalBranch = (await git(literal.worktreePath, ['branch', '--show-current'])).stdout.trim();
    const lossyBranch = (await git(lossy.worktreePath, ['branch', '--show-current'])).stdout.trim();
    assert.notEqual(literalBranch, lossyBranch);
    assert.match(literalBranch, /\/A-B-1$/);
    assert.doesNotMatch(lossyBranch, /\/A-B-1$/);

    const longPrefix = 'x'.repeat(100);
    const longA = { id: `${longPrefix}A` };
    const longB = { id: `${longPrefix}B` };
    assert.notEqual(
      app.services.worktreeManager.taskPath(planned.mission, longA),
      app.services.worktreeManager.taskPath(planned.mission, longB),
      'truncated task identifiers must retain collision-resistant identity'
    );
    assert.notEqual(
      app.services.worktreeManager.taskBranch(planned.mission, longA, 1),
      app.services.worktreeManager.taskBranch(planned.mission, longB, 1),
      'truncated Git ref segments must retain collision-resistant identity'
    );
  } finally {
    await cleanup(fixture.root);
  }
});
