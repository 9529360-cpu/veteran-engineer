import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootstrapRemoteHost, parseRemoteBootstrapArgs } from '../scripts/remote-host-release-bootstrap.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function response(body, status = 200) {
  return new Response(body, { status });
}

async function releaseFixture() {
  const selfBytes = await fs.readFile(new URL('../scripts/remote-host-release-bootstrap.mjs', import.meta.url));
  const canonicalBytes = Buffer.from('#!/usr/bin/env node\n// canonical fixture\n');
  const urls = {
    self: 'https://download.test/remote-bootstrap',
    canonical: 'https://download.test/bootstrap'
  };
  const release = {
    id: 77,
    tag_name: 'v0.5.0',
    target_commitish: 'a'.repeat(40),
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'veteran-engineer-remote-host-bootstrap.mjs',
        size: selfBytes.length,
        digest: `sha256:${sha256(selfBytes)}`,
        browser_download_url: urls.self
      },
      {
        name: 'veteran-engineer-bootstrap.mjs',
        size: canonicalBytes.length,
        digest: `sha256:${sha256(canonicalBytes)}`,
        browser_download_url: urls.canonical
      }
    ]
  };
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    if (String(url).endsWith('/repos/test/veteran/releases/latest')) return response(JSON.stringify(release));
    if (url === urls.canonical) return response(canonicalBytes);
    if (url === urls.self) return response(selfBytes);
    return response('missing', 404);
  };
  return { selfBytes, release, fetchImpl, fetchCount: () => fetchCount };
}

test('clean-machine Remote Host bootstrap chains verified runtime install, host init, and service registration', async () => {
  const home = await tempDir('veteran-remote-bootstrap-');
  const fixture = await releaseFixture();
  const calls = [];
  try {
    const runtimeRoot = path.join(home, 'plugins', 'veteran-engineer');
    const remoteCli = path.join(runtimeRoot, 'bin', 'veteran-remote-host.mjs');
    const runCommandImpl = async (command, args) => {
      calls.push([command, [...args]]);
      if (args.includes('generic')) {
        await fs.mkdir(path.dirname(remoteCli), { recursive: true });
        await fs.writeFile(remoteCli, '#!/usr/bin/env node\n');
        return {
          code: 0,
          stdout: JSON.stringify({ ok: true, version: '0.5.0', release: { tag: 'v0.5.0', commit: 'a'.repeat(40) } }),
          stderr: ''
        };
      }
      if (args.includes('init')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            ok: true,
            device: { deviceId: 'device_test', deviceName: 'test-host' },
            pairingToken: 'veteran_secret_once',
            pairingHint: 'abcd1234'
          }),
          stderr: ''
        };
      }
      if (args.includes('install-service')) {
        return {
          code: 0,
          stdout: JSON.stringify({ ok: true, installed: true, service: { taskName: 'Veteran Remote Host test' } }),
          stderr: ''
        };
      }
      return { code: 1, stdout: '', stderr: 'unexpected invocation' };
    };

    const result = await bootstrapRemoteHost({
      workspaces: [path.join(home, 'workspace-a'), path.join(home, 'workspace-b')],
      home,
      repository: 'test/veteran',
      apiBase: 'https://api.test',
      fetchImpl: fixture.fetchImpl,
      selfBytes: fixture.selfBytes,
      platform: 'win32',
      nodeVersion: '20.20.2',
      gitExecutable: 'C:\\Program Files\\Git\\cmd\\git.exe',
      startService: false,
      runCommandImpl
    });

    assert.equal(result.ok, true);
    assert.equal(result.pairingToken, 'veteran_secret_once');
    assert.equal(result.device.deviceId, 'device_test');
    assert.equal(calls.length, 3);
    const canonicalArgs = calls[0][1];
    assert.deepEqual(canonicalArgs.slice(1, 4), ['install', 'generic', '--release']);
    assert.equal(canonicalArgs.includes('v0.5.0'), true);
    assert.equal(canonicalArgs.includes('secure-tunnel'), true);
    const initArgs = calls[1][1];
    assert.equal(initArgs.filter((arg) => arg === '--workspace').length, 2);
    assert.equal(initArgs.includes('127.0.0.1'), true);
    const serviceArgs = calls[2][1];
    assert.equal(serviceArgs.includes('--no-start'), true);
    assert.equal(serviceArgs.includes('veteran_secret_once'), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Remote Host bootstrap rejects unsupported platform before release network access', async () => {
  const fixture = await releaseFixture();
  await assert.rejects(bootstrapRemoteHost({
    workspaces: ['workspace'],
    platform: 'linux',
    fetchImpl: fixture.fetchImpl,
    selfBytes: fixture.selfBytes
  }), (error) => error.code === 'REMOTE_BOOTSTRAP_PLATFORM_UNSUPPORTED');
  assert.equal(fixture.fetchCount(), 0);
});

