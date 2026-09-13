import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { resolveStateBackendConfig } from '../src/state-backend-factory.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('explicit malformed programmatic state backend config never falls back to default or environment selection', () => {
  const environment = {
    VETERAN_ENGINEER_STATE_BACKEND: 'postgres',
    VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://example.invalid/veteran',
    VETERAN_ENGINEER_STATE_INSTANCE: 'shape-test'
  };

  for (const config of [false, 0, '', [], 'postgres']) {
    assert.throws(
      () => resolveStateBackendConfig({ config, env: environment }),
      (error) => error.code === 'STATE_BACKEND_CONFIGURATION_INVALID',
      `malformed config ${JSON.stringify(config)} must not fall back to environment selection`
    );
  }

  assert.deepEqual(resolveStateBackendConfig({ config: null, env: {} }), { kind: 'local-json' });
  assert.deepEqual(resolveStateBackendConfig({ config: undefined, env: {} }), { kind: 'local-json' });
  assert.deepEqual(
    resolveStateBackendConfig({ config: { kind: 'local-json' }, env: environment }),
    { kind: 'local-json' },
    'a valid explicit config must remain authoritative over environment selection'
  );
});

test('createVeteranApp rejects an explicitly malformed stateBackendConfig before backend initialization', async () => {
  const stateRoot = await tempDir('veteran-state-backend-config-shape-');
  try {
    await assert.rejects(
      createVeteranApp({ stateRoot, stateBackendConfig: false, stateBackendEnv: {} }),
      (error) => error.code === 'STATE_BACKEND_CONFIGURATION_INVALID'
    );
  } finally {
    await cleanup(stateRoot);
  }
});
