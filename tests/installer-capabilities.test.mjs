import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectPostgresStateCapability } from '../src/installer/capabilities.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function installFakePg(runtimeRoot, version, { exposePool = true } = {}) {
  const packageDir = path.join(runtimeRoot, 'node_modules', 'pg');
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), `${JSON.stringify({ name: 'pg', version, main: 'index.cjs' })}\n`);
  await fs.writeFile(
    path.join(packageDir, 'index.cjs'),
    exposePool ? 'module.exports = { Pool: class Pool {} };\n' : 'module.exports = {};\n'
  );
}

test('local-json doctor treats PostgreSQL driver as optional capability', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-local-');
  try {
    const report = await inspectPostgresStateCapability({ runtimeRoot, env: {} });
    assert.equal(report.ok, true);
    assert.equal(report.selected, 'local-json');
    assert.equal(report.postgresSelected, false);
    assert.equal(report.driver.installed, false);
    assert.equal(report.driver.loadable, false);
    const driverCheck = report.checks.find((item) => item.name === 'postgres-driver');
    assert.equal(driverCheck.optional, true);
    assert.equal(driverCheck.ok, false);
  } finally {
    await cleanup(runtimeRoot);
  }
});

test('PostgreSQL selection trims whitespace, requires exact loadable driver, and does not leak connection secrets', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-postgres-');
  const validRuntimeRoot = await tempDir('veteran-installer-capability-postgres-valid-');
  const env = {
    VETERAN_ENGINEER_STATE_BACKEND: ' postgres ',
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
    assert.equal(mismatch.driver.exact, false);
    assert.equal(mismatch.driver.loadable, false);
    assert.equal(JSON.stringify(mismatch).includes('supersecret'), false);

    await installFakePg(runtimeRoot, '8.23.0', { exposePool: false });
    const invalid = await inspectPostgresStateCapability({ runtimeRoot, env });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.driver.exact, true);
    assert.equal(invalid.driver.loadable, false);
    assert.equal(invalid.driver.ready, false);
    assert.equal(invalid.driver.errorCode, 'POSTGRES_DRIVER_INVALID');

    await installFakePg(validRuntimeRoot, '8.23.0');
    const exact = await inspectPostgresStateCapability({ runtimeRoot: validRuntimeRoot, env });
    assert.equal(exact.ok, true);
    assert.equal(exact.config.poolMax, 7);
    assert.equal(exact.driver.exact, true);
    assert.equal(exact.driver.loadable, true);
    assert.equal(exact.driver.ready, true);
    assert.equal(JSON.stringify(exact).includes('supersecret'), false);
  } finally {
    await cleanup(runtimeRoot);
    await cleanup(validRuntimeRoot);
  }
});

test('state backend kind remains case-sensitive exactly like the runtime factory', async () => {
  const runtimeRoot = await tempDir('veteran-installer-capability-case-');
  try {
    const report = await inspectPostgresStateCapability({
      runtimeRoot,
      env: {
        VETERAN_ENGINEER_STATE_BACKEND: 'PoStGrEs',
        VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://user:casesecret@example.invalid/db',
        VETERAN_ENGINEER_STATE_INSTANCE: 'case-test'
      }
    });
    assert.equal(report.ok, false);
    assert.equal(report.selected, 'PoStGrEs');
    assert.equal(report.postgresSelected, false);
    assert.equal(report.config.valid, false);
    assert.equal(report.config.errorCode, 'STATE_BACKEND_CONFIGURATION_INVALID');
    assert.equal(JSON.stringify(report).includes('casesecret'), false);
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
