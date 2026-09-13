import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { PostgresStateBackend } from '../src/postgres-state-backend.mjs';
import { createStateBackend, resolveStateBackendConfig } from '../src/state-backend-factory.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('state backend configuration defaults to local JSON and rejects unknown kinds', async () => {
  assert.deepEqual(resolveStateBackendConfig({ env: {} }), { kind: 'local-json' });
  assert.throws(
    () => resolveStateBackendConfig({ env: { VETERAN_ENGINEER_STATE_BACKEND: 'mystery' } }),
    (error) => error.code === 'STATE_BACKEND_CONFIGURATION_INVALID'
  );
});

test('postgres selection requires explicit connection and instance identity', () => {
  assert.throws(
    () => resolveStateBackendConfig({ env: { VETERAN_ENGINEER_STATE_BACKEND: 'postgres' } }),
    (error) => error.code === 'STATE_BACKEND_CONFIGURATION_INVALID'
  );
  assert.throws(
    () => resolveStateBackendConfig({ env: { VETERAN_ENGINEER_STATE_BACKEND: 'postgres', VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://example/db' } }),
    (error) => error.code === 'STATE_BACKEND_CONFIGURATION_INVALID'
  );
  assert.deepEqual(
    resolveStateBackendConfig({ env: {
      VETERAN_ENGINEER_STATE_BACKEND: 'postgres',
      VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://example/db',
      VETERAN_ENGINEER_STATE_INSTANCE: 'team-a',
      VETERAN_ENGINEER_POSTGRES_POOL_MAX: '6'
    } }),
    { kind: 'postgres', connectionString: 'postgresql://example/db', instanceKey: 'team-a', poolMax: 6 }
  );
});

test('state backend factory constructs explicit local and postgres implementations without implicit fallback', async () => {
  const root = await tempDir('veteran-backend-factory-');
  try {
    const local = createStateBackend({ stateRoot: root, env: {} });
    assert.ok(local instanceof LocalJsonStateBackend);

    const postgres = createStateBackend({ stateRoot: root, config: {
      kind: 'postgres',
      connectionString: 'postgresql://example.invalid/veteran',
      instanceKey: 'factory-test'
    } });
    assert.ok(postgres instanceof PostgresStateBackend);
    assert.equal(postgres.backendKind, 'postgres');
    assert.equal(postgres.instanceKey, 'factory-test');
  } finally {
    await cleanup(root);
  }
});
