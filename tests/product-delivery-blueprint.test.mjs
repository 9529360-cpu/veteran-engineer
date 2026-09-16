import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import {
  DELIVERY_STAGES,
  EVIDENCE_TAXONOMY,
  PRODUCT_DELIVERY_BLUEPRINT,
  PRODUCT_DELIVERY_BLUEPRINT_SCHEMA,
  PRODUCT_DELIVERY_META_KEY,
  projectDeliveryReadiness,
  toolProductDeliveryMeta
} from '../src/product-delivery-blueprint.mjs';

test('delivery blueprint is the complete ordered lifecycle authority', () => {
  assert.deepEqual(DELIVERY_STAGES, [
    'discover', 'define', 'design', 'plan', 'build', 'verify',
    'secure', 'provision', 'release', 'observe', 'operate', 'learn'
  ]);
  assert.equal(PRODUCT_DELIVERY_BLUEPRINT.schema, PRODUCT_DELIVERY_BLUEPRINT_SCHEMA);
  assert.equal(PRODUCT_DELIVERY_BLUEPRINT.authority, 'existing-project-mission-workflow-owners');
  assert.equal(PRODUCT_DELIVERY_BLUEPRINT.stages.length, 12);
  for (const stage of PRODUCT_DELIVERY_BLUEPRINT.stages) {
    assert.ok(stage.evidence.length > 0, stage.id);
    assert.ok(stage.recovery.length > 0, stage.id);
    assert.ok(stage.invalidatedBy.length > 0, stage.id);
  }
  for (const category of ['product', 'experience', 'engineering', 'security', 'delivery', 'operations', 'learning']) {
    assert.ok(EVIDENCE_TAXONOMY[category].length > 0, category);
  }
});

test('all 34 public tools map into the lifecycle without changing the surface', () => {
  assert.equal(TOOL_NAMES.length, 34);
  for (const name of TOOL_NAMES) {
    const metadata = toolProductDeliveryMeta(name)[PRODUCT_DELIVERY_META_KEY];
    assert.equal(metadata.schema, PRODUCT_DELIVERY_BLUEPRINT_SCHEMA, name);
    assert.ok(metadata.stages.length > 0, name);
    assert.match(metadata.readinessRule, /capability only/);
  }
  assert.equal(toolProductDeliveryMeta('project_open')[PRODUCT_DELIVERY_META_KEY].blueprint, PRODUCT_DELIVERY_BLUEPRINT);
  assert.equal(toolProductDeliveryMeta('mission_execute')[PRODUCT_DELIVERY_META_KEY].blueprint, undefined);
});

test('readiness never promotes build completion to production or operational readiness', () => {
  const projection = projectDeliveryReadiness({
    mission: { id: 'mission-1', phase: 'finalize', activeCandidateId: 'candidate-1', activeMergeProposalId: 'proposal-1' },
    tasks: [{ id: 'T1', status: 'completed' }],
    candidates: [{ id: 'candidate-1', proof: { validation: 'skipped', review: 'passed', semanticReview: 'skipped' } }],
    missionBlockers: []
  });
  assert.equal(projection.levels.implementationReady.status, 'ready');
  assert.equal(projection.levels.releaseReady.status, 'ready');
  assert.equal(projection.levels.productionReady.status, 'blocked');
  assert.equal(projection.levels.operationallyReady.status, 'blocked');
  assert.ok(projection.levels.productionReady.blockers.some((item) => item.code === 'PROVISIONING_EVIDENCE_REQUIRED'));
  assert.ok(projection.levels.operationallyReady.blockers.some((item) => item.code === 'BACKUP_RESTORE_AND_DR_DRILL_REQUIRED'));
  assert.ok(projection.declaredProviderGaps.includes('customer-feedback'));
});

test('readiness carries authoritative Mission blockers into implementation and higher levels', () => {
  const projection = projectDeliveryReadiness({
    mission: { id: 'mission-1', phase: 'execution', activeCandidateId: null, activeMergeProposalId: null },
    tasks: [{ id: 'T1', status: 'failed' }],
    candidates: [],
    missionBlockers: [{ code: 'FAILED_TASKS', taskIds: ['T1'] }]
  });
  assert.equal(projection.currentStage, 'build');
  assert.equal(projection.levels.implementationReady.ready, false);
  assert.ok(projection.levels.implementationReady.blockers.some((item) => item.code === 'FAILED_TASKS'));
  assert.ok(projection.levels.releaseReady.blockers.some((item) => item.code === 'IMMUTABLE_CANDIDATE_REQUIRED'));
});
