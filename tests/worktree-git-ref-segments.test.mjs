import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('mission dispatch normalizes git-only ref hazards without changing the task worktree path', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'project-worktree-ref',
      repoPath: fixture.repo
    });
    const planned = await app.callTool('mission_plan', {
      requestId: 'mission-worktree-ref',
      projectId: project.id,
      goal: 'prove task ids remain dispatchable',
      doneDefinition: 'task worktree exists on a valid git branch',
      tasks: [{
        id: 'risk..check',
        contract: 'inspect src/a.txt without changing it',
        owner: 'src',
        dependencies: [],
        writeSet: ['src'],
        risk: 'low'
      }]
    });

    const executed = await app.callTool('mission_execute', {
      requestId: 'execute-worktree-ref',
      missionId: planned.mission.id,
      runWorkers: false
    });
    assert.equal(executed.dispatched.length, 1);
    const worktreePath = executed.dispatched[0].worktreePath;
    assert.ok(path.basename(worktreePath).includes('risk..check'), 'filesystem worktree naming remains unchanged');

    const branch = (await git(worktreePath, ['branch', '--show-current'])).stdout.trim();
    assert.equal(branch.includes('..'), false, 'git branch must not contain a forbidden double-dot sequence');
    assert.ok(branch.endsWith('/risk-check-1'));
    await git(fixture.repo, ['check-ref-format', '--branch', branch]);
  } finally {
    await cleanup(fixture.root);
  }
});
