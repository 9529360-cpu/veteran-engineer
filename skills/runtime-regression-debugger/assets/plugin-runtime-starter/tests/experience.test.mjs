import assert from 'node:assert/strict';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { ExperienceService } from '../src/experience-service.mjs';
import { tempDir, cleanup } from './helpers.mjs';

test('candidate experience is quarantined until activation and challenge removes it from routing', async () => {
  const root = await tempDir('veteran-exp-');
  try {
    const store = await new StateStore({ root }).init();
    const service = new ExperienceService({ store });
    const candidate = await service.commit({ projectId: 'p1', mechanism: 'mcp', statement: 'Use current evidence', kind: 'precedent', equivalenceClass: 'wire' });
    assert.equal((await service.query({ projectId: 'p1', mechanism: 'mcp' })).items.length, 0);
    await service.review({ experienceId: candidate.id, action: 'activate' });
    assert.equal((await service.query({ projectId: 'p1', mechanism: 'mcp' })).items.length, 1);
    await service.challenge({ experienceId: candidate.id, statement: 'Upstream protocol changed' });
    assert.equal((await service.query({ projectId: 'p1', mechanism: 'mcp' })).items.length, 0);
    await service.review({ experienceId: candidate.id, action: 'reactivate' });
    assert.equal((await service.query({ projectId: 'p1', mechanism: 'mcp' })).items.length, 1);
  } finally {
    await cleanup(root);
  }
});

test('active experiences without an equivalence class remain independent and limit truncation is not a conflict', async () => {
  const root = await tempDir('veteran-exp-unclassified-');
  try {
    const store = await new StateStore({ root }).init();
    const service = new ExperienceService({ store });
    const records = [];
    for (const statement of ['Use owner A', 'Run validation B', 'Preserve contract C']) {
      const item = await service.commit({ projectId: 'p1', mechanism: 'review', statement, kind: 'rule' });
      await service.review({ experienceId: item.id, action: 'activate' });
      records.push(item);
    }
    const full = await service.query({ projectId: 'p1', mechanism: 'review', recordUsage: false });
    assert.deepEqual(full.items.map((item) => item.id), records.map((item) => item.id));
    assert.equal(full.excludedConflicts, 0);

    const limited = await service.query({ projectId: 'p1', mechanism: 'review', limit: 2, recordUsage: false });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.excludedConflicts, 0);
  } finally {
    await cleanup(root);
  }
});

test('conflicting active experiences in same explicit equivalence class are isolated', async () => {
  const root = await tempDir('veteran-exp-conflict-');
  try {
    const store = await new StateStore({ root }).init();
    const service = new ExperienceService({ store });
    const a = await service.commit({ projectId: 'p1', mechanism: 'review', statement: 'A', kind: 'rule', equivalenceClass: 'same' });
    const b = await service.commit({ projectId: 'p1', mechanism: 'review', statement: 'B', kind: 'rule', equivalenceClass: 'same' });
    await service.review({ experienceId: a.id, action: 'activate' });
    await service.review({ experienceId: b.id, action: 'activate' });
    const result = await service.query({ projectId: 'p1', mechanism: 'review' });
    assert.equal(result.items.length, 0);
    assert.equal(result.excludedConflicts, 2);
  } finally {
    await cleanup(root);
  }
});
