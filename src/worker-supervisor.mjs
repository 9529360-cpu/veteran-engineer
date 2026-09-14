import { spawn, spawnSync } from 'node:child_process';

const FORCE_KILL_AFTER_MS = 3_000;

let worker = null;
let container = null;
let workerEnv = null;
let forceTimer = null;
let pendingSignal = null;
let started = false;
let settled = false;

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function killProcessTree(pid, signal = 'SIGTERM') {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
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

function scheduleForceKill() {
  if (forceTimer || !worker?.pid) return;
  forceTimer = setTimeout(() => {
    killProcessTree(worker.pid, 'SIGKILL');
    cleanupContainer();
  }, FORCE_KILL_AFTER_MS);
}

function terminateWorker(signal = 'SIGTERM') {
  if (signal === 'SIGKILL') pendingSignal = 'SIGKILL';
  else if (!pendingSignal) pendingSignal = 'SIGTERM';
  if (!worker?.pid) return false;
  const effectiveSignal = pendingSignal === 'SIGKILL' ? 'SIGKILL' : signal;
  const signalled = killProcessTree(worker.pid, effectiveSignal);
  cleanupContainer();
  if (effectiveSignal !== 'SIGKILL' && signalled) scheduleForceKill();
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
  cleanupContainer();
  send({ type: 'outcome', ...outcome }, () => process.exit(exitCode));
}

function failStart(error) {
  const spawnError = {
    code: error?.code || 'WORKER_SPAWN_FAILED',
    message: String(error?.message || error).slice(0, 1_000)
  };
  finish({ code: null, signal: null, spawnError }, 127);
}

function startWorker(message) {
  if (started || settled) return;
  started = true;
  const command = typeof message?.command === 'string' ? message.command : '';
  const args = Array.isArray(message?.args) ? message.args : [];
  const cwd = typeof message?.cwd === 'string' ? message.cwd : process.cwd();
  workerEnv = message?.env && typeof message.env === 'object' ? message.env : {};
  container = message?.container && typeof message.container === 'object' ? message.container : null;
  if (!command) {
    failStart(Object.assign(new Error('Worker supervisor requires a command'), { code: 'WORKER_CONFIG_INVALID' }));
    return;
  }

  try {
    worker = spawn(command, args, {
      cwd,
      env: workerEnv,
      shell: false,
      detached: process.platform !== 'win32',
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
    finish({ code, signal, spawnError: null }, exitCode);
  });

  const stdin = message?.stdin;
  if (stdin !== undefined && stdin !== null) worker.stdin.end(String(stdin));
  else worker.stdin.end();

  send({ type: 'started', pid: worker.pid });
  if (pendingSignal) terminateWorker(pendingSignal);
}

process.on('message', (message) => {
  if (message?.type === 'start') {
    startWorker(message);
    return;
  }
  if (message?.type === 'terminate') {
    terminateWorker(message.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
  }
});

process.on('disconnect', () => {
  if (!started) {
    process.exit(1);
    return;
  }
  terminateWorker('SIGTERM');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (!started) {
      process.exit(1);
      return;
    }
    terminateWorker('SIGTERM');
  });
}
