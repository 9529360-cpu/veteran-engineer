import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPERIENCE_REVIEW_ACTIONS,
  experienceReviewActionsForStatus,
  experienceReviewInvalidStateMessage,
  experienceReviewTransition,
  isExperienceReviewAction
} from '../src/experience-lifecycle.mjs';
import { ExperienceService } from '../src/experience-service.mjs';
import { StateStore } from '../src/state-store.mjs';
import { toolInputJsonSchema } from '../src/tool-catalog.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('experience review lifecycle is one shared transition authority for runtime and tool schema', () => {
  assert.deepEqual(EXPERIENCE_REVIEW_ACTIONS, ['activate', 'reject', 'reactivate', 'retire']);
  assert.deepEqual(experienceReviewActionsForStatus('candidate'), ['activate', 'reject']);
  assert.deepEqual(experienceReviewActionsForStatus('active'), ['retire']);
  assert.deepEqual(experienceReviewActionsForStatus('challenged'), ['reactivate', 'retire']);
  assert.deepEqual(experienceReviewActionsForStatus('retired'), []);
  assert.deepEqual(experienceReviewActionsForStatus('unknown'), []);

  assert.equal(isExperienceReviewAction('activate'), true);
  assert.equal(isExperienceReviewAction('retire'), true);
  assert.equal(isExperienceReviewAction('unknown'), false);

  assert.deepEqual(toolInputJsonSchema('experience_review').properties.action.enum, EXPERIENCE_REVIEW_ACTIONS);
});

test('experience review transition authority preserves lifecycle targets and compatibility errors', () => {
  assert.deepEqual(experienceReviewTransition('candidate', 'activate'), {
    fromStatuses: ['candidate'],
    toStatus: 'active',
    reviewStatus: 'approved',
    confirm: true,
    invalidStateMessage: 'Only candidate experience can be activated'
  });
  assert.deepEqual(experienceReviewTransition('candidate', 'reject'), {
    fromStatuses: ['candidate'],
    toStatus: 'retired',
    reviewStatus: 'rejected',
    confirm: false,
    invalidStateMessage: 'Only candidate experience can be rejected'
  });
  assert.deepEqual(experienceReviewTransition('challenged', 'reactivate'), {
    fromStatuses: ['challenged'],
    toStatus: 'active',
    reviewStatus: 'approved-after-challenge',
    confirm: true,
    invalidStateMessage: 'Only challenged experience can be reactivated'
  });
  assert.deepEqual(experienceReviewTransition('active', 'retire'), {
    fromStatuses: ['active', 'challenged'],
    toStatus: 'retired',
    reviewStatus: 'retired',
    confirm: false,
    invalidStateMessage: 'Only active or challenged experience can be retired'
  });
  assert.deepEqual(experienceReviewTransition('challenged', 'retire'), experienceReviewTransition('active', 'retire'));
  assert.equal(experienceReviewTransition('candidate', 'reactivate'), null);
  assert.equal(experienceReviewTransition('retired', 'retire'), null);
  assert.equal(experienceReviewTransition('candidate', 'unknown'), null);

  assert.equal(experienceReviewInvalidStateMessage('activate'), 'Only candidate experience can be activated');
  assert.equal(experienceReviewInvalidStateMessage('reject'), 'Only candidate experience can be rejected');
  assert.equal(experienceReviewInvalidStateMessage('reactivate'), 'Only challenged experience can be reactivated');
  assert.equal(experienceReviewInvalidStateMessage('retire'), 'Only active or challenged experience can be retired');
  assert.equal(experienceReviewInvalidStateMessage('unknown'), null);
});

test('ExperienceService review behavior remains compatible while consuming shared lifecycle authority', async () => {
  const root = await tempDir('veteran-exp-lifecycle-authority-');
  try {
    const store = await new StateStore({ root }).init();
    const service = new ExperienceService({ store });
    const candidate = await service.commit({ projectId: 'p1', mechanism: 'workflow', statement: 'Keep one lifecycle owner', kind: 'rule' });

    await assert.rejects(
      service.review({ experienceId: candidate.id, action: 'reactivate' }),
      (error) => error?.code === 'EXPERIENCE_STATE_INVALID' && error?.message === 'Only challenged experience can be reactivated'
    );
    assert.equal((await service.audit({ projectId: 'p1' }))[0].status, 'candidate');

    await assert.rejects(
      service.review({ experienceId: candidate.id, action: 'unknown' }),
      (error) => error?.message === 'Unknown experience review action: unknown'
    );

    const activated = await service.review({ experienceId: candidate.id, action: 'activate' });
    assert.equal(activated.status, 'active');
    assert.equal(activated.reviewStatus, 'approved');
    assert.equal(typeof activated.lastConfirmedAt, 'string');

    const challenged = await service.challenge({ experienceId: candidate.id, statement: 'Contrary evidence arrived' });
    assert.equal(challenged.status, 'challenged');

    const reactivated = await service.review({ experienceId: candidate.id, action: 'reactivate' });
    assert.equal(reactivated.status, 'active');
    assert.equal(reactivated.reviewStatus, 'approved-after-challenge');

    const retired = await service.review({ experienceId: candidate.id, action: 'retire' });
    assert.equal(retired.status, 'retired');
    assert.equal(retired.reviewStatus, 'retired');

    const rejectedCandidate = await service.commit({ projectId: 'p1', mechanism: 'workflow', statement: 'Reject this candidate', kind: 'rule' });
    const rejected = await service.review({ experienceId: rejectedCandidate.id, action: 'reject' });
    assert.equal(rejected.status, 'retired');
    assert.equal(rejected.reviewStatus, 'rejected');
  } finally {
    await cleanup(root);
  }
});
