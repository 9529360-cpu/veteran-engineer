import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import {
  appendRemoteHostServiceLog,
  buildWindowsScheduledTaskSpec,
  controlRemoteHostService,
  installRemoteHostService,
  remoteHostServiceStatus,
  superviseRemoteHostService,
  uninstallRemoteHostService
} from '../src/remote-host-service.mjs';
import { PROCESS_LIFECYCLE_STATE } from '../src/process-lifecycle-authority.mjs';
import { cleanup, tempDir } from './helpers.mjs';

function fakeSchtasks(calls, { queryExists = true } = {}) {
  return (command, args) => {
    calls.push([command, [...args]]);
    if (command !== 'schtasks') return { status: 1, stdout: '', stderr: 'unexpected command' };
    if (args[0] === '/Query' && !queryExists) return { status: 1, stdout: '', stderr: 'missing' };
    return { status: 0, stdout: '', stderr: '' };
  };
}

async function fixture() {
  const root = await tempDir('veteran-remote-service-');
  const workspace = path.join(root, 'workspace');
  const serviceRoot = path.join(root, 'service');
  const configPath = path.join(root, 'remote-host.json');
  const cliPath = path.join(root, 'veteran-remote-host.mjs');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(cliPath, '#!/usr/bin/env node\n');
  const initialized = await initRemoteHostConfig({
    configPath,
    stateRoot: path.join(root, 'state'),
    workspaces: [workspace],
    port: 0
  });
  return { root, workspace, serviceRoot, configPath, cliPath, initialized };
}

test('Windows scheduled task registration contains only a Veteran-owned launcher path', async () => {
  const fx = await fixture();
  try {
    const spec = buildWindowsScheduledTaskSpec({
      configPath: fx.configPath,
      serviceRoot: fx.serviceRoot,
      nodePath: process.execPath,
      cliPath: fx.cliPath
    });
    assert.match(spec.taskName, /^Veteran Remote Host [0-9a-f]{12}$/);
    assert.equal(spec.createArgs[0], '/Create');
    assert.equal(spec.createArgs.includes('/SC'), true);
    assert.equal(spec.createArgs.includes('ONLOGON'), true);
    assert.match(spec.taskAction, /remote-host-service\.cmd/);
    assert.equal(spec.taskAction.includes(fx.initialized.pairingToken), false);
    assert.match(spec.launcherContent, / supervise --config /);
    assert.equal(spec.launcherContent.includes(fx.initialized.pairingToken), false);
  } finally {
    await cleanup(fx.root);
  }
});

test('install, repair, control, status, and uninstall keep service state under Veteran-owned paths', async () => {
  const fx = await fixture();
  const calls = [];
  const runSync = fakeSchtasks(calls);
  try {
    const installed = await installRemoteHostService({
      configPath: fx.configPath,
      serviceRoot: fx.serviceRoot,
      cliPath: fx.cliPath,
      platform: 'win32',
      runSync,
      startNow: false
    });
    assert.equal(installed.installed, true);
    assert.equal(installed.repaired, false);
    assert.equal(installed.started, false);
    assert.equal(installed.desiredState, 'running');
    assert.equal(calls.some(([, args]) => args[0] === '/Create'), true);
    assert.equal(calls.some(([, args]) => args[0] === '/Run'), false);
    const launcher = await fs.readFile(path.join(fx.serviceRoot, 'remote-host-service.cmd'), 'utf8');
    assert.equal(launcher.includes(fx.initialized.pairingToken), false);

    const status = await remoteHostServiceStatus({
      serviceRoot: fx.serviceRoot,
      platform: 'win32',
      runSync,
      kill() {
        const error = new Error('missing');
        error.code = 'ESRCH';
        throw error;
      }
    });
    assert.equal(status.installed, true);
    assert.equal(status.registration, 'registered');
    assert.equal(status.desiredState, 'running');
    assert.equal(status.runtimeState, 'waiting');

    const paused = await controlRemoteHostService('pause', {
      serviceRoot: fx.serviceRoot,
      platform: 'win32',
      runSync
    });
    assert.equal(paused.desiredState, 'paused');

    const resumed = await controlRemoteHostService('resume', {
      serviceRoot: fx.serviceRoot,
      platform: 'win32',
      runSync
    });
    assert.equal(resumed.taskRunRequested, true);
    assert.equal(calls.some(([, args]) => args[0] === '/Run'), true);

    const repaired = await installRemoteHostService({
      configPath: fx.configPath,
      serviceRoot: fx.serviceRoot,
      cliPath: fx.cliPath,
      platform: 'win32',
      runSync,
      force: true,
      startNow: false,
      signalTree: () => ({ signalled: false })
    });
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.desiredState, 'running');
    assert.ok(repaired.service.repairedAt);

    const removed = await uninstallRemoteHostService({
      serviceRoot: fx.serviceRoot,
      platform: 'win32',
      runSync,
      signalTree: () => ({ signalled: false })
    });
    assert.equal(removed.removed, true);
    await assert.rejects(fs.access(path.join(fx.serviceRoot, 'service.json')));
    assert.equal(calls.some(([, args]) => args[0] === '/Delete'), true);
  } finally {
    await cleanup(fx.root);
  }
});

