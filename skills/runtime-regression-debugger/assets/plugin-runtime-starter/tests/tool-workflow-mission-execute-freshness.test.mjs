import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function relation(to, kind) {
  return TOOL_WORKFLOW_RELATIONS.mission_execute.relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function projection(result) {
  return toolWorkflowSuggestions('mission_execute', { requestId: 'request-execute', missionId: 'stale-mission' }, result);
}

test('mission_execute re-enters lifecycle progression through fresh readiness instead of direct advance', () => {
  assert.ok(relation('mission_readiness', 'next'));
  assert.equal(relation('mission_advance', 'next'), undefined);

  for (const result of [
    { missionId: 'mission-current', phase: 'validation', completed: true },
    { missionId: 'mission-current', phase: 'execution', completed: false, reason: 'mission-cancelled' },
    { missionId: 'mission-current', waveIndex: 0, results: [{ taskId: 'T1', ok: false, error: { code: 'MISSION_CANCELLED', message: 'cancelled' } }] }
  ]) {
    const suggestions = projection(result).suggestions;
    const readiness = suggestions.find((item) => item.tool === 'mission_readiness' && item.kind === 'next');
    assert.ok(readiness);
    assert.deepEqual(readiness.arguments, { missionId: 'mission-current' });
    assert.deepEqual(readiness.missingRequired, []);
    assert.equal(readiness.readiness.readyAfterCallerGenerated, true);
    assert.deepEqual(readiness.readiness.callerGeneratedRequired, []);
    assert.equal(Object.hasOwn(readiness.arguments, 'requestId'), false);
    assert.equal(suggestions.some((item) => item.tool === 'mission_advance'), false);
  }
});
