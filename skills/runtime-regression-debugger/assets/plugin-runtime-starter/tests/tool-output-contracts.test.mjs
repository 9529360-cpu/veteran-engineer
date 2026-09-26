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
  assert.equal(TOOL_NAMES.length, 36);
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
  assert.deepEqual(plan.properties.mission.required, ['id', 'status']);
  assert.ok(plan.properties.tasks.items.properties.id);

  const execute = toolOutputJsonSchema('mission_execute');
  assert.deepEqual(execute.required, ['missionId']);
  assert.ok(execute.properties.results.items.properties.taskId);
  assert.ok(execute.properties.results.items.properties.ok);
  assert.ok(execute.properties.pending.items.properties.taskId);
  assert.ok(execute.properties.tasks.items.properties.taskId);
  assert.equal(Object.hasOwn(execute.properties, 'status'), false);
  assert.equal(Object.hasOwn(execute.properties, 'deferredTaskIds'), false);

  const status = toolOutputJsonSchema('mission_status');
  assert.ok(status.properties.candidates);
  assert.ok(status.properties.mergeProposals);
  assert.deepEqual(status.properties.mission.required, ['id', 'status']);

  const readiness = toolOutputJsonSchema('mission_readiness');
  assert.deepEqual(readiness.required, ['missionId', 'ready', 'phase', 'status']);
  assert.ok(readiness.properties.blockers);

  const candidate = toolOutputJsonSchema('candidate_status');
  assert.ok(candidate.properties.missionId);
  assert.ok(candidate.properties.candidate);

  const health = toolOutputJsonSchema('runtime_health');
  assert.ok(health.required.includes('toolCount'));
  assert.ok(health.properties.mcp);

  const machineInspect = toolOutputJsonSchema('machine_inspect');
  assert.ok(machineInspect.properties.repository);
  assert.ok(machineInspect.properties.digest);
  assert.ok(machineInspect.properties.patch);
  assert.ok(machineInspect.properties.scope);
  assert.ok(machineInspect.properties.staged);
  const machineAct = toolOutputJsonSchema('machine_act');
  assert.ok(machineAct.properties.receipt);
  assert.ok(machineAct.properties.replacements);
  assert.ok(machineAct.properties.afterSha256);
  assert.ok(machineAct.properties.outputSha256);

  const handoff = toolOutputJsonSchema('handoff_export');
  assert.deepEqual(handoff.required, ['id', 'artifactPointer', 'handoff']);
  assert.equal(handoff.properties.handoff.properties.schema.type, 'string');
});

test('mission_execute contract accepts real execution variants and exposes safe task-selection fields', () => {
  const execute = toolOutputZodSchema(z, 'mission_execute');
  assert.equal(execute.safeParse({ missionId: 'm1', phase: 'validation', completed: true }).success, true);
  assert.equal(execute.safeParse({
    missionId: 'm1', waveIndex: 2, reason: 'wave-has-tasks-requiring-retry',
    tasks: [{ taskId: 'T2', status: 'failed' }]
  }).success, true);
  assert.equal(execute.safeParse({
    missionId: 'm1', waveIndex: 2, reason: 'wave-has-outstanding-dispatches',
    pending: [{ taskId: 'T3', status: 'executing', dispatchId: 'dispatch-1' }]
  }).success, true);
  assert.equal(execute.safeParse({
    missionId: 'm1', waveIndex: 2, waveBase: 'abc',
    results: [{ taskId: 'T4', ok: false, commitSha: null, discardedCommitSha: null, runtime: {}, error: { code: 'WORKER_FAILED', message: 'boom' } }],
    preparationFailures: []
  }).success, true);
  assert.equal(execute.safeParse({ results: [] }).success, false);
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

  const status = toolOutputZodSchema(z, 'mission_status');
  assert.equal(status.safeParse({ mission: { id: 'mission-1', status: 'blocked' }, tasks: [] }).success, true);
  assert.equal(status.safeParse({ mission: { id: 'mission-1' }, tasks: [] }).success, false);

  const readiness = toolOutputZodSchema(z, 'mission_readiness');
  assert.equal(readiness.safeParse({ missionId: 'mission-1', ready: false, phase: 'execution', status: 'blocked', nextAction: null, blockers: [] }).success, true);
  assert.equal(readiness.safeParse({ missionId: 'mission-1', ready: false, phase: 'execution', nextAction: null, blockers: [] }).success, false);
  assert.equal(readiness.safeParse({ missionId: 'mission-1', ready: false, status: 'blocked', nextAction: null, blockers: [] }).success, false);

  const timeline = toolOutputZodSchema(z, 'mission_timeline');
  assert.equal(timeline.safeParse([{ type: 'mission_planned', missionId: 'mission-1', at: 'now', futureField: true }]).success, true);
  assert.equal(timeline.safeParse({ result: [] }).success, false);

  for (const name of TOOL_NAMES) assert.ok(toolOutputZodSchema(z, name), `missing Zod output contract for ${name}`);
});
