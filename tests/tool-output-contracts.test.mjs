import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import {
  toolOutputJsonSchema,
  toolOutputStructuredContent,
  toolOutputZodSchema
} from '../src/tool-output-contracts.mjs';

const ARRAY_OUTPUT_TOOLS = new Set([
  'mission_timeline',
  'evidence_query',
  'validation_capabilities',
  'experience_audit'
]);

test('every public tool publishes one semantic output contract', () => {
  assert.equal(TOOL_NAMES.length, 34);
  for (const name of TOOL_NAMES) {
    const schema = toolOutputJsonSchema(name);
    assert.equal(schema.type, ARRAY_OUTPUT_TOOLS.has(name) ? 'array' : 'object', `${name} output root drifted`);
    if (schema.type === 'object') assert.equal(schema.additionalProperties, true, `${name} object output must preserve forward-compatible fields`);
  }
});

test('flagship output contracts expose fields needed to chain the engineering workflow', () => {
  const open = toolOutputJsonSchema('project_open');
  assert.ok(open.required.includes('id'));
  assert.match(open.properties.id.description, /projectId/i);

  const plan = toolOutputJsonSchema('mission_plan');
  assert.deepEqual(plan.required, ['mission', 'tasks']);
  assert.ok(plan.properties.mission.properties.id);
  assert.ok(plan.properties.tasks.items.properties.id);

  const status = toolOutputJsonSchema('mission_status');
  assert.ok(status.properties.candidates);
  assert.ok(status.properties.mergeProposals);

  const readiness = toolOutputJsonSchema('mission_readiness');
  assert.deepEqual(readiness.required, ['missionId', 'ready']);
  assert.ok(readiness.properties.blockers);

  const candidate = toolOutputJsonSchema('candidate_status');
  assert.ok(candidate.properties.missionId);
  assert.ok(candidate.properties.candidate);

  const health = toolOutputJsonSchema('runtime_health');
  assert.ok(health.required.includes('toolCount'));
  assert.ok(health.properties.mcp);

  const handoff = toolOutputJsonSchema('handoff_export');
  assert.deepEqual(handoff.required, ['id', 'artifactPointer', 'handoff']);
  assert.equal(handoff.properties.handoff.properties.schema.type, 'string');
});

test('legacy 2025 output schemas and structured content wrap natural array roots only', () => {
  for (const name of TOOL_NAMES) {
    const natural = toolOutputJsonSchema(name);
    const legacy = toolOutputJsonSchema(name, { legacyEnvelope: true });
    if (ARRAY_OUTPUT_TOOLS.has(name)) {
      assert.equal(natural.type, 'array');
      assert.equal(legacy.type, 'object');
      assert.deepEqual(legacy.required, ['result']);
      assert.equal(legacy.properties.result.type, 'array');
      const value = [{ id: 'one' }];
      assert.deepEqual(toolOutputStructuredContent(name, value), value);
      assert.deepEqual(toolOutputStructuredContent(name, value, { legacyEnvelope: true }), { result: value });
    } else {
      assert.equal(legacy.type, 'object');
      const value = { ok: true };
      assert.deepEqual(toolOutputStructuredContent(name, value, { legacyEnvelope: true }), value);
    }
  }
});

test('output structured-content root validation fails closed before transport serialization', () => {
  assert.throws(() => toolOutputStructuredContent('mission_timeline', { not: 'an array' }), /must be an array/);
  assert.throws(() => toolOutputStructuredContent('runtime_health', []), /must be an object/);
  assert.throws(() => toolOutputStructuredContent('runtime_health', null), /must be an object/);
});

test('official SDK Zod output contracts are generated from the same canonical schemas', () => {
  const project = toolOutputZodSchema(z, 'project_open');
  assert.equal(project.safeParse({ id: 'project-1', remoteUrl: null, futureField: true }).success, true);
  assert.equal(project.safeParse({ remoteUrl: null }).success, false);

  const readiness = toolOutputZodSchema(z, 'mission_readiness');
  assert.equal(readiness.safeParse({ missionId: 'mission-1', ready: false, nextAction: null, blockers: [] }).success, true);

  const timeline = toolOutputZodSchema(z, 'mission_timeline');
  assert.equal(timeline.safeParse([{ type: 'mission_planned', missionId: 'mission-1', at: 'now', futureField: true }]).success, true);
  assert.equal(timeline.safeParse({ result: [] }).success, false);

  for (const name of TOOL_NAMES) assert.ok(toolOutputZodSchema(z, name), `missing Zod output contract for ${name}`);
});