test('Remote Host bootstrap verifies its own release identity before installing anything', async () => {
  const fixture = await releaseFixture();
  const home = await tempDir('veteran-remote-bootstrap-self-');
  let commands = 0;
  try {
    await assert.rejects(bootstrapRemoteHost({
      workspaces: [path.join(home, 'workspace')],
      home,
      repository: 'test/veteran',
      apiBase: 'https://api.test',
      fetchImpl: fixture.fetchImpl,
      selfBytes: Buffer.from('tampered'),
      platform: 'win32',
      nodeVersion: '20.20.2',
      gitExecutable: 'git.exe',
      runCommandImpl: async () => { commands += 1; return { code: 0, stdout: '{}', stderr: '' }; }
    }), (error) => error.code === 'REMOTE_BOOTSTRAP_SELF_DIGEST_MISMATCH');
    assert.equal(commands, 0);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('service install failure preserves runtime/config recovery boundary and does not return the pairing token', async () => {
  const home = await tempDir('veteran-remote-bootstrap-recovery-');
  const fixture = await releaseFixture();
  try {
    const runtimeRoot = path.join(home, 'plugins', 'veteran-engineer');
    const remoteCli = path.join(runtimeRoot, 'bin', 'veteran-remote-host.mjs');
    const runCommandImpl = async (_command, args) => {
      if (args.includes('generic')) {
        await fs.mkdir(path.dirname(remoteCli), { recursive: true });
        await fs.writeFile(remoteCli, '#!/usr/bin/env node\n');
        return { code: 0, stdout: JSON.stringify({ ok: true, version: '0.5.0', release: { tag: 'v0.5.0', commit: 'a'.repeat(40) } }), stderr: '' };
      }
      if (args.includes('init')) {
        return { code: 0, stdout: JSON.stringify({ ok: true, device: { deviceId: 'device_test' }, pairingToken: 'veteran_unreturned' }), stderr: '' };
      }
      return { code: 5, stdout: '', stderr: 'task scheduler denied' };
    };
    await assert.rejects(bootstrapRemoteHost({
      workspaces: [path.join(home, 'workspace')],
      home,
      repository: 'test/veteran',
      apiBase: 'https://api.test',
      fetchImpl: fixture.fetchImpl,
      selfBytes: fixture.selfBytes,
      platform: 'win32',
      nodeVersion: '20.20.2',
      gitExecutable: 'git.exe',
      runCommandImpl
    }), (error) => {
      assert.equal(error.code, 'REMOTE_BOOTSTRAP_SERVICE_INSTALL_FAILED');
      assert.match(error.message, /preserved/);
      assert.match(error.message, /rotate the pairing token/);
      assert.equal(error.message.includes('veteran_unreturned'), false);
      assert.equal(error.details.runtimeRoot, runtimeRoot);
      return true;
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('argument parser keeps repeatable workspace authority and no-start intent', () => {
  assert.deepEqual(parseRemoteBootstrapArgs([
    'install',
    '--release', 'v0.5.0',
    '--workspace', 'D:\\VeteranWorkspace',
    '--workspace', 'E:\\Projects',
    '--no-start',
    '--json'
  ]), {
    command: 'install',
    release: 'v0.5.0',
    workspaces: ['D:\\VeteranWorkspace', 'E:\\Projects'],
    json: true,
    startService: false
  });
});
