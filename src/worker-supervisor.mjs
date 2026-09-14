import { fork, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORCE_KILL_AFTER_MS = 3_000;
const RUNTIME_PROFILE_PREFIX = 'veteran-engineer-';
const SUPERVISOR_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'WINDIR',
  'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL'
]);
const SENTINEL_PATH = fileURLToPath(new URL('./worker-sentinel.mjs', import.meta.url));

function scrubInheritedEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!SUPERVISOR_ENV_KEYS.has(key.toUpperCase())) delete process.env[key];
  }
}

scrubInheritedEnvironment();

let sentinel = null;
let workerPid = null;
let container = null;
let workerEnv = null;
let runtimeProfileRoot = null;
let sentinelOutcome = null;
let forceTimer = null;
let pendingSignal = null;
let started = false;
let settled = false;

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

function disposableRuntimeProfileRoot() {
  if (container) return null;
  const tmp = workerEnv?.TMPDIR;
  if (typeof tmp !== 'string' || !tmp.length) return null;
  const resolvedTmp = path.resolve(tmp);
  if (path.basename(resolvedTmp) !== 'tmp') return null;
  return validRuntimeProfileRoot(path.dirname(resolvedTmp));
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
    // Best effort. The parent runtime records durable reconciliation state.
  }
}

function cleanupRuntimeProfile() {
  const root = validRuntimeProfileRoot(runtimeProfileRoot);
  if (!root) return;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort. Runtime cleanup can sweep any remaining orphan later.
  }
}

function cleanupOwnedState() {
  cleanupContainer();
  cleanupRuntimeProfile();
}

