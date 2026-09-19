import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import {
  controlRemoteHostService,
  installRemoteHostService,
  remoteHostServiceStatus,
  uninstallRemoteHostService
} from '../src/remote-host-service.mjs';
import { signalProcessTree } from '../src/process-lifecycle-authority.mjs';
import { cleanup, tempDir } from './helpers.mjs';


async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!Number.isInteger(port) || port <= 0) throw new Error('Failed to reserve a loopback test port');
  return port;
}

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw new Error(`${label}: ${lastError.message}`, { cause: lastError });
  throw new Error(`${label}: timed out after ${timeoutMs}ms`);
}

async function healthReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (response.status !== 200) return false;
    return (await response.json()).ok === true;
  } catch {
    return false;
  }
}

test('Windows Task Scheduler can register and remove the real Remote Host supervisor action', { skip: process.platform !== 'win32' }, async () => {
  const root = await tempDir('veteran-remote-service-win-');
  const workspace = path.join(root, 'workspace');
  const configPath = path.join(root, 'remote-host.json');
  const serviceRoot = path.join(root, 'service');
  let installed = false;
  try {
    await fs.mkdir(workspace, { recursive: true });
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: path.join(root, 'state'),
      workspaces: [workspace],
      port: 0
    });
    const result = await installRemoteHostService({
      configPath,
      serviceRoot,
      startNow: false
    });
    installed = result.installed;
    assert.equal(result.installed, true);
    assert.equal(result.started, false);
    const status = await remoteHostServiceStatus({ serviceRoot });
    assert.equal(status.registration, 'registered');
    assert.equal(status.desiredState, 'running');
    const launcher = await fs.readFile(path.join(serviceRoot, 'remote-host-service.cmd'), 'utf8');
    assert.equal(launcher.includes(initialized.pairingToken), false);
    assert.match(launcher, / supervise --config /);
  } finally {
    if (installed) {
      await uninstallRemoteHostService({ serviceRoot, purgeLogs: true }).catch(() => {});
    }
    await cleanup(root);
  }
});


test('Windows Task Scheduler runs, restarts, and stops the real Remote Host supervisor', { skip: process.platform !== 'win32' }, async () => {
  const root = await tempDir('veteran-remote-service-lifecycle-win-');
  const workspace = path.join(root, 'workspace');
  const configPath = path.join(root, 'remote-host.json');
  const serviceRoot = path.join(root, 'service');
  const port = await freeLoopbackPort();
  try {
    await fs.mkdir(workspace, { recursive: true });
    await initRemoteHostConfig({
      configPath,
      stateRoot: path.join(root, 'state'),
      workspaces: [workspace],
      bind: '127.0.0.1',
      port
    });

    const installed = await installRemoteHostService({
      configPath,
      serviceRoot,
      startNow: true
    });
    assert.equal(installed.installed, true);
    assert.equal(installed.started, true);

    const running = await waitFor(async () => {
      const status = await remoteHostServiceStatus({ serviceRoot });
      return status.runtimeState === 'running' && status.pid?.supervisorPid && status.pid?.childPid ? status : null;
    }, 'Remote Host service did not reach running state');
    assert.equal(await waitFor(() => healthReady(port), 'Remote Host health endpoint did not become ready'), true);

    const firstSupervisorPid = running.pid.supervisorPid;
    const firstChildPid = running.pid.childPid;
    const killed = signalProcessTree(firstChildPid, 'SIGKILL');
    assert.equal(killed.signalled, true, killed.reason || 'failed to terminate Remote Host child');

    let lastRestartStatus = null;
    let restarted;
    try {
      restarted = await waitFor(async () => {
        const status = await remoteHostServiceStatus({ serviceRoot });
        lastRestartStatus = status;
        return status.runtimeState === 'running'
          && status.pid?.supervisorPid === firstSupervisorPid
          && status.pid?.childPid
          && status.pid.childPid !== firstChildPid
          ? status
          : null;
      }, 'Remote Host supervisor did not restart the failed child');
    } catch (error) {
      const logTail = (await fs.readFile(running.logPath, 'utf8').catch(() => '')).slice(-4000);
      const status = lastRestartStatus ? {
        registration: lastRestartStatus.registration,
        desiredState: lastRestartStatus.desiredState,
        runtimeState: lastRestartStatus.runtimeState,
        supervisor: lastRestartStatus.supervisor,
        child: lastRestartStatus.child,
        pid: lastRestartStatus.pid
      } : null;
      throw new Error(`${error.message}; lastStatus=${JSON.stringify(status)}; logTail=${JSON.stringify(logTail)}`, { cause: error });
    }
    assert.equal(await waitFor(() => healthReady(port), 'Restarted Remote Host health endpoint did not become ready'), true);

    const log = await fs.readFile(restarted.logPath, 'utf8');
    assert.match(log, /child exited pid=/);
    assert.match(log, /restarting after/);

    const stopped = await controlRemoteHostService('stop', { serviceRoot });
    assert.equal(stopped.desiredState, 'stopped');
    await waitFor(async () => {
      const status = await remoteHostServiceStatus({ serviceRoot });
      const supervisorAlive = status.supervisor?.state === 'alive';
      const childAlive = status.child?.state === 'alive';
      return !supervisorAlive && !childAlive ? status : null;
    }, 'Remote Host service processes did not stop');
    assert.equal(await healthReady(port), false);
  } finally {
    await uninstallRemoteHostService({ serviceRoot, purgeLogs: true }).catch(() => {});
    await cleanup(root);
  }
});
