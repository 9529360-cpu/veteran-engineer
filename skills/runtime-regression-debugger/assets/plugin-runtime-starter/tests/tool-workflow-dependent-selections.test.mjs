import assert from 'node:assert/strict';
import test from 'node:test';
import { experienceReviewActionsForStatus } from '../src/experience-lifecycle.mjs';
import { dependentWorkflowSelections } from '../src/tool-workflow-dependent-selections.mjs';

const reviewEdge = Object.freeze({ tool: 'experience_review', kind: 'next' });

function actionSelection(sourceTool, result) {
  const selections = dependentWorkflowSelections(sourceTool, reviewEdge, result);
  assert.equal(selections.length, 1);
  return selections[0];
}

test('direct experience review sources project actions from guaranteed lifecycle status', () => {
  const committed = actionSelection('experience_commit', { id: 'candidate-1', status: 'candidate' });
  assert.equal(committed.sourceState, 'candidate');
  assert.equal(Object.hasOwn(committed, 'dependsOn'), false);
  assert.deepEqual(committed.candidates, [...experienceReviewActionsForStatus('candidate')]);

  const challenged = actionSelection('experience_challenge', { id: 'challenged-1', status: 'challenged' });
  assert.equal(challenged.sourceState, 'challenged');
  assert.equal(Object.hasOwn(challenged, 'dependsOn'), false);
  assert.deepEqual(challenged.candidates, [...experienceReviewActionsForStatus('challenged')]);
});

test('direct review action candidates become unavailable rather than invented without source status', () => {
  const selection = actionSelection('experience_commit', {});
  assert.equal(Object.hasOwn(selection, 'sourceState'), false);
  assert.deepEqual(selection.candidates, []);
});

test('experience audit action candidates are projected from lifecycle authority per selected experience', () => {
  const selection = actionSelection('experience_audit', [
    { id: 'candidate-1', status: 'candidate' },
    { id: 'active-1', status: 'active' },
    { id: 'challenged-1', status: 'challenged' },
    { id: 'retired-1', status: 'retired' }
  ]);

  assert.equal(selection.target, 'action');
  assert.deepEqual(selection.dependsOn, { target: 'experienceId' });
  assert.deepEqual(selection.candidates, []);

  const groups = Object.fromEntries(selection.candidateGroups.map((item) => [item.when.equals, [...item.candidates]]));
  assert.deepEqual(groups, {
    'candidate-1': [...experienceReviewActionsForStatus('candidate')],
    'active-1': [...experienceReviewActionsForStatus('active')],
    'challenged-1': [...experienceReviewActionsForStatus('challenged')]
  });
  assert.equal(Object.hasOwn(groups, 'retired-1'), false);
});

test('experience compact action candidates use candidate lifecycle authority without changing kept ids', () => {
  const result = { removed: ['duplicate-1'], kept: ['candidate-1', 'candidate-2'] };
  const selection = actionSelection('experience_compact', result);

  assert.deepEqual(result, { removed: ['duplicate-1'], kept: ['candidate-1', 'candidate-2'] });
  assert.deepEqual(selection.dependsOn, { target: 'experienceId' });
  assert.deepEqual(selection.candidateGroups.map((item) => item.when.equals), result.kept);
  for (const group of selection.candidateGroups) {
    assert.equal(group.sourceState, 'candidate');
    assert.deepEqual(group.candidates, [...experienceReviewActionsForStatus('candidate')]);
  }
});

test('unrelated workflow relations do not gain dependent selections', () => {
  assert.deepEqual(dependentWorkflowSelections('mission_status', { tool: 'worker_retry', kind: 'recover' }, {}), []);
});
