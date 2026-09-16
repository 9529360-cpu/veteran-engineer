import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceService } from '../src/evidence-service.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function evidenceRecord(id, projectId, createdAt) {
  return {
    id,
    projectId,
    missionId: null,
    taskId: null,
    type: 'test',
    summary: id,
    sourceIdentity: null,
    runtimeIdentity: null,
    artifactPointer: null,
    artifactHash: null,
    attachments: [],
    metadata: {},
    createdAt
  };
}

function serviceWithEvidence() {
  const state = {
    evidence: {
      'evidence-1': evidenceRecord('evidence-1', 'project-1', '2026-01-01T00:00:00.000Z'),
      'evidence-2': evidenceRecord('evidence-2', 'project-2', '2026-01-02T00:00:00.000Z')
    }
  };
  return new EvidenceService({
    store: {
      async read() { return structuredClone(state); }
    }
  });
}

test('evidence query distinguishes omitted ids from an explicit empty id set', async () => {
  const service = serviceWithEvidence();

  assert.deepEqual((await service.query({})).map((item) => item.id), ['evidence-2', 'evidence-1']);
  assert.deepEqual(await service.query({ ids: [] }), []);
  assert.deepEqual((await service.query({ ids: ['evidence-1'] })).map((item) => item.id), ['evidence-1']);
  await assert.rejects(service.query({ ids: null }), /evidence ids must be an array when provided/);
});

test('zero-evidence experience suggestions cannot broaden into an all-evidence query', async () => {
  const projection = toolWorkflowSuggestions('experience_commit', {}, {
    id: 'experience-1',
    projectId: 'project-1',
    status: 'candidate',
    evidenceIds: []
  });
  const inspect = projection.suggestions.find((item) => item.tool === 'evidence_query' && item.kind === 'inspect');
  assert.ok(inspect);
  assert.deepEqual(inspect.arguments, { projectId: 'project-1', ids: [] });

  const service = serviceWithEvidence();
  assert.deepEqual(await service.query(inspect.arguments), []);
});
