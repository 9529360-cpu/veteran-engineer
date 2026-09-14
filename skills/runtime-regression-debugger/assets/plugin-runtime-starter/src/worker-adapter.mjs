import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { nowIso } from './util.mjs';
import { buildContainerInvocation, validateContainerWorkerConfig } from './container-worker.mjs';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'COMSPEC', 'LANG', 'LC_ALL', 'SHELL'];
const MAX_ENV_NAMES = 64;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_CODEX_FLAGS = new Set([
  '--dangerously-bypass-approvals-and-sandbox', '--yolo', '--dangerously-bypass-hook-trust',
  '--sandbox', '-s', '--approve-for-me', '--not-so-yolo', '--cd', '-C', '--add-dir', '--worktree'
]);

function substitute(value, vars) {
  return String(value).replace(/\{(packet|worktree|taskId|missionId|runtimeNamespace)\}/g, (_, key) => vars[key]);
}

function safeRuntimeNamespace(value) {
  return String(value || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 96) || 'task';
}

async function createLocalRuntimeTempDir(runtimeNamespace) {
  const prefix = path.join(os.tmpdir(), `veteran-engineer-${safeRuntimeNamespace(runtimeNamespace)}-`);
  const runtimeTempDir = await fs.mkdtemp(prefix);
  await fs.chmod(runtimeTempDir, 0o700).catch(() => {});
  return runtimeTempDir;
}

function pathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveWorkerPacketPath(worktreePath, packetPath, taskId) {
  const worktreeResolved = path.resolve(worktreePath);
  const requested = packetPath
    ? path.resolve(packetPath)
    : path.join(path.dirname(worktreeResolved), `.veteran-task-${safeRuntimeNamespace(taskId)}-${Date.now()}.json`);
  if (pathInside(worktreeResolved, requested)) {
    const error = new Error('Worker task packets must live outside the writable task worktree');
    error.code = 'WORKER_PACKET_PATH_INVALID';
    throw error;
  }

  await fs.mkdir(path.dirname(requested), { recursive: true });
  const [worktreeReal, parentReal] = await Promise.all([
    fs.realpath(worktreeResolved),
    fs.realpath(path.dirname(requested))
  ]);
  const realCandidate = path.join(parentReal, path.basename(requested));
  if (pathInside(worktreeReal, realCandidate)) {
    const error = new Error('Worker task packet parent resolves inside the writable task worktree');
    error.code = 'WORKER_PACKET_PATH_INVALID';
    throw error;
  }
  try {
    const existing = await fs.lstat(requested);
    if (existing.isSymbolicLink()) {
      const error = new Error('Worker task packet path may not be a symbolic link');
      error.code = 'WORKER_PACKET_PATH_INVALID';
      throw error;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return requested;
}

function terminateTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return false;
  if (process.platform === 'win32') {
    const args = ['/PID', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return result.status === 0;
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    try { return child.kill(signal); } catch { return false; }
  }
}

function codexPreset(project) {
  const options = project.workerPolicy?.codex || {};
  const extraArgs = (options.extraArgs || []).map(String);
  if (extraArgs.some((arg) => [...FORBIDDEN_CODEX_FLAGS].some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) {
    const error = new Error('Codex preset refuses dangerous sandbox/approval bypass flags; use an explicitly governed custom worker only behind an external sandbox.');
    error.code = 'CODEX_PRESET_DANGEROUS_FLAG';
    throw error;
  }
  const args = ['exec', '--sandbox', 'workspace-write', '--ephemeral', '--color', 'never', '-C', '{worktree}'];
  if (options.model) args.push('--model', String(options.model));
  if (options.profile) args.push('--profile', String(options.profile));
  args.push(...extraArgs, '-');
  return {
    type: 'codex',
    command: options.command || 'codex',
    args,
    stdinMode: 'codex-prompt',
    envAllowlist: options.envAllowlist || ['CODEX_HOME'],
    timeoutMs: options.timeoutMs || 900_000
  };
}

export function resolveWorkerConfig(project, requestedWorker = 'default') {
  const effectiveWorker = requestedWorker === 'default' ? (project.workerPolicy?.defaultWorker || 'default') : requestedWorker;
  const configured = project.workerPolicy?.workers?.[effectiveWorker] || (effectiveWorker === 'default' ? project.workerPolicy?.worker : null) || null;
  if (configured) return configured;
  if (effectiveWorker === 'codex') return codexPreset(project);
  const command = process.env.VETERAN_WORKER_COMMAND;
  if (!command) return null;
  let args = [];
  if (process.env.VETERAN_WORKER_ARGS_JSON) {
    try { args = JSON.parse(process.env.VETERAN_WORKER_ARGS_JSON); } catch { throw new Error('VETERAN_WORKER_ARGS_JSON must be valid JSON'); }
  }
  return { type: process.env.VETERAN_WORKER_TYPE || 'custom', command, args };
}

function validateLocalWorkerEnvironment(config) {
  if (config?.envAllowlist === undefined) return;
  if (!Array.isArray(config.envAllowlist) || config.envAllowlist.length > MAX_ENV_NAMES) {
    const error = new Error(`Local worker envAllowlist must be an array with at most ${MAX_ENV_NAMES} entries`);
    error.code = 'WORKER_CONFIG_INVALID';
    throw error;
  }
  for (const key of config.envAllowlist) {
    if (typeof key !== 'string' || !ENV_KEY.test(key)) {
      const error = new Error('Local worker envAllowlist contains an invalid environment variable name');
      error.code = 'WORKER_CONFIG_INVALID';
      throw error;
    }
  }
}

export function enforceWorkerPolicy(project, task, config) {
  if (!project.workerPolicy?.enabled) {
    const error = new Error('Worker execution is disabled by operator policy');
    error.code = 'WORKER_EXECUTION_DISABLED';
    throw error;
  }
  if (config?.type === 'container') {
    validateContainerWorkerConfig(config);
  } else {
    validateLocalWorkerEnvironment(config);
    if (!config?.command) {
      const error = new Error('No worker executable is configured');
      error.code = 'WORKER_NOT_CONFIGURED';
      throw error;
    }
  }
  const unconfined = config.type === 'custom-unconfined';
  if (unconfined && !project.workerPolicy.allowUnconfinedCustomWorkers) {
    const error = new Error('Custom unconfined worker requires explicit operator opt-in');
    error.code = 'UNCONFINED_WORKER_NOT_ALLOWED';
    throw error;
  }
  if (unconfined && (task.risk === 'high' || task.risk === 'critical' || task.writeSet.includes('.'))) {
    const error = new Error('Custom unconfined workers may not execute high/critical or broad-write tasks');
    error.code = 'UNCONFINED_WORKER_RISK_BLOCKED';
    throw error;
  }
}

function codexPrompt(packet) {
  return [
    'You are a bounded Veteran Engineer coding worker.',
    'The JSON task packet below is authoritative for this worker invocation.',
    'Modify only the declared writeSet inside the current worktree. Do not commit, merge, push, deploy, publish, or change Git HEAD; the Veteran runtime owns integration.',
    'Current repository/runtime evidence outranks projectExperience. Stop rather than invent mission-level semantics or cross the packet stopConditions.',
    '',
    JSON.stringify(packet, null, 2)
  ].join('\n');
}

export function buildWorkerInvocation({ config, worktreePath, packetPath, task, mission, runtimeNamespace = null }) {
  if (config.type === 'container') return buildContainerInvocation({ config, worktreePath, packetPath, task, mission, runtimeNamespace });
  const vars = { packet: packetPath, worktree: worktreePath, taskId: task.id, missionId: mission.id, runtimeNamespace: runtimeNamespace || '' };
  return { command: config.command, args: (config.args || []).map((arg) => substitute(arg, vars)) };
}

export class WorkerAdapter {
  constructor() {
    this.running = new Map();
  }

  snapshot() {
    return [...this.running.entries()].map(([taskKey, running]) => ({
      taskKey,
      pid: running.child?.pid || null,
      startedAt: running.startedAt,
      runtimeNamespace: running.runtimeNamespace,
      worktreePath: running.worktreePath,
      packetPath: running.packetPath,
      termination: running.termination ? { ...running.termination } : null
    })).sort((a, b) => a.taskKey.localeCompare(b.taskKey));
  }

  async run({ project, mission, task, worktreePath, packet, packetPath = null, config, timeoutMs = null }) {
    enforceWorkerPolicy(project, task, config);
    const resolvedPacketPath = await resolveWorkerPacketPath(worktreePath, packetPath, task.id);
    const dispatchIdentity = path.basename(resolvedPacketPath, path.extname(resolvedPacketPath));
    const runtimeNamespace = packet?.runtimeIsolation?.namespace || `${mission.id}:${task.id}:${dispatchIdentity}`;
    const runtimeTempDir = config.type === 'container' ? null : await createLocalRuntimeTempDir(runtimeNamespace);
    const startedAt = nowIso();
    const startedAtMs = Date.now();
    let running = null;
    let completed = false;
    try {
      await fs.writeFile(resolvedPacketPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
      const invocation = buildWorkerInvocation({ config, worktreePath, packetPath: resolvedPacketPath, task, mission, runtimeNamespace });
      const env = {};
      for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
      for (const key of config.envAllowlist || []) if (process.env[key] !== undefined) env[key] = process.env[key];
      if (config.type !== 'container') Object.assign(env, config.env || {});
      if (runtimeTempDir) {
        env.TMP = runtimeTempDir;
        env.TEMP = runtimeTempDir;
        env.TMPDIR = runtimeTempDir;
      }
      env.VETERAN_TASK_PACKET = resolvedPacketPath;
      env.VETERAN_WORKTREE = worktreePath;
      env.VETERAN_TASK_ID = task.id;
      env.VETERAN_MISSION_ID = mission.id;
      env.VETERAN_RUNTIME_NAMESPACE = runtimeNamespace;

      const child = spawn(invocation.command, invocation.args, {
        cwd: worktreePath,
        env,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      running = {
        child,
        container: invocation.container || null,
        env,
        forceTimer: null,
        termination: null,
        startedAt,
        runtimeNamespace,
        worktreePath,
        packetPath: resolvedPacketPath
      };
      this.running.set(task.key, running);
      if (config.stdinMode === 'codex-prompt') child.stdin.end(codexPrompt(packet));
      else if (config.stdin !== undefined) child.stdin.end(String(config.stdin));
      else child.stdin.end();
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000); });
      child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000); });
      const effectiveTimeoutMs = timeoutMs || config.timeoutMs || 900_000;
      const outcome = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.#terminateRunning(running, 'timeout'), effectiveTimeoutMs);
        child.on('error', (error) => {
          clearTimeout(timer);
          this.#clearTerminationTimer(running);
          this.#cleanupContainer(invocation.container, env);
          reject(error);
        });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          this.#clearTerminationTimer(running);
          this.#cleanupContainer(invocation.container, env);
          resolve({ code, signal });
        });
      });
      completed = true;
      return {
        ...outcome,
        stdout,
        stderr,
        startedAt,
        endedAt: nowIso(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        pid: child.pid,
        packetPath: resolvedPacketPath,
        runtimeNamespace,
        termination: running.termination ? { ...running.termination } : null
      };
    } finally {
      if (!completed && running) this.#terminateRunning(running, 'adapter-error');
      this.running.delete(task.key);
      if (runtimeTempDir) await fs.rm(runtimeTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  #terminateRunning(running, reason = 'runtime-stop') {
    if (!running?.child) return false;
    if (!running.termination) {
      running.termination = {
        reason,
        requestedAt: nowIso(),
        signal: 'SIGTERM',
        forceKilled: false,
        forceSignal: null
      };
    }
    const signalled = terminateTree(running.child, 'SIGTERM');
    this.#cleanupContainer(running.container, running.env);
    if (signalled && !running.forceTimer) {
      running.forceTimer = setTimeout(() => {
        const forceKilled = terminateTree(running.child, 'SIGKILL');
        if (running.termination && forceKilled) {
          running.termination.forceKilled = true;
          running.termination.forceSignal = 'SIGKILL';
        }
        this.#cleanupContainer(running.container, running.env);
      }, 3000);
      running.forceTimer.unref();
    }
    return signalled;
  }

  #clearTerminationTimer(running) {
    if (!running?.forceTimer) return;
    clearTimeout(running.forceTimer);
    running.forceTimer = null;
  }

  #cleanupContainer(container, env) {
    if (!container?.engine || !container?.name) return;
    try {
      const cleanup = spawn(container.engine, ['rm', '-f', container.name], { env, shell: false, stdio: 'ignore', detached: true });
      cleanup.unref();
    } catch {
      // Best effort only; the runtime still records the worker outcome and reconciliation state.
    }
  }

  cancel(taskKey) {
    const running = this.running.get(taskKey);
    if (!running) return false;
    return this.#terminateRunning(running, 'operator-cancel');
  }
}
