import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('mission cancellation persists authority before worker drain, lease reconciliation, and feedback release', async () => {
  const stateRoot = await tempDir('veteran-mission-cancel-orchestration-');
  try {
    const app = await createVeteranApp({ stateRoot });
    const calls = [];
    const workerDrain = { missionId: 'M1', fenced: true, requested: 1, accepted: 1, tasks: [{ taskId: 'T1', accepted: true }] };
    const capabilityLeaseReconciliation = { missionId: 'M1', released: [{ taskId: 'T2' }], retained: [{ taskId: 'T1', status: 'cancelling' }] };

    app.services.missionService.cancel = async (args) => {
      calls.push({ stage: 'persist', args });
      return { id: args.missionId, status: 'cancelled' };
    };
    app.services.workerAdapter.cancelMission = (missionId) => {
      calls.push({ stage: 'drain', missionId });
      return workerDrain;
    };
    app.services.workerOrchestrator.reconcileMission = async (args) => {
      calls.push({ stage: 'reconcile', args });
      return capabilityLeaseReconciliation;
    };
    app.services.validationService.releaseRuntimeFeedbackSessions = async (args) => {
      calls.push({ stage: 'release-feedback', args });
      return [{ id: 'feedback-session-1' }];
    };

    const result = await app.handlers.mission_cancel({ missionId: 'M1', reason: 'operator-request' });

    assert.deepEqual(calls.map((call) => call.stage), ['persist', 'drain', 'reconcile', 'release-feedback']);
    assert.deepEqual(calls[0].args, { missionId: 'M1', reason: 'operator-request' });
    assert.equal(calls[1].missionId, 'M1');
    assert.deepEqual(calls[2].args, { missionId: 'M1', reason: 'mission-cancel' });
    assert.deepEqual(calls[3].args, { missionId: 'M1', reason: 'mission-cancelled' });
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(result.workerDrain, workerDrain);
    assert.deepEqual(result.capabilityLeaseReconciliation, capabilityLeaseReconciliation);
    assert.equal(result.runtimeFeedbackSessionsReleased, 1);
  } finally {
    await cleanup(stateRoot);
  }
});
