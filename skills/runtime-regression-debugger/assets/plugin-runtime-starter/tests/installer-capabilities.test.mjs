import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectPostgresStateCapability } from '../src/installer/capabilities.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function installFakePg(runtimeRoot, version) {
  const packageDir = path.join(runtimeRoot, 'node_modules', 'pg');
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), `${JSON.stringify({ name: 'pg', version })}\n`);
}

test('local-json doctor treats PostgreSQL driver as optional capability', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-local-');
  try {
    const report = await inspectPostgresStateCapability({ runtimeRoot, env: {} });
    assert.equal(report.ok, true);
    assert.equal(report.selected, 'local-json');
    assert.equal(report.postgresSelected, false);
    assert.equal(report.driver.installed, false);
    const driverCheck = report.checks.find((item) => item.name === 'postgres-driver');
    assert.equal(driverCheck.optional, true);
    assert.equal(driverCheck.ok, false);
  } finally {
    await cleanup(runtimeRoot);
  }
});

test('PostgreSQL selection normalizes backend kind, requires exact driver, and does not leak connection secrets', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-postgres-');
  const env = {
    VETERAN_ENGINEER_STATE_BACKEND: ' PoStGrEs ',
    VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://user:supersecret@example.invalid/db',
    VETERAN_ENGINEER_STATE_INSTANCE: 'capability-test',
    VETERAN_ENGINEER_POSTGRES_POOL_MAX: '7'
  };
  try {
    const missing = await inspectPostgresStateCapability({ runtimeRoot, env });
    assert.equal(missing.ok, false);
    assert.equal(missing.selected, 'postgres');
    assert.equal(missing.postgresSelected, true);
    assert.equal(missing.config.valid, true);
    assert.equal(missing.driver.installed, false);
    assert.equal(missing.checks.find((item) => item.name === 'postgres-driver').optional, false);

    await installFakePg(runtimeRoot, '8.22.0');
    const mismatch = await inspectPostgresStateCapability({ runtimeRoot, env });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.driver.installedVersion, '8.22.0');
    assert.equal(mismatch.driver.requiredVersion, '8.23.0');
    assert.equal(JSON.stringify(mismatch).includes('supersecret'), false);

    await installFakePg(runtimeRoot, '8.23.0');
    const exact = await inspectPostgresStateCapability({ runtimeRoot, env });
    assert.equal(exact.ok, true);
    assert.equal(exact.config.poolMax, 7);
    assert.equal(exact.driver.exact, true);
    assert.equal(JSON.stringify(exact).includes('supersecret'), false);
  } finally {
    await cleanup(runtimeRoot);
  }
});

test('PostgreSQL capability reports missing configuration without echoing sensitive URL values', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-config-');
  try {
    await installFakePg(runtimeRoot, '8.23.0');
    const report = await inspectPostgresStateCapability({
      runtimeRoot,
      env: {
        VETERAN_ENGINEER_STATE_BACKEND: 'postgres',
        VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://user:anothersecret@example.invalid/db'
      }
    });
    assert.equal(report.ok, false);
    assert.equal(report.config.valid, false);
    assert.equal(report.config.errorCode, 'STATE_BACKEND_CONFIGURATION_INVALID');
    assert.equal(report.config.instanceConfigured, false);
    assert.equal(JSON.stringify(report).includes('anothersecret'), false);
  } finally {
    await cleanup(runtimeRoot);
  }
});
