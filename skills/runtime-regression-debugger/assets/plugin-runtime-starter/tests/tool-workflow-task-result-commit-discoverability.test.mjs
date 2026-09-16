import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function relation(from, to, kind) {
  return TOOL_WORKFLOW_RELATIONS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function bindingRelation(from, to, kind) {
  return TOOL_WORKFLOW_BINDINGS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function commitSuggestion(result) {
  return toolWorkflowSuggestions('mission_status', { missionId: 'stale-input' }, result)
    .suggestions.find((item) => item.tool === 'task_result_commit' && item.kind === 'next');
}

const activeStatus = {
  mission: { id: 'mission-current', projectId: 'project-1', status: 'ready', activeCandidateId: null },
  tasks: [
    { id: 'T-dispatched', status: 'dispatched' },
    { id: 'T-interrupted', status: 'interrupted' },
    { id: 'T-executing', status: 'executing' },
    { id: 'T-failed', status: 'failed' },
    { id: 'T-cancelled', status: 'cancelled' },
    { id: 'T-planned', status: 'planned' },
    { id: 'T-done', status: 'done' }
  ],
  candidates: [],
  mergeProposals: []
};

test('mission_status exposes task_result_commit through explicit dispatched-task selection', () => {
  const edge = relation('mission_status', 'task_result_commit', 'next');
  assert.ok(edge);
  assert.deepEqual(edge.condition, {
    source: 'structuredContent',
    pointer: '/mission/status',
    operator: 'not-equals',
    value: 'cancelled'
  });

  const binding = bindingRelation('mission_status', 'task_result_commit', 'next');
  assert.deepEqual(binding.requiredCoverage, {
    guaranteed: ['missionId'],
    conditional: [],
    selection: ['taskId'],
    unbound: ['requestId']
  });
  assert.deepEqual(binding.unboundRequired, ['requestId', 'taskId']);
  assert.deepEqual(binding.selections, [{
    target: 'taskId',
    cardinality: 'one',
    requiredForRelation: true,
    sources: [{
      source: 'structuredContent',
      collectionPointer: '/tasks',
      itemPointer: '/id',
      filter: { pointer: '/status', operator: 'equals', value: 'dispatched' }
    }],
    reason: 'Select one dispatched external task only after its external producer has finished writing the runtime-owned task worktree.'
  }]);
});

test('mission_status suggests only dispatched external tasks without binding taskId or requestId', () => {
  const suggestion = commitSuggestion(activeStatus);
  assert.ok(suggestion);
  assert.equal(suggestion.applicability.state, 'applicable');
  assert.deepEqual(suggestion.arguments, { missionId: 'mission-current' });
  assert.deepEqual(suggestion.missingRequired, ['requestId', 'taskId']);
  assert.equal(suggestion.argumentsComplete, false);
  assert.deepEqual(suggestion.selections[0].candidates, ['T-dispatched']);
  for (const taskId of ['T-interrupted', 'T-executing', 'T-failed', 'T-cancelled', 'T-planned', 'T-done']) {
    assert.equal(suggestion.selections[0].candidates.includes(taskId), false, `${taskId} must not be offered for direct external-result commit`);
  }
  assert.deepEqual(suggestion.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
});

test('cancelled Mission makes task_result_commit not applicable even if a stale dispatched row is projected', () => {
  const suggestion = commitSuggestion({
    ...activeStatus,
    mission: { ...activeStatus.mission, status: 'cancelled' }
  });
  assert.ok(suggestion);
  assert.equal(suggestion.applicability.state, 'not-applicable');
  assert.deepEqual(suggestion.selections[0].candidates, ['T-dispatched']);
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
});

test('mission_status exposes unavailable task_result_commit selection when no task is dispatched', () => {
  const suggestion = commitSuggestion({
    ...activeStatus,
    tasks: activeStatus.tasks.filter((task) => task.status !== 'dispatched')
  });
  assert.ok(suggestion);
  assert.equal(suggestion.applicability.state, 'applicable');
  assert.deepEqual(suggestion.selections[0].candidates, []);
  assert.deepEqual(suggestion.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(suggestion.readiness.selectionUnavailable, ['taskId']);
  assert.equal(suggestion.readiness.readyAfterCallerGenerated, false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
});
