import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectMcpSdkIntegrity, PINNED_MCP_PACKAGES } from '../src/mcp-sdk-integrity.mjs';
import { runProcess } from '../src/git.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, '..');
const server = path.join(runtimeRoot, 'mcp', 'server.mjs');

async function fixture({ versions = {}, lock = true, badIntegrity = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-sdk-integrity-'));
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({ optionalDependencies: PINNED_MCP_PACKAGES }, null, 2)}\n`);
  for (const [name, version] of Object.entries(versions)) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name, version })}\n`);
  }
  if (lock) {
    const packages = { '': { optionalDependencies: PINNED_MCP_PACKAGES } };
    for (const [name, expected] of Object.entries(PINNED_MCP_PACKAGES)) {
      packages[`node_modules/${name}`] = { version: expected, integrity: name === badIntegrity ? 'not-verified' : `sha512-${Buffer.from(name).toString('base64')}`, optional: true };
    }
    await fs.writeFile(path.join(root, 'package-lock.json'), `${JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages }, null, 2)}\n`);
  }
  return root;
}

test('SDK integrity reports a fully absent installed graph as unavailable without inventing modern support', async () => {
  const root = await fixture();
  try {
    const report = await inspectMcpSdkIntegrity(root);
    assert.equal(report.status, 'unavailable');
    assert.equal(report.graph.status, 'unavailable');
    assert.equal(report.lockfile.status, 'verified');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('SDK integrity verifies the exact client/server/core/zod graph and lockfile evidence', async () => {
  const root = await fixture({ versions: PINNED_MCP_PACKAGES });
  try {
    const report = await inspectMcpSdkIntegrity(root);
    assert.equal(report.status, 'verified');
    assert.equal(report.graph.status, 'verified');
    assert.equal(report.lockfile.status, 'verified');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('SDK integrity fails closed for partial or version-drifted installed graphs', async () => {
  const versions = { ...PINNED_MCP_PACKAGES, '@modelcontextprotocol/core': '2.1.0' };
  delete versions.zod;
  const root = await fixture({ versions });
  try {
    const report = await inspectMcpSdkIntegrity(root);
    assert.equal(report.status, 'invalid');
    assert.match(report.graph.errors.join('\n'), /core expected 2\.0\.0, found 2\.1\.0/);
    assert.match(report.graph.errors.join('\n'), /zod is missing/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('SDK integrity rejects a missing lockfile or lock entry without npm integrity', async () => {
  const missing = await fixture({ versions: PINNED_MCP_PACKAGES, lock: false });
  const corrupt = await fixture({ versions: PINNED_MCP_PACKAGES, badIntegrity: '@modelcontextprotocol/server' });
  try {
    assert.equal((await inspectMcpSdkIntegrity(missing)).status, 'invalid');
    const report = await inspectMcpSdkIntegrity(corrupt);
    assert.equal(report.status, 'invalid');
    assert.match(report.lockfile.errors.join('\n'), /server has no sha512 integrity/);
  } finally {
    await fs.rm(missing, { recursive: true, force: true });
    await fs.rm(corrupt, { recursive: true, force: true });
  }
});

test('VETERAN_MCP_REQUIRE_SDK=1 never degrades to the forced standalone fallback', async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-require-sdk-'));
  try {
    const result = await runProcess(process.execPath, [server], {
      cwd: runtimeRoot,
      env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: state, VETERAN_MCP_FORCE_FALLBACK: '1', VETERAN_MCP_REQUIRE_SDK: '1' },
      allowFailure: true,
      timeoutMs: 10_000
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Official MCP SDK required but unavailable/);
  } finally { await fs.rm(state, { recursive: true, force: true }); }
});
