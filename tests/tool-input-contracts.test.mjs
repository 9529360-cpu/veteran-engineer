import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  TOOL_NAMES,
  toolInputJsonSchema,
  toolInputZodSchema,
  toolRequiresRequestId
} from '../src/tool-catalog.mjs';

const REQUIRED_BY_TOOL = {
  project_open: [],
  project_snapshot: ['projectId'],
  mission_plan: ['projectId', 'goal', 'doneDefinition'],
  mission_execute: ['missionId'],
  mission_status: ['missionId'],
  mission_advance: ['missionId'],
  mission_readiness: ['missionId'],
  mission_timeline: ['missionId'],
  mission_cancel: ['missionId'],
  mission_resume: ['missionId'],
  task_result_commit: ['missionId', 'taskId'],
  worker_cancel: ['missionId', 'taskId'],
  worker_resume: ['missionId', 'taskId'],
  worker_retry: ['missionId', 'taskId'],
  evidence_query: [],
  validation_capabilities: ['projectId'],
  validation_run: ['projectId'],
  review_run: ['missionId'],
  semantic_review_run: ['missionId'],
  remediation_plan: ['missionId'],
  candidate_preflight: ['missionId'],
  candidate_refresh: ['missionId'],
  candidate_status: ['missionId'],
  experience_query: ['projectId'],
  experience_commit: ['projectId', 'mechanism', 'statement', 'kind'],
  experience_review: ['experienceId', 'action'],
  experience_challenge: ['experienceId', 'statement'],
  experience_audit: [],
  experience_compact: ['projectId'],
  machine_inspect: ['operation'],
  machine_act: ['operation'],
  runtime_health: [],
  runtime_integrity: [],
  runtime_cleanup: [],
  runtime_maintenance: [],
  handoff_export: ['missionId']
};

test('every public tool publishes one semantic input contract', () => {
  assert.equal(TOOL_NAMES.length, 36);
  assert.deepEqual(Object.keys(REQUIRED_BY_TOOL).sort(), [...TOOL_NAMES].sort());
  for (const name of TOOL_NAMES) {
    const schema = toolInputJsonSchema(name);
    assert.equal(schema.type, 'object', `${name} must publish an object input schema`);
    assert.equal(schema.additionalProperties, true, `${name} must preserve forward-compatible passthrough`);
    const expected = [...REQUIRED_BY_TOOL[name], ...(toolRequiresRequestId(name) ? ['requestId'] : [])].sort();
    assert.deepEqual([...(schema.required || [])].sort(), expected, `${name} required input contract drifted`);
  }
});

test('flagship tools expose the parameters needed to complete the product workflow', () => {
  const open = toolInputJsonSchema('project_open');
  assert.deepEqual(Object.keys(open.properties).sort(), ['name', 'refreshRemote', 'repoPath', 'repoUrl', 'requestId'].sort());
  assert.match(open.description, /exactly one of repoPath or repoUrl/i);

  const plan = toolInputJsonSchema('mission_plan');
  assert.equal(plan.properties.tasks.maxItems, 64);
  assert.deepEqual(plan.properties.tasks.items.required, ['contract', 'owner']);
  assert.deepEqual(plan.properties.riskEnvelope.enum, ['low', 'medium', 'high', 'critical']);

  const execute = toolInputJsonSchema('mission_execute');
  assert.equal(execute.properties.runWorkers.type, 'boolean');
  assert.equal(execute.properties.bootstrapAuthorization.properties.allowNetwork.type, 'boolean');
  assert.equal(execute.properties.bootstrapAuthorization.properties.credentialRefs.items.required.includes('name'), true);

  const validation = toolInputJsonSchema('validation_run');
  assert.deepEqual(validation.properties.purpose.enum, ['final-validation', 'runtime-feedback']);
  assert.equal(validation.properties.rawCommand.minItems, 1);

  const review = toolInputJsonSchema('experience_review');
  assert.deepEqual(review.properties.action.enum, ['activate', 'reject', 'reactivate', 'retire']);
  assert.equal(toolInputJsonSchema('runtime_cleanup').properties.apply.type, 'boolean');
  const machineInspect = toolInputJsonSchema('machine_inspect');
  assert.equal(machineInspect.properties.operation.enum.includes('repo.status'), true);
  assert.equal(machineInspect.properties.operation.enum.includes('fs.digest'), true);
  const machineAct = toolInputJsonSchema('machine_act');
  assert.equal(machineAct.properties.expectedSha256.type, 'string');
  assert.equal(machineAct.properties.expectedRepoHead.type, 'string');
  assert.equal(machineAct.properties.requireAbsent.type, 'boolean');
});

test('official SDK Zod contracts are generated from the same canonical tool schema', () => {
  const missionPlan = toolInputZodSchema(z, 'mission_plan');
  assert.equal(missionPlan.safeParse({
    requestId: 'req-1',
    projectId: 'project-1',
    goal: 'ship the feature',
    doneDefinition: 'all acceptance criteria pass',
    tasks: [{ contract: 'implement behavior', owner: 'src', risk: 'low', futureTaskField: 'preserved' }],
    futureTopLevelField: { preserved: true }
  }).success, true);
  assert.equal(missionPlan.safeParse({ requestId: 'req-1', projectId: 'project-1', goal: 'missing done definition' }).success, false);
  assert.equal(missionPlan.safeParse({
    requestId: 'req-1', projectId: 'project-1', goal: 'g', doneDefinition: 'd', tasks: [{ contract: 'c', owner: 'o', risk: 'impossible' }]
  }).success, false);

  const status = toolInputZodSchema(z, 'mission_status');
  assert.equal(status.safeParse({}).success, false);
  assert.equal(status.safeParse({ missionId: 'mission-1', futureField: true }).success, true);

  const health = toolInputZodSchema(z, 'runtime_health');
  assert.equal(health.safeParse({}).success, true);
});
