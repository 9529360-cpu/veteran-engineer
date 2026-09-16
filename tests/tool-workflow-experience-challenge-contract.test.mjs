import assert from 'node:assert/strict';
import test from 'node:test';
import { toolOutputJsonSchema } from '../src/tool-output-contracts.mjs';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';

test('experience review challenge applicability is backed by a guaranteed lifecycle status contract', () => {
  for (const tool of ['experience_commit', 'experience_review', 'experience_challenge']) {
    const schema = toolOutputJsonSchema(tool);
    assert.ok(schema.required?.includes('status'), `${tool} must guarantee lifecycle status`);
  }

  const relation = TOOL_WORKFLOW_RELATIONS.experience_review.relations
    .find((edge) => edge.tool === 'experience_challenge' && edge.kind === 'recover');
  assert.deepEqual(relation?.condition, {
    source: 'structuredContent',
    pointer: '/status',
    operator: 'equals',
    value: 'active'
  });
});
