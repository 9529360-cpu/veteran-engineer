import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOOL_WORKFLOW_SUGGESTIONS_META_KEY,
  toolWorkflowErrorSuggestionsMeta,
  toolWorkflowSuggestions
} from '../src/tool-workflow-suggestions.mjs';

function suggestion(sourceTool, targetTool, kind, args, result) {
  return toolWorkflowSuggestions(sourceTool, args, result).suggestions.find(
    (item) => item.tool === targetTool && item.kind === kind
  );
}

test('readiness separates fresh request ids from real operator inputs', () => {
  let next = suggestion('mission_plan', 'mission_execute', 'next', {}, {
    mission: { id: 'mission-1', projectId: 'project-1' },
    tasks: []
  });
  assert.equal(next.argumentsComplete, false);
  assert.deepEqual(next.missingRequired, ['requestId']);
  assert.deepEqual(next.readiness, {
    readyAfterCallerGenerated: true,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    selectionRequired: [],
    selectionUnavailable: [],
    inputRequired: []
  });

  next = suggestion('project_open', 'mission_plan', 'next', {}, { id: 'project-1' });
  assert.equal(next.readiness.readyAfterCallerGenerated, false);
  assert.deepEqual(next.readiness.callerGeneratedRequired, ['requestId']);
  assert.deepEqual(next.readiness.inputRequired, ['goal', 'doneDefinition']);
});

test('readiness exposes relation-required selections even when the target schema keeps them optional', () => {
  const next = suggestion('validation_capabilities', 'validation_run', 'next', { projectId: 'project-1' }, [
    { name: 'unit', type: 'command', tier: 0 },
    { name: 'integration', type: 'command', tier: 1 }
  ]);

  assert.deepEqual(next.missingRequired, ['requestId']);
  assert.deepEqual(next.readiness.callerGeneratedRequired, ['requestId']);
  assert.deepEqual(next.readiness.selectionRequired, ['capability']);
  assert.deepEqual(next.readiness.selectionUnavailable, []);
  assert.deepEqual(next.readiness.inputRequired, []);
  assert.equal(next.readiness.readyAfterCallerGenerated, false);
});

test('readiness distinguishes missing conditional scope from explicit business input', () => {
  let next = suggestion('evidence_query', 'mission_status', 'inspect', {}, [{ id: 'evidence-1' }]);
  assert.deepEqual(next.missingRequired, ['missionId']);
  assert.deepEqual(next.readiness.conditionalRequired, ['missionId']);
  assert.deepEqual(next.readiness.inputRequired, []);
  assert.equal(next.readiness.readyAfterCallerGenerated, false);

  next = suggestion('evidence_query', 'mission_status', 'inspect', { missionId: 'mission-1' }, [{ id: 'evidence-1' }]);
  assert.deepEqual(next.missingRequired, []);
  assert.deepEqual(next.readiness.conditionalRequired, []);
  assert.equal(next.readiness.readyAfterCallerGenerated, true);
});

test('readiness marks required selections unavailable when the source result has no valid candidates', () => {
  const next = suggestion('mission_execute', 'worker_retry', 'recover', { missionId: 'mission-1' }, {
    missionId: 'mission-1',
    waveIndex: 1,
    results: [{ taskId: 'T1', ok: true }],
    tasks: []
  });

  assert.deepEqual(next.readiness.callerGeneratedRequired, ['requestId']);
  assert.deepEqual(next.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(next.readiness.selectionUnavailable, ['taskId']);
  assert.equal(next.readiness.readyAfterCallerGenerated, false);
});

test('error suggestions retain argument-derived readiness without claiming result-derived authority', () => {
  const meta = toolWorkflowErrorSuggestionsMeta(
    'mission_advance',
    { requestId: 'stale-request', missionId: 'mission-1' },
    'RECONCILIATION_REQUIRED'
  );
  const projection = meta[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  const status = projection.suggestions.find((item) => item.tool === 'mission_status' && item.kind === 'inspect');
  const resume = projection.suggestions.find((item) => item.tool === 'mission_resume' && item.kind === 'recover');

  assert.equal(status.readiness.readyAfterCallerGenerated, true);
  assert.deepEqual(status.readiness.callerGeneratedRequired, []);
  assert.equal(resume.readiness.readyAfterCallerGenerated, true);
  assert.deepEqual(resume.readiness.callerGeneratedRequired, ['requestId']);
  assert.ok(projection.invocationPolicy.includes('readiness.readyAfterCallerGenerated'));
});
