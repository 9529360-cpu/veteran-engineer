import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function relation(sourceTool, targetTool, kind) {
  return TOOL_WORKFLOW_RELATIONS[sourceTool].relations.find((item) => item.tool === targetTool && item.kind === kind);
}

function suggestion(sourceTool, targetTool, kind, result, options = {}) {
  return toolWorkflowSuggestions(sourceTool, { missionId: 'mission-1', candidateId: 'candidate-1' }, result, options)
    .suggestions.find((item) => item.tool === targetTool && item.kind === kind);
}

test('workflow relations publish structured conditions only for result gates with authoritative machine evidence', () => {
  assert.deepEqual(relation('mission_readiness', 'mission_advance', 'next').condition, {
    source: 'structuredContent', pointer: '/ready', operator: 'equals', value: true
  });
  assert.deepEqual(relation('review_run', 'semantic_review_run', 'next').condition, {
    source: 'structuredContent', pointer: '/passed', operator: 'equals', value: true
  });
  assert.deepEqual(relation('review_run', 'remediation_plan', 'recover').condition, {
    source: 'structuredContent', pointer: '/passed', operator: 'equals', value: false
  });
  assert.deepEqual(relation('semantic_review_run', 'candidate_preflight', 'next').condition, {
    source: 'structuredContent', pointer: '/passed', operator: 'equals', value: true
  });
  assert.deepEqual(relation('semantic_review_run', 'remediation_plan', 'recover').condition, {
    source: 'structuredContent', pointer: '/passed', operator: 'equals', value: false
  });
  assert.equal(Object.hasOwn(relation('mission_readiness', 'mission_status', 'inspect'), 'condition'), false);
});

test('workflow suggestions keep structural readiness independent from relation applicability', () => {
  const blocked = suggestion('mission_readiness', 'mission_advance', 'next', {
    missionId: 'mission-1', ready: false, phase: 'validation', status: 'ready', blockers: [], operatorActionRequired: false
  });
  assert.equal(blocked.applicability.state, 'not-applicable');
  assert.equal(blocked.readiness.readyAfterCallerGenerated, true);

  const ready = suggestion('mission_readiness', 'mission_advance', 'next', {
    missionId: 'mission-1', ready: true, phase: 'validation', status: 'ready', blockers: [], operatorActionRequired: false
  });
  assert.equal(ready.applicability.state, 'applicable');
  assert.equal(ready.readiness.readyAfterCallerGenerated, true);

  const inspect = suggestion('mission_readiness', 'mission_status', 'inspect', {
    missionId: 'mission-1', ready: false
  });
  assert.deepEqual(inspect.applicability, { state: 'not-declared' });
});

test('review result gates expose mutually exclusive proof and remediation applicability', () => {
  const passed = {
    passed: true,
    head: 'abc',
    reviewBase: 'def',
    findings: [],
    evidenceId: 'evidence-1'
  };
  assert.equal(suggestion('review_run', 'semantic_review_run', 'next', passed).applicability.state, 'applicable');
  assert.equal(suggestion('review_run', 'remediation_plan', 'recover', passed).applicability.state, 'not-applicable');

  const failed = { ...passed, passed: false, findings: [{ severity: 'high', code: 'x', message: 'blocked' }] };
  assert.equal(suggestion('review_run', 'semantic_review_run', 'next', failed).applicability.state, 'not-applicable');
  assert.equal(suggestion('review_run', 'remediation_plan', 'recover', failed).applicability.state, 'applicable');
});

test('structured applicability becomes unknown on error outcomes or missing source evidence', () => {
  const errorSuggestion = suggestion('mission_readiness', 'mission_advance', 'next', {}, {
    sourceOutcome: 'error', sourceErrorCode: 'READINESS_FAILED'
  });
  assert.deepEqual(errorSuggestion.applicability, {
    state: 'unknown',
    condition: { source: 'structuredContent', pointer: '/ready', operator: 'equals', value: true },
    reason: 'source-error'
  });

  const missing = suggestion('mission_readiness', 'mission_advance', 'next', { missionId: 'mission-1' });
  assert.equal(missing.applicability.state, 'unknown');
  assert.equal(missing.applicability.reason, 'source-value-unavailable');
});
