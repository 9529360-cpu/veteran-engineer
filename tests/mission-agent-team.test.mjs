import assert from 'node:assert/strict';
import test from 'node:test';
import { missionAgentTeam } from '../src/mission-service.mjs';

test('primary Agent is sole mission authority; a role-only planned task is not a real subagent', () => {
  const team = missionAgentTeam({ id: 'M1' }, [{
    id: 'T1', owner: 'frontend', dispatches: [{ id: 'D1', runWorkers: false, status: 'ready' }]
  }]);
  assert.equal(team.lead.rank, 'primary');
  assert.equal(team.lead.authority, 'planning-integration-review-and-final-acceptance');
  assert.deepEqual(team.members, []);
  assert.equal(team.memberCount, 0);
  assert.equal(team.unconfirmedLaunches, 0);
});

test('real worker dispatch becomes a subordinate first-class Agent with stable identity across retries', () => {
  const team = missionAgentTeam({ id: 'M1' }, [{
    id: 'T1', owner: 'backend', worker: 'codex',
    dispatches: [
      { id: 'D0', runWorkers: false, status: 'ready' },
      { id: 'D1', runWorkers: true, workerSpawnConfirmed: true, status: 'failed' },
      { id: 'D2', runWorkers: true, workerSpawnConfirmed: true, status: 'integrated' }
    ]
  }, {
    id: 'T2', owner: 'database', worker: 'codex',
    dispatches: [{ id: 'D3', runWorkers: true, workerSpawnConfirmed: true, status: 'executing' }]
  }]);
  assert.equal(team.members.length, 2);
  assert.equal(team.members[0].agentId, 'agent:M1:T1');
  assert.equal(team.members[0].parentAgentId, team.lead.agentId);
  assert.equal(team.members[0].rank, 'subordinate');
  assert.equal(team.members[0].execution, 'independent-runtime-worker');
  assert.equal(team.members[0].attempts, 2);
  assert.equal(team.members[0].latestDispatchId, 'D2');
  assert.equal(team.members[0].status, 'integrated');
  assert.equal(team.members[1].status, 'executing');
  assert.equal(team.members[1].liveness, 'not-attested-by-status');
  assert.equal(team.unconfirmedLaunches, 0);
});

test('dispatch and supervisor-only failures do not become fake independent Agents', () => {
  const team = missionAgentTeam({ id: 'M2' }, [{ id: 'T1', owner: 'frontend', dispatches: [{ id: 'D1', runWorkers: true, status: 'executing' }] }, { id: 'T2', owner: 'backend', dispatches: [{ id: 'D2', runWorkers: true, workerSpawnConfirmed: false, status: 'failed' }] }]);
  assert.equal(team.memberCount, 0);
  assert.deepEqual(team.members, []);
  assert.equal(team.unconfirmedLaunches, 2);
});
