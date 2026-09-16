import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

const PROOF_TOOLS = Object.freeze([
  {
    name: 'validation_run',
    args: { projectId: 'project-1', missionId: 'mission-1', capability: 'unit' },
    result: { purpose: 'targeted', passed: true, evidenceId: 'evidence-validation' }
  },
  {
    name: 'review_run',
    args: { missionId: 'mission-1' },
    result: { passed: true, evidenceId: 'evidence-review' }
  },
  {
    name: 'semantic_review_run',
    args: { missionId: 'mission-1' },
    result: { passed: true, evidenceId: 'evidence-semantic' }
  }
]);

function relation(from, to, kind) {
  return TOOL_WORKFLOW_RELATIONS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

test('independent Mission proof workflows re-enter progression through fresh readiness instead of direct advance', () => {
  for (const { name } of PROOF_TOOLS) {
    assert.ok(relation(name, 'mission_readiness', 'next'), `${name} must route Mission progression through readiness`);
    assert.equal(relation(name, 'mission_advance', 'alternate'), undefined, `${name} must not bypass the readiness barrier`);
  }
});

test('proof workflow suggestions carry Mission scope to readiness without choosing or synthesizing progression inputs', () => {
  for (const { name, args, result } of PROOF_TOOLS) {
    const projection = toolWorkflowSuggestions(name, args, result);
    const readiness = projection.suggestions.find((item) => item.tool === 'mission_readiness' && item.kind === 'next');
    assert.ok(readiness, `${name} must publish mission_readiness`);
    assert.deepEqual(readiness.arguments, { missionId: 'mission-1' });
    assert.equal(readiness.readiness.readyAfterCallerGenerated, true);
    assert.deepEqual(readiness.readiness.callerGeneratedRequired, []);
    assert.equal(Object.hasOwn(readiness.arguments, 'requestId'), false);
    assert.equal(
      projection.suggestions.some((item) => item.tool === 'mission_advance'),
      false,
      `${name} must not advertise mission_advance from potentially diagnostic proof state`
    );
  }
});
