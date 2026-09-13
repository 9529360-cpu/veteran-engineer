import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nowIso } from './util.mjs';
import { buildContainerInvocation, validateContainerWorkerConfig } from './container-worker.mjs';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'COMSPEC', 'LANG', 'LC_ALL', 'SHELL'];
const FORBIDDEN_CODEX_FLAGS = new Set([
  '--dangerously-bypass-approvals-and-sandbox', '--yolo', '--dangerously-bypass-hook-trust',
  '--sandbox', '-s', '--approve-for-me', '--not-so-yolo', '--cd', '-C', '--add-dir', '--worktree'
]);

function substitute(value, vars) {
  return String(value).replace(/\{(packet|worktree|taskId|missionId)\}/g, (_, key) => vars[key]);
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

export function enforceWorkerPolicy(project, task, config) {
  if (!project.workerPolicy?.enabled) {
    const error = new Error('Worker execution is disabled by operator policy');
    error.code = 'WORKER_EXECUTION_DISABLED';
    throw error;
  }
  if (config?.type === 'container') {
    validateContainerWorkerConfig(config);
  } else if (!config?.command) {
    const error = new Error('No worker executable is configured');
    error.code = 'WORKER_NOT_CONFIGURED';
    throw error;
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

export function buildWorkerInvocation({ config, worktreePath, packetPath, task, mission }) {
  if (config.type === 'container') return buildContainerInvocation({ config, worktreePath, packetPath, task, mission });
  const vars = { packet: packetPath, worktree: worktreePath, taskId: task.id, missionId: mission.id };
  return { command: config.command, args: (config.args || []).map((arg) => substitute(arg, vars)) };
}

export class WorkerAdapter {
  constructor() {
    this.running = new Map();
  }

  async run({ project, mission, task, worktreePath, packet, packetPath = null, config, timeoutMs = null }) {
    enforceWorkerPolicy(project, task, config);
    const resolvedPacketPath = packetPath || path.join(path.dirname(worktreePath), `.veteran-task-${task.id}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(resolvedPacketPath), { recursive: true });
    await fs.writeFile(resolvedPacketPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
    const invocation = buildWorkerInvocation({ config, worktreePath, packetPath: resolvedPacketPath, task, mission });
    const env = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
    for (const key of config.envAllowlist || []) if (process.env[key] !== undefined) env[key] = process.env[key];
    if (config.type !== 'container') Object.assign(env, config.env || {});
    env.VETERAN_TASK_PACKET = resolvedPacketPath;
    env.VETERAN_WORKTREE = worktreePath;
    env.VETERAN_TASK_ID = task.id;
    env.VETERAN_MISSION_ID = mission.id;

    const startedAt = nowIso();
    const child = spawn(invocation.command, invocation.args, { cwd: worktreePath, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.running.set(task.key, child);
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
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      }, effectiveTimeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    }).finally(() => this.running.delete(task.key));
    return { ...outcome, stdout, stderr, startedAt, endedAt: nowIso(), pid: child.pid, packetPath: resolvedPacketPath };
  }

  cancel(taskKey) {
    const child = this.running.get(taskKey);
    if (!child) return false;
    child.kill('SIGTERM');
    return true;
  }
}
