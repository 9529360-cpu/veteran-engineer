import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function seedActiveExperience(app) {
  await app.store.transaction('test_experience_query_seeded', (state) => {
    state.experiences.exp_readonly = {
      id: 'exp_readonly',
      projectId: 'project-readonly',
      scopeType: 'project',
      scopeId: 'project-readonly',
      mechanism: 'planning',
      statement: 'Prefer verified repository truth over stale assumptions.',
      kind: 'lesson',
      equivalenceClass: null,
      evidenceIds: [],
      sourceIdentity: null,
      appliesWhen: null,
      doesNotApplyWhen: null,
      expiresAt: null,
      status: 'active',
      reviewStatus: 'approved',
      supersedes: [],
      supersededBy: [],
      challenges: [],
      usage: { count: 0, lastUsedAt: null },
      canonical: 'test',
      createdAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

test('public experience_query is read-only even if a caller tries to pass the internal usage flag', async () => {
  const stateRoot = await tempDir('veteran-experience-query-readonly-');
  try {
    const app = await createVeteranApp({ stateRoot });
    await seedActiveExperience(app);

    const result = await app.callTool('experience_query', {
      projectId: 'project-readonly',
      recordUsage: true
    });
    assert.equal(result.items.length, 1);

    const afterQuery = await app.store.read();
    assert.equal(afterQuery.experiences.exp_readonly.usage.count, 0);
    assert.equal(afterQuery.experiences.exp_readonly.usage.lastUsedAt, null);

    const routed = await app.services.experienceService.route({ projectId: 'project-readonly' });
    assert.equal(routed.items.length, 1);
    const afterRoute = await app.store.read();
    assert.equal(afterRoute.experiences.exp_readonly.usage.count, 1);
    assert.ok(afterRoute.experiences.exp_readonly.usage.lastUsedAt);
  } finally {
    await cleanup(stateRoot);
  }
});