test('service log rotation is bounded and preserves recent history', async () => {
  const root = await tempDir('veteran-remote-log-');
  try {
    const logPath = path.join(root, 'logs', 'remote-host.log');
    await appendRemoteHostServiceLog(logPath, 'a'.repeat(48), { maxBytes: 64, maxFiles: 2 });
    await appendRemoteHostServiceLog(logPath, 'b'.repeat(48), { maxBytes: 64, maxFiles: 2 });
    assert.equal(await fs.readFile(`${logPath}.1`, 'utf8'), 'a'.repeat(48));
    assert.equal(await fs.readFile(logPath, 'utf8'), 'b'.repeat(48));
    await appendRemoteHostServiceLog(logPath, 'c'.repeat(48), { maxBytes: 64, maxFiles: 2 });
    assert.equal(await fs.readFile(`${logPath}.2`, 'utf8'), 'a'.repeat(48));
    assert.equal(await fs.readFile(`${logPath}.1`, 'utf8'), 'b'.repeat(48));
    assert.equal(await fs.readFile(logPath, 'utf8'), 'c'.repeat(48));
  } finally {
    await cleanup(root);
  }
});

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }
}

test('supervisor restarts a failed host child and cleans PID authority on shutdown', async () => {
  const fx = await fixture();
  const calls = [];
  const runSync = fakeSchtasks(calls);
  const controller = new AbortController();
  const children = new Map();
  let spawns = 0;
  try {
    await installRemoteHostService({
      configPath: fx.configPath,
      serviceRoot: fx.serviceRoot,
      cliPath: fx.cliPath,
      platform: 'win32',
      runSync,
      startNow: false
    });
    const spawnImpl = () => {
      spawns += 1;
      const child = new FakeChild(2_000 + spawns);
      children.set(child.pid, child);
      if (spawns === 1) {
        setImmediate(() => {
          child.stderr.write('first child failed\n');
          child.emit('exit', 17, null);
        });
      } else {
        setTimeout(() => controller.abort(), 5);
      }
      return child;
    };
    const signalTree = (pid, signal) => {
      const child = children.get(pid);
      if (child) setImmediate(() => child.emit('exit', signal === 'SIGKILL' ? 137 : 0, signal));
      return { signalled: Boolean(child), pid, signal, scope: 'fake', reason: null };
    };
    const probe = () => ({ state: PROCESS_LIFECYCLE_STATE.MISSING });
    const result = await superviseRemoteHostService({
      serviceRoot: fx.serviceRoot,
      platform: 'win32',
      spawnImpl,
      runSync,
      signalTree,
      probe,
      signal: controller.signal,
      pollMs: 1,
      restartBaseMs: 1,
      restartMaxMs: 2,
      shutdownGraceMs: 10
    });
    assert.equal(result.stopped, true);
    assert.equal(spawns, 2);
    const log = await fs.readFile(path.join(fx.serviceRoot, 'logs', 'remote-host.log'), 'utf8');
    assert.match(log, /child exited pid=2001 code=17/);
    assert.match(log, /restarting after 1ms/);
    await assert.rejects(fs.access(path.join(fx.serviceRoot, 'pid.json')));
    await assert.rejects(fs.access(path.join(fx.serviceRoot, 'supervisor.lock')));
  } finally {
    await cleanup(fx.root);
  }
});
