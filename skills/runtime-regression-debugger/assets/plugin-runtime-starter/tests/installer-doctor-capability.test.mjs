import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');

test('installer doctor fails closed on selected PostgreSQL prerequisites before MCP probes', async () => {
  const home = await tempDir('veteran-installer-doctor-postgres-');
  let execCalls = 0;
  try {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      VETERAN_ENGINEER_STATE_BACKEND: 'postgres',
      VETERAN_ENGINEER_POSTGRES_URL: 'postgresql://user:doctorsecret@example.invalid/db',
      VETERAN_ENGINEER_STATE_INSTANCE: 'doctor-capability-test'
    };
    const installer = new VeteranInstaller({
      distributionRoot,
      home,
      env,
      exec: async () => {
        execCalls += 1;
        throw new Error('MCP probe must not execute when required runtime prerequisites already failed');
      }
    });

    const report = await installer.doctor();
    assert.equal(report.ok, false);
    assert.equal(report.runtime.stateBackend.postgresSelected, true);
    assert.equal(report.runtime.stateBackend.config.valid, true);
    assert.equal(report.runtime.stateBackend.driver.installed, false);
    assert.equal(report.runtime.checks.find((item) => item.name === 'state:postgres-driver')?.optional, false);
    assert.equal(report.runtime.checks.find((item) => item.name === 'mcp-legacy-handshake')?.skipped, true);
    assert.equal(report.runtime.checks.find((item) => item.name === 'mcp-modern-2026-pinned')?.skipped, true);
    assert.equal(execCalls, 0);
    assert.equal(JSON.stringify(report).includes('doctorsecret'), false);
  } finally {
    await cleanup(home);
  }
});
