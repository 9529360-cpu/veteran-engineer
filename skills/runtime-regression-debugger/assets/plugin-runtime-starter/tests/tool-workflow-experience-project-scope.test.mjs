import assert from 'node:assert/strict';
import test from 'node:test';
import { toolOutputJsonSchema } from '../src/tool-output-contracts.mjs';
import { TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function relation(from, to, kind) {
  return TOOL_WORKFLOW_BINDINGS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function suggestion(projection, to, kind) {
  return projection.suggestions.find((edge) => edge.tool === to && edge.kind === kind);
}

test('experience outputs guarantee project scope used by workflow chaining', () => {
  for (const name of ['experience_commit', 'experience_review', 'experience_challenge']) {
    assert.ok(toolOutputJsonSchema(name).required.includes('projectId'), `${name} must guarantee projectId`);
  }

  const queryItemSchema = toolOutputJsonSchema('experience_query').properties.items.items;
  assert.ok(queryItemSchema.required.includes('projectId'), 'experience_query items must guarantee projectId');
});

test('experience review and challenge carry authoritative project scope into follow-up query', () => {
  for (const { sourceTool, status } of [
    { sourceTool: 'experience_review', status: 'active' },
    { sourceTool: 'experience_challenge', status: 'challenged' }
  ]) {
    const projectBinding = relation(sourceTool, 'experience_query', 'inspect').bindings.find((item) => item.target === 'projectId');
    assert.deepEqual(projectBinding, {
      target: 'projectId',
      source: 'structuredContent',
      pointer: '/projectId',
      mode: 'if-present-non-null',
      transform: 'identity',
      availability: 'guaranteed'
    });

    const projection = toolWorkflowSuggestions(sourceTool, { experienceId: 'experience-1' }, {
      projectId: 'project-current',
      status
    });
    const query = suggestion(projection, 'experience_query', 'inspect');
    assert.deepEqual(query.arguments, { projectId: 'project-current' });
    assert.deepEqual(query.missingRequired, []);
    assert.equal(query.readiness.readyAfterCallerGenerated, true);
  }
});
