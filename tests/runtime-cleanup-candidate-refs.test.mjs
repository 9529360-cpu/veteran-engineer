import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const ZERO_SHA = '0000000000000000000000000000000000000000';

async function planMission(app, repo, suffix) {
  const project = await app.callTool('project_open', {
    requestId: `cleanup-candidate-project-${suffix}`,
    repoPath: repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: `cleanup-candidate-plan-${suffix}`,
    projectId: project.id,
    goal: `candidate ref cleanup ${suffix}`,
    doneDefinition: 'candidate refs remain aligned with durable ownership',
    tasks: [{
      id: 'T1',
      contract: 'preserve candidate ref cleanup fixture',
      owner: 'src',
      dependencies: [],
      writeSet: ['src'],
      risk: 'low'
    }]
  });
  return { project, missionId: planned.mission.id };
}

async function refTarget(repo, ref) {
  const result = await git(repo, ['show-ref', '--verify', '--hash', ref], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

test('runtime_cleanup removes only candidate refs with no durable candidate owner', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const { project, missionId } = await planMission(app, fixture.repo, 'orphan');
    const created = await app.callTool('candidate_refresh', {
      requestId: 'cleanup-candidate-owned-create',
      missionId
    });
    const owned = created.candidate;
    const orphanRef = 'refs/veteran/candidates/orphan-cleanup-test';
    await git(fixture.repo, ['update-ref', orphanRef, fixture.head, ZERO_SHA]);

    const dryRun = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-candidate-dry-run',
      apply: false
    });
    assert.deepEqual(dryRun.candidateRefs.blockers, []);
    assert.deepEqual(dryRun.candidateRefs.mismatches, []);
    assert.deepEqual(dryRun.candidateRefs.orphans, [{ projectId: project.id, ref: orphanRef, commitSha: fixture.head }]);
    assert.deepEqual(dryRun.candidateRefs.removed, []);

    const applied = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-candidate-apply',
      apply: true
    });
    assert.deepEqual(applied.candidateRefs.removed, [{ projectId: project.id, ref: orphanRef, commitSha: fixture.head }]);
    assert.equal(await refTarget(fixture.repo, orphanRef), null);
    assert.equal(await refTarget(fixture.repo, owned.ref), owned.commitSha, 'historical/durable candidate refs must remain owned');
  } finally {
    await cleanup(fixture.root);
  }
});

test('runtime_cleanup reports but never deletes a durable candidate ref with an unexpected target', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const { project, missionId } = await planMission(app, fixture.repo, 'mismatch');
    const created = await app.callTool('candidate_refresh', {
      requestId: 'cleanup-candidate-mismatch-create',
      missionId
    });
    const candidate = created.candidate;

    await git(fixture.repo, ['commit', '--allow-empty', '-m', 'candidate ref drift']);
    const driftHead = (await git(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(fixture.repo, ['update-ref', candidate.ref, driftHead, candidate.commitSha]);

    const result = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-candidate-mismatch-apply',
      apply: true
    });
    assert.deepEqual(result.candidateRefs.orphans, []);
    assert.deepEqual(result.candidateRefs.removed, []);
    assert.deepEqual(result.candidateRefs.mismatches, [{
      projectId: project.id,
      candidateId: candidate.id,
      ref: candidate.ref,
      expectedCommitSha: candidate.commitSha,
      actualCommitSha: driftHead
    }]);
    assert.equal(await refTarget(fixture.repo, candidate.ref), driftHead, 'mismatched owned refs require reconciliation, not cleanup');
  } finally {
    await cleanup(fixture.root);
  }
});

test('runtime_cleanup blocks candidate-ref deletion while candidate-producing requests are started or unknown', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const { project } = await planMission(app, fixture.repo, 'blocked');
    const orphanRef = 'refs/veteran/candidates/orphan-blocked-test';
    await git(fixture.repo, ['update-ref', orphanRef, fixture.head, ZERO_SHA]);
    await app.store.transaction('test_seed_candidate_cleanup_blockers', (state) => {
      state.requests['candidate-unknown-test'] = {
        requestId: 'candidate-unknown-test',
        operation: 'candidate_refresh',
        fingerprint: 'test',
        status: 'unknown',
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        error: null
      };
      state.requests['mission-advance-started-test'] = {
        requestId: 'mission-advance-started-test',
        operation: 'mission_advance',
        fingerprint: 'test',
        status: 'started',
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        error: null
      };
    });

    const result = await app.callTool('runtime_cleanup', {
      requestId: 'cleanup-candidate-blocked-apply',
      apply: true
    });
    assert.deepEqual(result.candidateRefs.orphans, [{ projectId: project.id, ref: orphanRef, commitSha: fixture.head }]);
    assert.deepEqual(result.candidateRefs.removed, []);
    assert.deepEqual(result.candidateRefs.blockers, [
      { requestId: 'candidate-unknown-test', operation: 'candidate_refresh', status: 'unknown' },
      { requestId: 'mission-advance-started-test', operation: 'mission_advance', status: 'started' }
    ]);
    assert.equal(await refTarget(fixture.repo, orphanRef), fixture.head, 'uncertain candidate mutations must fence candidate-ref cleanup');
  } finally {
    await cleanup(fixture.root);
  }
});
