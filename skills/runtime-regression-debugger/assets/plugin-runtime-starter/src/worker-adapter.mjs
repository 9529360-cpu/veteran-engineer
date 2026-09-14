import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { nowIso } from './util.mjs';
import { buildContainerInvocation, validateContainerWorkerConfig } from './container-worker.mjs';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'COMSPEC', 'LANG', 'LC_ALL', 'SHELL'];
const LOCAL_WORKER_TYPES = new Set(['custom', 'custom-unconfined', 'codex']);
const MAX_ENV_NAMES = 64;
const MAX_LOCAL_TIMEOUT_MS = 2_147_483_647;
const MAX_CAPTURED_OUTPUT_CHARS = 2_000_000;
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

async function createLocalRuntimeProfile(runtimeNamespace) {
  const prefix = path.join(os.tmpdir(), `veteran-engineer-${safeRuntimeNamespace(runtimeNamespace)}-`);
  const root = await fs.mkdtemp(prefix);
  await fs.chmod(root, 0o700).catch(() => {});
  const profile = {
    root,
    tmp: path.join(root, 'tmp'),
    home: path.join(root, 'home'),
    config: path.join(root, 'config'),
    cache: path.join(root, 'cache'),
    data: path.join(root, 'data'),
    state: path.join(root, 'state')
  };
  await Promise.all(Object.values(profile).slice(1).map((dir) => fs.mkdir(dir, { recursive: true, mode: 0o700 })));
  return profile;
}

function createOutputCapture() {
  return { value: '', totalChars: 0, truncated: false };
}

function appendOutput(capture, chunk) {
  const text = String(chunk);
  capture.totalChars += text.length;
  capture.value += text;
  if (capture.value.length > MAX_CAPTURED_OUTPUT_CHARS) {
    capture.value = capture.value.slice(-MAX_CAPTURED_OUTPUT_CHARS);
    capture.truncated = true;
  }
}

function outputCaptureSummary(capture) {
  return {
    capturedChars: capture.value.length,
    totalChars: capture.totalChars,
    truncated: capture.truncated
  };
}

function emptyOutputCaptureSummary() {
  return { capturedChars: 0, totalChars: 0, truncated: false };
}

function pathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveThroughExistingAncestor(targetPath) {
  let cursor = path.resolve(targetPath);
  const missing = [];
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function packetPathError(message) {
  const error = new Error(message);
  error.code = 'WORKER_PACKET_PATH_INVALID';
  return error;
}

function localWorkerConfigError(message) {
  const error = new Error(message);
  error.code = 'WORKER_CONFIG_INVALID';
  return error;
}

async function resolveWorkerPacketPath(worktreePath, packetPath, taskId) {
  const worktreeResolved = path.resolve(worktreePath);
  const requested = packetPath
    ? path.resolve(packetPath)
    : path.join(path.dirname(worktreeResolved), `.veteran-task-${safeRuntimeNamespace(taskId)}-${Date.now()}.json`);
  if (pathInside(worktreeResolved, requested)) {
    throw packetPathError('Worker task packets must live outside the writable task worktree');
  }

  const worktreeReal = await fs.realpath(worktreeResolved);
  const previewParent = await resolveThroughExistingAncestor(path.dirname(requested));
  if (pathInside(worktreeReal, path.join(previewParent, path.basename(requested)))) {
    throw packetPathError('Worker task packet parent resolves inside the writable task worktree');
  }

  await fs.mkdir(path.dirname(requested), { recursive: true });
  const parentReal = await fs.realpath(path.dirname(requested));
  if (pathInside(worktreeReal, path.join(parentReal, path.basename(requested)))) {
    throw packetPathError('Worker task packet parent changed to resolve inside the writable task worktree');
  }
  try {
    const existing = await fs.lstat(requested);
    if (existing.isSymbolicLink()) throw packetPathError('Worker task packet path may not be a symbolic link');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return requested;
}

function terminationRecord(reason) {
  return {
    reason,
    requestedAt: nowIso(),
    signal: 'SIGTERM',
    forceKilled: false,
    forceSignal: null
  };
}

function alreadyRunningError(taskKey) {
  const error = new Error(`Worker task already has an active execution claim: ${taskKey}`);
  error.code = 'WORKER_ALREADY_RUNNING';
  return error;
}

function preSpawnCancellationResult({ startedAt, startedAtMs, packetPath, runtimeNamespace, termination }) {
  return {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    outputCapture: { stdout: emptyOutputCaptureSummary(), stderr: emptyOutputCaptureSummary() },
    startedAt,
    endedAt: nowIso(),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    pid: null,
    packetPath,
    runtimeNamespace,
    termination: termination ? { ...termination } : null
  };
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

function validateLocalWorkerConfig(config) {
  const type = config?.type || 'custom';
  if (!LOCAL_WORKER_TYPES.has(type)) {
    throw localWorkerConfigError(`Unsupported local worker type: ${type}`);
  }
  if (typeof config?.command !== 'string' || !config.command.trim()) {
    throw localWorkerConfigError('Local worker command must be a non-empty string');
  }
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string'))) {
    throw localWorkerConfigError('Local worker args must be an array of strings when supplied');
  }
  if (config.envAllowlist !== undefined) {
    if (!Array.isArray(config.envAllowlist) || config.envAllowlist.length > MAX_ENV_NAMES) {
      throw localWorkerConfigError(`Local worker envAllowlist must be an array with at most ${MAX_ENV_NAMES} entries`);
    }
    for (const key of config.envAllowlist) {
      if (typeof key !== 'string' || !ENV_KEY.test(key)) {
        throw localWorkerConfigError('Local worker envAllowlist contains an invalid environment variable name');
      }
    }
  }
  if (config.env !== undefined) {
    if (config.env === null || typeof config.env !== 'object' || Array.isArray(config.env)) {
      throw localWorkerConfigError('Local worker env must be an object of string environment values when supplied');
    }
    for (const [key, value] of Object.entries(config.env)) {
      if (!ENV_KEY.test(key) || typeof value !== 'string') {
        throw localWorkerConfigError('Local worker env contains an invalid environment variable name or non-string value');
      }
    }
  }
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > MAX_LOCAL_TIMEOUT_MS)) {
    throw localWorkerConfigError(`Local worker timeoutMs must be an integer from 1 through ${MAX_LOCAL_TIMEOUT_MS}`);
  }
  if (config.stdinMode !== undefined && config.stdinMode !== 'codex-prompt') {
    throw localWorkerConfigError('Local worker stdinMode must be codex-prompt when supplied');
  }
  return type;
}

