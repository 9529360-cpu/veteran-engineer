import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FORCE_KILL_AFTER_MS = 3_000;
const OUTCOME_GRACE_MS = 500;
const RUNTIME_PROFILE_PREFIX = 'veteran-engineer-';

let worker = null;
let container = null;
let workerEnv = null;
let runtimeProfileRoot = null;
let forceTimer = null;
let outcomeTimer = null;
let pendingSignal = null;
let started = false;
let settled = false;
let terminating = false;

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function validRuntimeProfileRoot(candidate) {
  if (typeof candidate !== 'string' || !candidate.length) return null;
  const root = path.resolve(candidate);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, root);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  if (!path.basename(root).startsWith(RUNTIME_PROFILE_PREFIX)) return null;
  return root;
}

function cleanupContainer() {
  if (!container?.engine || !container?.name) return;
  try {
    spawnSync(container.engine, ['rm', '-f', container.name], {
      env: workerEnv || process.env,
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5_000
    });
  } catch {
    // Best effort. The durable runtime will reconcile the worker outcome on restart.
  }
}

function cleanupRuntimeProfile() {
  const root = validRuntimeProfileRoot(runtimeProfileRoot);
  if (!root) return;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort. A later runtime cleanup can sweep any remaining orphan.
  }
}

function cleanupOwnedState() {
  cleanupContainer();
  cleanupRuntimeProfile();
}

function killOwnedTree(signal = 'SIGTERM') {
  if (process.platform === 'win32') {
    if (!worker?.pid) return false;
    const args = ['/PID', String(worker.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  }
  try {
    process.kill(-process.pid, signal);
    return true;
  } catch {
    if (!worker?.pid) return false;
    try {
      process.kill(worker.pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

function forceKillOwnedTree() {
  cleanupOwnedState();
  killOwnedTree('SIGKILL');
}

function scheduleForceKill() {
  if (forceTimer) return;
  forceTimer = setTimeout(forceKillOwnedTree, FORCE_KILL_AFTER_MS);
  forceTimer.unref();
}

function terminateOwnedTree(signal = 'SIGTERM') {
  terminating = true;
  if (signal === 'SIGKILL') pendingSignal = 'SIGKILL';
  else if (!pendingSignal) pendingSignal = 'SIGTERM';
  cleanupContainer();
  if (!worker?.pid) return false;
  if (pendingSignal === 'SIGKILL') {
    forceKillOwnedTree();
    return true;
  }
  const signalled = killOwnedTree('SIGTERM');
  if (signalled) scheduleForceKill();
  return signalled;
}

function send(message, callback = null) {
  if (!process.connected || typeof process.send !== 'function') {
    callback?.();
    return false;
  }
  try {
    process.send(message, callback || undefined);
    return true;
  } catch {
    callback?.();
    return false;
  }
}

function armOutcomeFallback(exitCode) {
  if (outcomeTimer) return;
  outcomeTimer = setTimeout(() => {
    if (terminating || !process.connected) {
      forceKillOwnedTree();
      return;
    }
    process.exit(exitCode);
  }, OUTCOME_GRACE_MS);
  outcomeTimer.unref();
}

function finishOutcome(outcome, exitCode) {
  if (settled) return;
  settled = true;
  if (forceTimer) clearTimeout(forceTimer);
  forceTimer = null;
  cleanupOwnedState();
  if (!process.connected) {
    forceKillOwnedTree();
    return;
  }
  if (terminating) {
    const delivered = send({ type: 'outcome', ...outcome }, forceKillOwnedTree);
    if (!delivered) forceKillOwnedTree();
    else armOutcomeFallback(exitCode);
    return;
  }
  const delivered = send({ type: 'outcome', ...outcome });
  if (!delivered) {
    process.exit(exitCode);
    return;
  }
  armOutcomeFallback(exitCode);
}

function failStart(error) {
  const spawnError = {
    code: error?.code || 'WORKER_SPAWN_FAILED',
    message: String(error?.message || error).slice(0, 1_000)
  };
  finishOutcome({ code: null, signal: null, spawnError }, 127);
}

function startWorker(message) {
  if (started || settled) return;
  started = true;
  const command = typeof message?.command === 'string' ? message.command : '';
  const args = Array.isArray(message?.args) ? message.args : [];
  const cwd = typeof message?.cwd === 'string' ? message.cwd : process.cwd();
  workerEnv = message?.env && typeof message.env === 'object' ? message.env : {};
  container = message?.container && typeof message.container === 'object' ? message.container : null;
  runtimeProfileRoot = container ? null : validRuntimeProfileRoot(message?.runtimeProfileRoot);
  if (!command) {
    failStart(Object.assign(new Error('Worker sentinel requires a command'), { code: 'WORKER_CONFIG_INVALID' }));
    return;
  }

  try {
    worker = spawn(command, args, {
      cwd,
      env: workerEnv,
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    failStart(error);
    return;
  }

  worker.stdout?.pipe(process.stdout, { end: false });
  worker.stderr?.pipe(process.stderr, { end: false });
  worker.on('error', failStart);
  worker.on('close', (code, signal) => {
    const exitCode = Number.isInteger(code) && code >= 0 ? Math.min(code, 255) : 1;
    finishOutcome({ code, signal, spawnError: null }, exitCode);
  });

  const stdin = message?.stdin;
  if (stdin !== undefined && stdin !== null) worker.stdin.end(String(stdin));
  else worker.stdin.end();

  send({ type: 'started', pid: worker.pid });
  if (pendingSignal) terminateOwnedTree(pendingSignal);
}

process.on('message', (message) => {
  if (message?.type === 'start') {
    startWorker(message);
    return;
  }
  if (message?.type === 'terminate') {
    terminateOwnedTree(message.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
  }
});

process.on('disconnect', () => {
  if (!started) {
    cleanupOwnedState();
    process.exit(1);
    return;
  }
  terminateOwnedTree('SIGTERM');
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (terminating) return;
    if (!started) {
      cleanupOwnedState();
      process.exit(1);
      return;
    }
    terminateOwnedTree('SIGTERM');
  });
}
