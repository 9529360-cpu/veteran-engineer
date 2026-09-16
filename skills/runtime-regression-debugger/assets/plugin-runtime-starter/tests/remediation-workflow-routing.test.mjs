import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function relation(targetTool, kind) {
  return TOOL_WORKFLOW_RELATIONS.remediation_plan.relations.find((item) => item.tool === targetTool && item.kind === kind);
}

function suggestion(targetTool, kind, applied) {
  return toolWorkflowSuggestions('remediation_plan', { missionId: 'mission-1' }, {
    id: 'remediation-1',
    missionId: 'mission-1',
    applied,
    tasks: [],
    findings: []
  }).suggestions.find((item) => item.tool === targetTool && item.kind === kind);
}

test('applied remediation routes directly back to Mission execution instead of handoff', () => {
  assert.deepEqual(relation('mission_execute', 'next').condition, {
    source: 'structuredContent', pointer: '/applied', operator: 'equals', value: true
  });
  assert.deepEqual(relation('handoff_export', 'alternate').condition, {
    source: 'structuredContent', pointer: '/applied', operator: 'equals', value: false
  });

  const execute = suggestion('mission_execute', 'next', true);
  const handoff = suggestion('handoff_export', 'alternate', true);
  assert.equal(execute.applicability.state, 'applicable');
  assert.equal(handoff.applicability.state, 'not-applicable');
  assert.deepEqual(execute.arguments, { missionId: 'mission-1' });
  assert.equal(execute.readiness.readyAfterCallerGenerated, true);
});

test('proposal-only remediation keeps execution inapplicable and handoff optional', () => {
  const execute = suggestion('mission_execute', 'next', false);
  const handoff = suggestion('handoff_export', 'alternate', false);
  assert.equal(execute.applicability.state, 'not-applicable');
  assert.equal(handoff.applicability.state, 'applicable');
  assert.deepEqual(handoff.arguments, { missionId: 'mission-1' });
});