function killSentinelTree(signal = 'SIGTERM') {
  if (!sentinel?.pid) return false;
  if (process.platform === 'win32') {
    const target = Number.isInteger(workerPid) && workerPid > 0 ? workerPid : sentinel.pid;
    const args = ['/PID', String(target), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  }
  try {
    process.kill(-sentinel.pid, signal);
    return true;
  } catch {
    if (Number.isInteger(workerPid) && workerPid > 0) {
      try {
        process.kill(workerPid, signal);
        return true;
      } catch {}
    }
    return false;
  }
}

function scheduleForceKill() {
  if (forceTimer || !sentinel?.pid) return;
  forceTimer = setTimeout(() => {
    cleanupOwnedState();
    killSentinelTree('SIGKILL');
  }, FORCE_KILL_AFTER_MS);
  forceTimer.unref();
}

function terminateSentinel(signal = 'SIGTERM') {
  if (signal === 'SIGKILL') pendingSignal = 'SIGKILL';
  else if (!pendingSignal) pendingSignal = 'SIGTERM';
  cleanupContainer();
  if (!sentinel) return false;
  if (sentinel.connected) {
    try {
      sentinel.send({ type: 'terminate', signal: pendingSignal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM' });
      if (pendingSignal !== 'SIGKILL') scheduleForceKill();
      return true;
    } catch {}
  }
  const signalled = killSentinelTree(pendingSignal === 'SIGKILL' ? 'SIGKILL' : signal);
  if (pendingSignal !== 'SIGKILL' && signalled) scheduleForceKill();
  return signalled;
}

function send(message, callback = null) {
  if (!process.connected || typeof process.send !== 'function') {
    callback?.();
    return;
  }
  try {
    process.send(message, callback || undefined);
  } catch {
    callback?.();
  }
}

function finish(outcome, exitCode) {
  if (settled) return;
  settled = true;
  if (forceTimer) clearTimeout(forceTimer);
  forceTimer = null;
  cleanupOwnedState();
  send({ type: 'outcome', ...outcome }, () => process.exit(exitCode));
}

function internalFailure(code, message) {
  return {
    code: null,
    signal: null,
    spawnError: { code, message: String(message).slice(0, 1_000) }
  };
}

function handleSentinelClose(code, signal) {
  if (forceTimer) clearTimeout(forceTimer);
  forceTimer = null;
  cleanupOwnedState();
  killSentinelTree('SIGKILL');
  if (sentinelOutcome) {
    const exitCode = Number.isInteger(sentinelOutcome.code) && sentinelOutcome.code >= 0
      ? Math.min(sentinelOutcome.code, 255)
      : (sentinelOutcome.spawnError ? 127 : 1);
    finish(sentinelOutcome, exitCode);
    return;
  }
  if (pendingSignal) {
    finish({ code: null, signal: signal || pendingSignal, spawnError: null }, 1);
    return;
  }
  finish(internalFailure('WORKER_SENTINEL_LOST', `Worker sentinel exited before reporting an outcome (code=${code}, signal=${signal || 'none'})`), 1);
}

function startWorker(message) {
  if (started || settled) return;
  started = true;
  const command = typeof message?.command === 'string' ? message.command : '';
  const args = Array.isArray(message?.args) ? message.args : [];
  const cwd = typeof message?.cwd === 'string' ? message.cwd : process.cwd();
  workerEnv = message?.env && typeof message.env === 'object' ? message.env : {};
  container = message?.container && typeof message.container === 'object' ? message.container : null;
  runtimeProfileRoot = disposableRuntimeProfileRoot();
  if (!command) {
    finish(internalFailure('WORKER_CONFIG_INVALID', 'Worker supervisor requires a command'), 127);
    return;
  }

  try {
    sentinel = fork(SENTINEL_PATH, [], {
      cwd,
      env: process.env,
      silent: true,
      detached: process.platform !== 'win32',
      windowsHide: true
    });
  } catch (error) {
    finish(internalFailure(error?.code || 'WORKER_SENTINEL_START_FAILED', error?.message || error), 127);
    return;
  }

  sentinel.stdout?.pipe(process.stdout, { end: false });
  sentinel.stderr?.pipe(process.stderr, { end: false });
  sentinel.on('message', (sentinelMessage) => {
    if (sentinelMessage?.type === 'started' && Number.isInteger(sentinelMessage.pid) && sentinelMessage.pid > 0) {
      workerPid = sentinelMessage.pid;
      send({ type: 'started', pid: workerPid });
      return;
    }
    if (sentinelMessage?.type === 'outcome') {
      sentinelOutcome = {
        code: sentinelMessage.code ?? null,
        signal: sentinelMessage.signal ?? null,
        spawnError: sentinelMessage.spawnError || null
      };
      cleanupOwnedState();
      killSentinelTree('SIGKILL');
    }
  });
  sentinel.on('error', (error) => {
    if (!sentinelOutcome) sentinelOutcome = internalFailure(error?.code || 'WORKER_SENTINEL_FAILED', error?.message || error);
    cleanupOwnedState();
    killSentinelTree('SIGKILL');
  });
  sentinel.on('close', handleSentinelClose);

  try {
    sentinel.send({
      type: 'start',
      command,
      args,
      cwd,
      env: workerEnv,
      stdin: message?.stdin ?? null,
      container,
      runtimeProfileRoot
    }, (error) => {
      if (!error) return;
      if (!sentinelOutcome) sentinelOutcome = internalFailure(error?.code || 'WORKER_SENTINEL_IPC_FAILED', error?.message || error);
      cleanupOwnedState();
      killSentinelTree('SIGKILL');
    });
  } catch (error) {
    sentinelOutcome = internalFailure(error?.code || 'WORKER_SENTINEL_IPC_FAILED', error?.message || error);
    cleanupOwnedState();
    killSentinelTree('SIGKILL');
  }
  if (pendingSignal) terminateSentinel(pendingSignal);
}

process.on('message', (message) => {
  if (message?.type === 'start') {
    startWorker(message);
    return;
  }
  if (message?.type === 'terminate') {
    terminateSentinel(message.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
  }
});

process.on('disconnect', () => {
  if (!started) {
    cleanupOwnedState();
    process.exit(1);
    return;
  }
  terminateSentinel('SIGTERM');
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (!started) {
      cleanupOwnedState();
      process.exit(1);
      return;
    }
    terminateSentinel('SIGTERM');
  });
}

process.on('uncaughtException', (error) => {
  if (!sentinelOutcome) sentinelOutcome = internalFailure('WORKER_SUPERVISOR_FAILED', error?.message || error);
  cleanupOwnedState();
  killSentinelTree('SIGKILL');
  finish(sentinelOutcome, 1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (!sentinelOutcome) sentinelOutcome = internalFailure('WORKER_SUPERVISOR_FAILED', message);
  cleanupOwnedState();
  killSentinelTree('SIGKILL');
  finish(sentinelOutcome, 1);
});
