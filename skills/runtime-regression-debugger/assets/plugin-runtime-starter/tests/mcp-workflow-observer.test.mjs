import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createMcpWorkflowObserver, mcpWorkflowReceipt } from '../src/mcp-workflow-observer.mjs';

const HEAD = 'a'.repeat(40);
const ID = 'evidence_12345678-1234-1234-1234-123456789abc';
const ENV = {
  VETERAN_WORKFLOW_OBSERVER: '1',
  VETERAN_WORKFLOW_JOURNAL: path.resolve('scratch', 'task.json'),
  VETERAN_WORKFLOW_OBSERVER_IMPORTER: path.resolve('scratch', 'workflow_observer.py')
};

test('disabled by default: no observation and no configuration side effects', async () => {
  let delivered = 0;
  const observer = createMcpWorkflowObserver({ env: {}, deliver: async () => { delivered++; return true; } });
  assert.equal(observer.enabled, false);
  assert.equal(await observer.observe('project_snapshot', { requestId: 'req1' }, { sourceIdentity: { head: HEAD } }), false);
  assert.equal(delivered, 0);
});

test('only completed, proof-bound built-in tool results emit sanitized semantic metadata', () => {
  const source = mcpWorkflowReceipt('project_snapshot', { requestId: 'secret-request-id', rawCommand: 'do not store' },
    { sourceIdentity: { head: HEAD }, rawOutput: 'PRIVATE DATA' });
  assert.deepEqual(Object.keys(source), ['event_id', 'workflow', 'activity', 'outcome', 'evidence_ids']);
  assert.equal(source.workflow, 'repo-validation');
  assert.equal(source.activity, 'repo.inspect');
  assert.deepEqual(source.evidence_ids, ['commit:' + HEAD]);
  assert.equal(source.event_id.length, 64);
  assert.equal(JSON.stringify(source).includes('secret-request-id'), false);
  assert.equal(JSON.stringify(source).includes('PRIVATE DATA'), false);

  const implement = mcpWorkflowReceipt('task_result_commit', { requestId: 'r1' },
    { ok: true, integrationSha: HEAD, commitSha: 'b'.repeat(40) });
  assert.equal(implement.activity, 'source.change');
  assert.deepEqual(implement.evidence_ids, ['commit:' + HEAD]);

  const validated = mcpWorkflowReceipt('validation_run', { requestId: 'r2' },
    { passed: true, evidenceId: ID, commitSha: HEAD, command: ['echo', 'PRIVATE'] });
  assert.equal(validated.activity, 'checks.focused');
  assert.deepEqual(validated.evidence_ids, ['runtime:' + ID, 'commit:' + HEAD]);

  const failedReview = mcpWorkflowReceipt('review_run', { requestId: 'r3' },
    { passed: false, evidenceId: ID, head: HEAD, findings: [{ message: 'PRIVATE DATA' }] });
  assert.equal(failedReview.activity, 'review.diff');
  assert.equal(failedReview.outcome, 'failed');
  assert.deepEqual(failedReview.evidence_ids, ['review:' + ID, 'commit:' + HEAD]);
  assert.equal(JSON.stringify(failedReview).includes('PRIVATE DATA'), false);
});

test('no guessed success from unknown, skipped, unproven or malformed outcomes', () => {
  assert.equal(mcpWorkflowReceipt('mission_plan', { requestId: 'r' }, { missionId: 'm' }), null);
  assert.equal(mcpWorkflowReceipt('project_snapshot', {}, { sourceIdentity: { head: HEAD } }), null);
  assert.equal(mcpWorkflowReceipt('project_snapshot', { requestId: 'r' }, { sourceIdentity: { head: 'n/a' } }), null);
  assert.equal(mcpWorkflowReceipt('validation_run', { requestId: 'r' }, { passed: true }), null);
  assert.equal(mcpWorkflowReceipt('validation_run', { requestId: 'r' }, { passed: 'true', evidenceId: ID }), null);
  assert.equal(mcpWorkflowReceipt('validation_run', { requestId: 'r' }, { passed: true, evidenceId: 'customer-secret' }), null);
  assert.equal(mcpWorkflowReceipt('review_run', { requestId: 'r' }, { passed: true, skipped: true }), null);
  assert.equal(mcpWorkflowReceipt('task_result_commit', { requestId: 'r' }, { ok: false, commitSha: HEAD }), null);
  assert.equal(mcpWorkflowReceipt('semantic_review_run', { requestId: 'r' }, { passed: true, evidenceId: ID }), null);
});

test('delivery is serial, request replays deterministic, failure never changes tool outcome', async () => {
  const observed = [];
  let active = 0;
  let maxActive = 0;
  const warn = [];
  const observer = createMcpWorkflowObserver({
    env: ENV,
    deliver: async (_settings, event) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      observed.push(event);
      active--;
      return observed.length > 1;
    },
    warn: (line) => warn.push(line)
  });
  assert.equal(observer.enabled, true);
  const args = { requestId: 'the-same-id' };
  const [first, second] = await Promise.all([
    observer.observe('review_run', args, { passed: true, head: HEAD, evidenceId: ID }),
    observer.observe('review_run', args, { passed: true, head: HEAD, evidenceId: ID })
  ]);
  assert.equal(first, false);
  assert.equal(second, true);
  assert.equal(maxActive, 1);
  assert.equal(warn.length, 1);
  assert.deepEqual(observed[0], observed[1]);
});

test('enabled observation rejects invalid task-journal and importer configuration before launch', () => {
  assert.throws(() => createMcpWorkflowObserver({ env: { ...ENV, VETERAN_WORKFLOW_JOURNAL: 'relative.json' } }), /absolute/);
  assert.throws(() => createMcpWorkflowObserver({ env: { ...ENV, VETERAN_WORKFLOW_OBSERVER_IMPORTER: path.resolve('scratch', 'arbitrary.py') } }), /workflow_observer/);
});
