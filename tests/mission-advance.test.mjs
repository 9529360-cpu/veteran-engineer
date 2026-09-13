import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('mission advances through execution, proof gates, immutable candidate, and source-drift refresh', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'candidate flow',
      doneDefinition: 'candidate ready',
      tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const missionId = planned.mission.id;
    const dispatch = await app.services.workerOrchestrator.execute({ missionId, runWorkers: false });
    await fs.writeFile(path.join(dispatch.dispatched[0].worktreePath, 'src/a.txt'), 'mission-change\n');
    await app.services.workerOrchestrator.commitExternalTaskResult({ missionId, taskId: 'T1' });

    let step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.nextPhase, 'validation');
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'validation-skipped');
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'review');
    assert.equal(step.result.passed, true);
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'semantic-review');
    assert.equal(step.result.skipped, true);
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'candidate-created');
    assert.equal(step.result.requiresRevalidation, false);

    let status = await app.services.missionService.status({ missionId });
    const firstCandidate = status.candidates.at(-1);
    assert.ok(firstCandidate.immutable);
    assert.equal(firstCandidate.commitSha, status.tasks[0].integrationSha);
    assert.equal(firstCandidate.proof.validation, 'skipped');
    assert.equal(firstCandidate.proof.review, 'passed');
    assert.equal(firstCandidate.proof.semanticReview, 'skipped');
    assert.equal((await git(repo, ['show-ref', '--verify', '--hash', firstCandidate.ref])).stdout.trim(), firstCandidate.commitSha);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'candidate creation must not move user branch');

    await fs.writeFile(path.join(repo, 'user-note.txt'), 'user drift\n');
    await git(repo, ['add', 'user-note.txt']);
    await git(repo, ['commit', '-m', 'user drift']);
    const driftHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'candidate-refresh');
    assert.equal(step.nextPhase, 'validation');
    assert.equal(step.result.requiresRevalidation, true);
    const refreshedCandidate = step.result.candidate;
    assert.notEqual(refreshedCandidate.id, firstCandidate.id);
    assert.equal(refreshedCandidate.sourceHead, driftHead);
    assert.equal(refreshedCandidate.proof.validation, 'stale');

    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'validation-skipped');
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'review');
    assert.equal(step.result.reviewBase, driftHead, 'post-drift review must compare candidate against new source head');
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'semantic-review');
    step = await app.services.missionAdvanceService.advance({ missionId });
    assert.equal(step.action, 'candidate-ready');

    status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'candidate-ready');
    assert.equal(status.mission.activeCandidateId, refreshedCandidate.id);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), driftHead, 'refresh must not merge into user branch');
  } finally {
    await cleanup(root);
  }
});
