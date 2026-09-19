import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeEnvironmentSpec, runEnvironmentLab, main } from '../src/native-environment-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-env-lab-')); }
function listen() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)); }); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('checks command version, env presence, and root paths without exposing env values', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    const secret = 'super-secret-database-url';
    const report = await runEnvironmentLab({
      commands: [{ name: 'node', minVersion: '18.0.0' }],
      env: [{ name: 'DATABASE_URL' }],
      paths: [{ path: 'package.json', type: 'file' }]
    }, { rootDir: root, environment: { DATABASE_URL: secret } });
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.equal(report.summary.failed, 0);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(report.checks.find((item) => item.kind === 'env').present, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('missing required env and path fail while optional checks degrade cleanly', async () => {
  const root = await tempRoot();
  try {
    const report = await runEnvironmentLab({
      env: [{ name: 'REQUIRED_TOKEN' }, { name: 'OPTIONAL_TOKEN', required: false }],
      paths: [{ path: 'missing.txt', type: 'file' }]
    }, { rootDir: root, environment: {} });
    assert.equal(report.passed, false);
    assert.equal(report.summary.failed, 2);
    assert.equal(report.checks.find((item) => item.name === 'OPTIONAL_TOKEN').passed, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('version gates use fixed allowlisted version commands and reject arbitrary executables', async () => {
  assert.throws(() => normalizeEnvironmentSpec({ commands: [{ name: 'bash' }] }), (error) => error.code === 'ENV_LAB_COMMAND_UNSUPPORTED');
  const report = await runEnvironmentLab({ commands: [{ name: 'node', minVersion: '999.0.0' }] });
  const item = report.checks[0];
  assert.equal(item.available, true);
  assert.equal(item.passed, false);
  assert.equal(item.reason, 'version-too-old');
});

test('path checks reject traversal and symlink escapes', async (t) => {
  assert.throws(() => normalizeEnvironmentSpec({ paths: [{ path: '../secret' }] }), (error) => error.code === 'ENV_LAB_CONFIG_INVALID');
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'x');
    try { await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink unavailable'); return; } throw error; }
    await assert.rejects(() => runEnvironmentLab({ paths: [{ path: 'escape.txt', type: 'file' }] }, { rootDir: root }), (error) => error.code === 'ENV_LAB_PATH_ESCAPE');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('loopback port checks distinguish listening and free states', async () => {
  const server = await listen();
  const port = server.address().port;
  try {
    const listening = await runEnvironmentLab({ ports: [{ port, expected: 'listening' }] });
    assert.equal(listening.passed, true, JSON.stringify(listening));
    const wrong = await runEnvironmentLab({ ports: [{ port, expected: 'free' }] });
    assert.equal(wrong.passed, false);
  } finally { await close(server); }
  const free = await runEnvironmentLab({ ports: [{ port, expected: 'free' }] });
  assert.equal(free.passed, true, JSON.stringify(free));
});

test('CLI spec/output paths are root-contained', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'doctor.json'), JSON.stringify({ paths: [{ path: 'doctor.json', type: 'file' }] }));
    await assert.rejects(() => main(['run', '../doctor.json', '--root', root]), (error) => error.code === 'ENV_LAB_PATH_INVALID');
    const code = await main(['run', 'doctor.json', '--root', root, '--out', 'artifacts/report.json']);
    assert.equal(code, 0);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'artifacts/report.json'), 'utf8'));
    assert.equal(saved.contract, 'veteran-native-environment-lab-v1');
    try { await fs.symlink(outside, path.join(root, 'link')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink unavailable'); return; } throw error; }
    await assert.rejects(() => main(['run', 'doctor.json', '--root', root, '--out', 'link/report.json']), (error) => error.code === 'ENV_LAB_PATH_ESCAPE');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
