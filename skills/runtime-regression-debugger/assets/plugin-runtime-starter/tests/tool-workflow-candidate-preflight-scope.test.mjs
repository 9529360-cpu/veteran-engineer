import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_IDENTITY_SOURCES, TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function bindingRelation(targetTool, kind) {
  return TOOL_WORKFLOW_BINDINGS.candidate_preflight.relations.find(
    (item) => item.tool === targetTool && item.kind === kind
  );
}

function suggestion(targetTool, kind, args, result, options) {
  return toolWorkflowSuggestions('candidate_preflight', args, result, options).suggestions.find(
    (item) => item.tool === targetTool && item.kind === kind
  );
}

const MISSION_SCOPED_RELATIONS = Object.freeze([
  ['candidate_status', 'inspect'],
  ['candidate_refresh', 'recover'],
  ['mission_readiness', 'inspect'],
  ['mission_advance', 'next']
]);

test('candidate preflight carries Mission scope from its required invocation argument', () => {
  assert.deepEqual(TOOL_IDENTITY_SOURCES.candidate_preflight.missionId, {
    source: 'arguments',
    pointer: '/missionId'
  });

  for (const [targetTool, kind] of MISSION_SCOPED_RELATIONS) {
    const relation = bindingRelation(targetTool, kind);
    assert.ok(relation, `missing candidate_preflight -> ${targetTool} ${kind} relation`);
    const binding = relation.bindings.find((item) => item.target === 'missionId');
    assert.deepEqual(binding, {
      target: 'missionId',
      source: 'arguments',
      pointer: '/missionId',
      mode: 'if-present-non-null',
      transform: 'identity',
      availability: 'guaranteed'
    });
    assert.equal(relation.requiredCoverage.guaranteed.includes('missionId'), true);
    assert.equal(relation.requiredCoverage.conditional.includes('missionId'), false);
  }
});

test('candidate preflight suggestions do not depend on result echo for Mission scope', () => {
  const args = { missionId: 'mission-1' };
  const result = { candidateId: null, ready: true, sourceDrift: false };

  for (const [targetTool, kind] of MISSION_SCOPED_RELATIONS) {
    const next = suggestion(targetTool, kind, args, result);
    assert.equal(next.arguments.missionId, 'mission-1');
    assert.deepEqual(next.readiness.conditionalRequired, []);
    assert.deepEqual(next.readiness.resultRequired, []);
  }

  assert.equal(suggestion('candidate_refresh', 'recover', args, result).applicability.state, 'applicable');
  assert.equal(suggestion('mission_advance', 'next', args, result).applicability.state, 'applicable');
});

test('candidate preflight errors retain Mission scope without bypassing readiness gates', () => {
  const args = { missionId: 'mission-1' };
  const options = { sourceOutcome: 'error', sourceErrorCode: 'SOURCE_AUTHORITY_CHANGED' };

  for (const [targetTool, kind] of MISSION_SCOPED_RELATIONS) {
    const next = suggestion(targetTool, kind, args, {}, options);
    assert.equal(next.arguments.missionId, 'mission-1');
    assert.deepEqual(next.readiness.conditionalRequired, []);
    assert.deepEqual(next.readiness.resultRequired, []);
    assert.deepEqual(next.readiness.inputRequired, []);
    assert.equal(next.readiness.readyAfterCallerGenerated, true);
  }

  assert.equal(suggestion('candidate_refresh', 'recover', args, {}, options).applicability.state, 'unknown');
  assert.equal(suggestion('candidate_refresh', 'recover', args, {}, options).applicability.reason, 'source-error');
  assert.equal(suggestion('mission_advance', 'next', args, {}, options).applicability.state, 'unknown');
  assert.equal(suggestion('mission_advance', 'next', args, {}, options).applicability.reason, 'source-error');
});
