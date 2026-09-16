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
  assert.deepEqual(relation('mission_readiness', 'mission_execute', 'alternate').condition, {
    source: 'structuredContent', pointer: '/phase', operator: 'equals', value: 'execution'
  });
  assert.deepEqual(relation('mission_readiness', 'candidate_preflight', 'inspect').condition, {
    source: 'structuredContent', pointer: '/phase', operator: 'in', value: ['candidate', 'finalize']
  });
  assert.deepEqual(relation('mission_status', 'worker_retry', 'recover').condition, {
    source: 'structuredContent', pointer: '/mission/status', operator: 'not-equals', value: 'cancelled'
  });
  assert.deepEqual(relation('mission_status', 'mission_resume', 'recover').condition, {
    source: 'structuredContent', pointer: '/mission/status', operator: 'not-equals', value: 'cancelled'
  });
  assert.deepEqual(relation('mission_readiness', 'mission_resume', 'recover').condition, {
    source: 'structuredContent', pointer: '/status', operator: 'not-equals', value: 'cancelled'
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
  assert.deepEqual(relation('candidate_preflight', 'candidate_refresh', 'recover').condition, {
    source: 'structuredContent', pointer: '/ready', operator: 'equals', value: true
  });
  assert.deepEqual(relation('candidate_preflight', 'mission_advance', 'next').condition, {
    source: 'structuredContent', pointer: '/ready', operator: 'equals', value: true
  });
  assert.deepEqual(relation('experience_review', 'experience_challenge', 'recover').condition, {
    source: 'structuredContent', pointer: '/status', operator: 'equals', value: 'active'
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

test('cancelled Mission observations make rejected recovery actions explicitly not applicable', () => {
  const activeStatus = {
    mission: { id: 'mission-1', status: 'blocked' },
    tasks: [{ id: 'T1', status: 'cancelled' }],
    candidates: [],
    mergeProposals: []
  };
  const cancelledStatus = {
    ...activeStatus,
    mission: { ...activeStatus.mission, status: 'cancelled' }
  };

  const activeRetry = suggestion('mission_status', 'worker_retry', 'recover', activeStatus);
  const cancelledRetry = suggestion('mission_status', 'worker_retry', 'recover', cancelledStatus);
  assert.equal(activeRetry.applicability.state, 'applicable');
  assert.equal(cancelledRetry.applicability.state, 'not-applicable');
  assert.deepEqual(cancelledRetry.selections[0].candidates, ['T1']);
  assert.equal(Object.hasOwn(cancelledRetry.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(cancelledRetry.arguments, 'requestId'), false);

  const activeResume = suggestion('mission_status', 'mission_resume', 'recover', activeStatus);
  const cancelledResume = suggestion('mission_status', 'mission_resume', 'recover', cancelledStatus);
  assert.equal(activeResume.applicability.state, 'applicable');
  assert.equal(cancelledResume.applicability.state, 'not-applicable');
  assert.equal(cancelledResume.readiness.readyAfterCallerGenerated, true);
  assert.deepEqual(cancelledResume.readiness.callerGeneratedRequired, ['requestId']);

  const cancelledReadiness = suggestion('mission_readiness', 'mission_resume', 'recover', {
    missionId: 'mission-1', ready: false, phase: 'execution', status: 'cancelled', blockers: [{ code: 'MISSION_CANCELLED' }], operatorActionRequired: false
  });
  assert.equal(cancelledReadiness.applicability.state, 'not-applicable');
  assert.equal(cancelledReadiness.readiness.readyAfterCallerGenerated, true);
  assert.deepEqual(cancelledReadiness.readiness.callerGeneratedRequired, ['requestId']);
});

test('mission readiness phase gates phase-specific relations without replacing transition readiness', () => {
  const execution = {
    missionId: 'mission-1', ready: false, phase: 'execution', status: 'ready', blockers: [], operatorActionRequired: false
  };
  assert.equal(suggestion('mission_readiness', 'mission_execute', 'alternate', execution).applicability.state, 'applicable');
  assert.equal(suggestion('mission_readiness', 'candidate_preflight', 'inspect', execution).applicability.state, 'not-applicable');

  const candidate = { ...execution, phase: 'candidate' };
  assert.equal(suggestion('mission_readiness', 'mission_execute', 'alternate', candidate).applicability.state, 'not-applicable');
  assert.equal(suggestion('mission_readiness', 'candidate_preflight', 'inspect', candidate).applicability.state, 'applicable');

  const finalize = { ...execution, phase: 'finalize' };
  assert.equal(suggestion('mission_readiness', 'candidate_preflight', 'inspect', finalize).applicability.state, 'applicable');

  const validation = { ...execution, ready: true, phase: 'validation' };
  assert.equal(suggestion('mission_readiness', 'mission_execute', 'alternate', validation).applicability.state, 'not-applicable');
  assert.equal(suggestion('mission_readiness', 'candidate_preflight', 'inspect', validation).applicability.state, 'not-applicable');
  assert.equal(suggestion('mission_readiness', 'mission_advance', 'next', validation).applicability.state, 'applicable');
});

test('candidate preflight gates direct candidate refresh and Mission advance on authoritative readiness', () => {
  const blockedResult = {
    missionId: 'mission-1',
    candidateId: null,
    ready: false,
    sourceDrift: true
  };
  const blockedRefresh = suggestion('candidate_preflight', 'candidate_refresh', 'recover', blockedResult);
  const blockedAdvance = suggestion('candidate_preflight', 'mission_advance', 'next', blockedResult);
  assert.equal(blockedRefresh.applicability.state, 'not-applicable');
  assert.equal(blockedAdvance.applicability.state, 'not-applicable');
  assert.equal(blockedRefresh.readiness.readyAfterCallerGenerated, true);
  assert.equal(blockedAdvance.readiness.readyAfterCallerGenerated, true);

  const readyResult = {
    missionId: 'mission-1',
    candidateId: null,
    ready: true,
    sourceDrift: false
  };
  const readyRefresh = suggestion('candidate_preflight', 'candidate_refresh', 'recover', readyResult);
  const readyAdvance = suggestion('candidate_preflight', 'mission_advance', 'next', readyResult);
  assert.equal(readyRefresh.applicability.state, 'applicable');
  assert.equal(readyAdvance.applicability.state, 'applicable');
  assert.equal(readyRefresh.readiness.readyAfterCallerGenerated, true);
  assert.equal(readyAdvance.readiness.readyAfterCallerGenerated, true);
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

test('experience review gates challenge recovery on the authoritative active lifecycle state', () => {
  const active = toolWorkflowSuggestions('experience_review', { experienceId: 'experience-1' }, {
    id: 'experience-1', status: 'active'
  }).suggestions.find((item) => item.tool === 'experience_challenge' && item.kind === 'recover');
  assert.ok(active);
  assert.equal(active.applicability.state, 'applicable');
  assert.deepEqual(active.arguments, { experienceId: 'experience-1' });
  assert.deepEqual(active.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: [],
    selectionUnavailable: [],
    inputRequired: ['statement']
  });

  const retired = toolWorkflowSuggestions('experience_review', { experienceId: 'experience-1' }, {
    id: 'experience-1', status: 'retired'
  }).suggestions.find((item) => item.tool === 'experience_challenge' && item.kind === 'recover');
  assert.ok(retired);
  assert.equal(retired.applicability.state, 'not-applicable');
  assert.deepEqual(retired.arguments, { experienceId: 'experience-1' });
  assert.deepEqual(retired.readiness, active.readiness);
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