export function enforceWorkerPolicy(project, task, config) {
  if (!project.workerPolicy?.enabled) {
    const error = new Error('Worker execution is disabled by operator policy');
    error.code = 'WORKER_EXECUTION_DISABLED';
    throw error;
  }
  let type;
  if (config?.type === 'container') {
    validateContainerWorkerConfig(config);
    type = 'container';
  } else {
    type = validateLocalWorkerConfig(config);
  }
  const unconfined = type === 'custom-unconfined';
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
    this.claims = new Map();
    this.cancelledMissions = new Set();
  }

  snapshot() {
    return [...this.claims.entries()].map(([taskKey, claim]) => {
      const running = this.running.get(taskKey) || null;
      const termination = running?.termination || claim.termination || null;
      return {
        taskKey,
        missionId: claim.missionId,
        taskId: claim.taskId,
        phase: running ? (termination ? 'terminating' : 'running') : (termination ? 'cancelling' : 'preparing'),
        pid: running?.child?.pid || null,
        claimedAt: claim.claimedAt,
        startedAt: running?.startedAt || null,
        runtimeNamespace: running?.runtimeNamespace || claim.runtimeNamespace || null,
        worktreePath: running?.worktreePath || claim.worktreePath,
        packetPath: running?.packetPath || claim.packetPath || null,
        termination: termination ? { ...termination } : null
      };
    }).sort((a, b) => a.taskKey.localeCompare(b.taskKey));
  }

  async run({ project, mission, task, worktreePath, packet, packetPath = null, config, timeoutMs = null }) {
    enforceWorkerPolicy(project, task, config);
    if (this.cancelledMissions.has(mission.id)) {
      const startedAt = nowIso();
      const startedAtMs = Date.now();
      return preSpawnCancellationResult({
        startedAt,
        startedAtMs,
        packetPath: packetPath ? path.resolve(packetPath) : null,
        runtimeNamespace: null,
        termination: terminationRecord('operator-cancel')
      });
    }
    if (this.claims.has(task.key)) throw alreadyRunningError(task.key);

    const ownsPacketPath = !packetPath;
    const claimedAt = nowIso();
    const claim = {
      missionId: mission.id,
      taskId: task.id,
      claimedAt,
      worktreePath: path.resolve(worktreePath),
      packetPath: packetPath ? path.resolve(packetPath) : null,
      runtimeNamespace: null,
      termination: null
    };
    this.claims.set(task.key, claim);

    const startedAtMs = Date.now();
    let resolvedPacketPath = null;
    let runtimeNamespace = null;
    let runtimeProfile = null;
    let running = null;
    let completed = false;
    try {
      resolvedPacketPath = await resolveWorkerPacketPath(worktreePath, packetPath, task.id);
      claim.packetPath = resolvedPacketPath;
      const dispatchIdentity = path.basename(resolvedPacketPath, path.extname(resolvedPacketPath));
      runtimeNamespace = packet?.runtimeIsolation?.namespace || `${mission.id}:${task.id}:${dispatchIdentity}`;
      claim.runtimeNamespace = runtimeNamespace;
      runtimeProfile = config.type === 'container' ? null : await createLocalRuntimeProfile(runtimeNamespace);

      if (claim.termination?.reason === 'operator-cancel') {
        completed = true;
        return preSpawnCancellationResult({
          startedAt: claimedAt,
          startedAtMs,
          packetPath: resolvedPacketPath,
          runtimeNamespace,
          termination: claim.termination
        });
      }

      await fs.writeFile(resolvedPacketPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
      await fs.chmod(resolvedPacketPath, 0o600).catch(() => {});

      if (claim.termination?.reason === 'operator-cancel') {
        completed = true;
        return preSpawnCancellationResult({
          startedAt: claimedAt,
          startedAtMs,
          packetPath: resolvedPacketPath,
          runtimeNamespace,
          termination: claim.termination
        });
      }

      const invocation = buildWorkerInvocation({ config, worktreePath, packetPath: resolvedPacketPath, task, mission, runtimeNamespace });
      const env = Object.create(null);
      for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
      for (const key of config.envAllowlist || []) if (process.env[key] !== undefined) env[key] = process.env[key];
      if (config.type !== 'container') Object.assign(env, config.env || {});
      if (runtimeProfile) {
        env.TMP = runtimeProfile.tmp;
        env.TEMP = runtimeProfile.tmp;
        env.TMPDIR = runtimeProfile.tmp;
      }
      if (runtimeProfile && (config.type || 'custom') === 'custom') {
        env.HOME = runtimeProfile.home;
        env.USERPROFILE = runtimeProfile.home;
        env.XDG_CONFIG_HOME = runtimeProfile.config;
        env.XDG_CACHE_HOME = runtimeProfile.cache;
        env.XDG_DATA_HOME = runtimeProfile.data;
        env.XDG_STATE_HOME = runtimeProfile.state;
        env.APPDATA = runtimeProfile.config;
        env.LOCALAPPDATA = runtimeProfile.cache;
      }
      env.VETERAN_TASK_PACKET = resolvedPacketPath;
      env.VETERAN_WORKTREE = worktreePath;
      env.VETERAN_TASK_ID = task.id;
      env.VETERAN_MISSION_ID = mission.id;
      env.VETERAN_RUNTIME_NAMESPACE = runtimeNamespace;

      const startedAt = nowIso();
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
        termination: claim.termination,
        claim,
        startedAt,
        runtimeNamespace,
        worktreePath,
        packetPath: resolvedPacketPath
      };
      this.running.set(task.key, running);
      if (config.stdinMode === 'codex-prompt') child.stdin.end(codexPrompt(packet));
      else if (config.stdin !== undefined) child.stdin.end(String(config.stdin));
      else child.stdin.end();
      const stdoutCapture = createOutputCapture();
      const stderrCapture = createOutputCapture();
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => appendOutput(stdoutCapture, chunk));
      child.stderr.on('data', (chunk) => appendOutput(stderrCapture, chunk));
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
        stdout: stdoutCapture.value,
        stderr: stderrCapture.value,
        outputCapture: {
          stdout: outputCaptureSummary(stdoutCapture),
          stderr: outputCaptureSummary(stderrCapture)
        },
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
      this.claims.delete(task.key);
      if (runtimeProfile) await fs.rm(runtimeProfile.root, { recursive: true, force: true }).catch(() => {});
      if (ownsPacketPath && resolvedPacketPath) await fs.rm(resolvedPacketPath, { force: true }).catch(() => {});
    }
  }

  #terminateRunning(running, reason = 'runtime-stop') {
    if (!running?.child) return false;
    if (!running.termination) running.termination = terminationRecord(reason);
    if (running.claim) running.claim.termination = running.termination;
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

  cancelMission(missionId) {
    this.cancelledMissions.add(missionId);
    const tasks = [...this.claims.entries()]
      .filter(([, claim]) => claim.missionId === missionId)
      .map(([taskKey, claim]) => ({ taskKey, taskId: claim.taskId, accepted: this.cancel(taskKey) }));
    return {
      missionId,
      fenced: true,
      requested: tasks.length,
      accepted: tasks.filter((item) => item.accepted).length,
      tasks
    };
  }

  cancel(taskKey) {
    const running = this.running.get(taskKey);
    if (running) return this.#terminateRunning(running, 'operator-cancel');
    const claim = this.claims.get(taskKey);
    if (!claim) return false;
    if (!claim.termination) claim.termination = terminationRecord('operator-cancel');
    return true;
  }
}
