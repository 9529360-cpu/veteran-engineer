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

function suggestion(to, result) {
  return toolWorkflowSuggestions('mission_status', { missionId: 'stale-argument' }, result)
    .suggestions.find((item) => item.tool === to && item.kind === 'recover');
}

const statusResult = {
  mission: { id: 'mission-current', projectId: 'project-1', activeCandidateId: null },
  tasks: [
    { id: 'T-interrupted', status: 'interrupted' },
    { id: 'T-failed', status: 'failed' },
    { id: 'T-cancelled', status: 'cancelled' },
    { id: 'T-executing', status: 'executing' },
    { id: 'T-done', status: 'done' }
  ],
  candidates: [],
  mergeProposals: []
};

test('mission_status exposes explicit per-task recovery relations after Mission reconciliation', () => {
  assert.ok(relation('mission_status', 'worker_resume', 'recover'));
  assert.ok(relation('mission_status', 'worker_retry', 'recover'));

  const resume = bindingRelation('mission_status', 'worker_resume', 'recover');
  assert.deepEqual(resume.requiredCoverage, {
    guaranteed: ['missionId'],
    conditional: [],
    selection: ['taskId'],
    unbound: ['requestId']
  });
  assert.deepEqual(resume.unboundRequired, ['requestId', 'taskId']);
  assert.deepEqual(resume.selections, [{
    target: 'taskId',
    cardinality: 'one',
    requiredForRelation: true,
    sources: [{
      source: 'structuredContent',
      collectionPointer: '/tasks',
      itemPointer: '/id',
      filter: { pointer: '/status', operator: 'equals', value: 'interrupted' }
    }],
    reason: 'Select one interrupted task whose uncertain runtime outcome requires explicit worker reconciliation.'
  }]);

  const retry = bindingRelation('mission_status', 'worker_retry', 'recover');
  assert.deepEqual(retry.requiredCoverage, {
    guaranteed: ['missionId'],
    conditional: [],
    selection: ['taskId'],
    unbound: ['requestId']
  });
  assert.deepEqual(retry.unboundRequired, ['requestId', 'taskId']);
  assert.deepEqual(retry.selections[0].sources[0].filter, {
    pointer: '/status', operator: 'in', value: ['failed', 'cancelled']
  });
});

test('mission_status suggestions carry current Mission identity and filter valid worker recovery candidates', () => {
  const resume = suggestion('worker_resume', statusResult);
  assert.deepEqual(resume.arguments, { missionId: 'mission-current' });
  assert.deepEqual(resume.missingRequired, ['requestId', 'taskId']);
  assert.equal(resume.argumentsComplete, false);
  assert.deepEqual(resume.selections[0].candidates, ['T-interrupted']);
  assert.deepEqual(resume.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(resume.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(resume.arguments, 'requestId'), false);

  const retry = suggestion('worker_retry', statusResult);
  assert.deepEqual(retry.arguments, { missionId: 'mission-current' });
  assert.deepEqual(retry.missingRequired, ['requestId', 'taskId']);
  assert.deepEqual(retry.selections[0].candidates, ['T-failed', 'T-cancelled']);
  assert.deepEqual(retry.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(retry.selections[0].candidates.includes('T-executing'), false);
  assert.equal(retry.selections[0].candidates.includes('T-interrupted'), false);
  assert.equal(Object.hasOwn(retry.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(retry.arguments, 'requestId'), false);
});

test('mission_status recovery suggestions remain inert and expose unavailable selection when no task is eligible', () => {
  const clean = {
    ...statusResult,
    tasks: [
      { id: 'T-planned', status: 'planned' },
      { id: 'T-executing', status: 'executing' },
      { id: 'T-done', status: 'done' }
    ]
  };
  const resume = suggestion('worker_resume', clean);
  const retry = suggestion('worker_retry', clean);
  assert.deepEqual(resume.selections[0].candidates, []);
  assert.deepEqual(retry.selections[0].candidates, []);
  assert.deepEqual(resume.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(resume.readiness.selectionUnavailable, ['taskId']);
  assert.equal(resume.readiness.readyAfterCallerGenerated, false);
  assert.deepEqual(retry.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(retry.readiness.selectionUnavailable, ['taskId']);
  assert.equal(retry.readiness.readyAfterCallerGenerated, false);
});
