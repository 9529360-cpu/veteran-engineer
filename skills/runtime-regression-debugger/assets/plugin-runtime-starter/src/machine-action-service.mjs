import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertLocalPathAllowed } from './workspace-policy.mjs';
import { signalProcessTree } from './process-lifecycle-authority.mjs';
import { randomId } from './util.mjs';

export const MACHINE_ACTION_CONTRACT = 'veteran-machine-action-v2';
export const MACHINE_ACTION_RECEIPT_CONTRACT = 'veteran-machine-action-receipt-v1';

const DEFAULT_LIMITS = Object.freeze({
  maxReadBytes: 256 * 1024,
  maxWriteBytes: 512 * 1024,
  maxSearchFiles: 2000,
  maxSearchMatches: 200,
  maxSessionOutputBytes: 1024 * 1024,
  maxSessions: 8,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  maxPersistentMs: 4 * 60 * 60 * 1000
});

const SEARCH_SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache', 'vendor', 'target'
]);

const SAFE_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC',
  'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA'
];

function codedError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function positiveInteger(value, fallback, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function safeChildEnvironment() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function executableKey(command) {
  const text = String(command || '').trim();
  if (!text) throw codedError('MACHINE_COMMAND_REQUIRED', 'machine process start requires command');
  if (path.isAbsolute(text) || text.includes('/') || text.includes('\\')) {
    throw codedError('MACHINE_EXECUTABLE_PATH_REJECTED', 'machine process start accepts an allowlisted executable name, not an arbitrary executable path');
  }
  return text.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
}

function decodeContent(content, encoding) {
  const text = String(content ?? '');
  return encoding === 'base64' ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
}

function appendBounded(current, chunk, maxBytes) {
  const joined = Buffer.from(current + String(chunk), 'utf8');
  if (joined.length <= maxBytes) return { text: joined.toString('utf8'), truncated: false };
  return { text: joined.subarray(Math.max(0, joined.length - maxBytes)).toString('utf8'), truncated: true };
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedSha256(value) {
  if (value === undefined || value === null || value === '') return null;
  const digest = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw codedError('MACHINE_SHA256_INVALID', 'expectedSha256 must be a lowercase or uppercase 64-character SHA-256 hex digest');
  }
  return digest;
}

async function fileFingerprint(target) {
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return { exists: true, type: stat.isDirectory() ? 'directory' : 'other', bytes: stat.size, sha256: null, mtime: stat.mtime.toISOString() };
    }
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const stream = createReadStream(target);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', resolve);
    });
    return { exists: true, type: 'file', bytes: stat.size, sha256: hash.digest('hex'), mtime: stat.mtime.toISOString() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, type: null, bytes: 0, sha256: null, mtime: null };
    throw error;
  }
}

function assertMutationPrecondition(state, args, target, { requireRegularFile = false } = {}) {
  const expectedSha256 = normalizedSha256(args.expectedSha256);
  if (args.requireAbsent === true && state.exists) {
    throw codedError('MACHINE_FILE_PRECONDITION_FAILED', 'Machine action expected the target to be absent before mutation', {
      path: target, requireAbsent: true, actualSha256: state.sha256, actualType: state.type
    });
  }
  if (expectedSha256 !== null) {
    if (!state.exists || state.sha256 !== expectedSha256) {
      throw codedError('MACHINE_FILE_PRECONDITION_FAILED', 'Machine action file fingerprint no longer matches expectedSha256', {
        path: target, expectedSha256, actualSha256: state.sha256, actualType: state.type, exists: state.exists
      });
    }
  }
  if (requireRegularFile && state.exists && state.type !== 'file') {
    throw codedError('MACHINE_FILE_REQUIRED', 'Machine action requires a regular file for this fingerprint precondition', {
      path: target, actualType: state.type
    });
  }
  return expectedSha256;
}

async function runBoundedProcess(command, args, cwd, { timeoutMs = 5_000, maxOutputBytes = 256 * 1024, allowExitCodes = [0] } = {}) {
  const child = spawn(command, args, {
    cwd, env: safeChildEnvironment(), shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '', stderr = '', stdoutTruncated = false, stderrTruncated = false, timedOut = false;
  child.stdout.on('data', (chunk) => {
    const next = appendBounded(stdout, chunk, maxOutputBytes);
    stdout = next.text;
    stdoutTruncated ||= next.truncated;
  });
  child.stderr.on('data', (chunk) => {
    const next = appendBounded(stderr, chunk, maxOutputBytes);
    stderr = next.text;
    stderrTruncated ||= next.truncated;
  });
  const startedAt = Date.now();
  let spawnError = null;
  child.once('error', (error) => { spawnError = error; });
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    if (Number.isInteger(child.pid)) signalProcessTree(child.pid, 'SIGKILL');
  }, timeoutMs);
  timeoutHandle.unref?.();
  const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timeoutHandle);
  if (spawnError) throw spawnError;
  if (timedOut) {
    throw codedError('MACHINE_INSPECT_TIMEOUT', 'Read-only machine inspection process timed out', {
      command, args, timeoutMs, durationMs: Date.now() - startedAt
    });
  }
  if (!allowExitCodes.includes(exit.code)) {
    const error = codedError('MACHINE_INSPECT_PROCESS_FAILED', 'Read-only machine inspection process failed', {
      command, args, exitCode: exit.code, signal: exit.signal || null,
      stderr: stderr.slice(-4000), stdout: stdout.slice(-4000)
    });
    error.exitCode = exit.code;
    throw error;
  }
  return {
    stdout, stderr, exitCode: exit.code, signal: exit.signal || null,
    durationMs: Date.now() - startedAt,
    truncated: { stdout: stdoutTruncated, stderr: stderrTruncated }
  };
}

function parseGitStatusPorcelainV2(raw) {
  const summary = {
    branch: null, upstream: null, ahead: 0, behind: 0,
    staged: 0, unstaged: 0, untracked: 0, conflicts: 0, dirty: false
  };
  const rows = String(raw || '').split(/\0|\r?\n/).filter(Boolean);
  for (const row of rows) {
    if (row.startsWith('# branch.head ')) {
      const value = row.slice('# branch.head '.length).trim();
      summary.branch = value === '(detached)' ? null : value;
      continue;
    }
    if (row.startsWith('# branch.upstream ')) {
      summary.upstream = row.slice('# branch.upstream '.length).trim() || null;
      continue;
    }
    if (row.startsWith('# branch.ab ')) {
      const match = row.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        summary.ahead = Number(match[1]);
        summary.behind = Number(match[2]);
      }
      continue;
    }
    if (row.startsWith('? ')) {
      summary.untracked += 1;
      continue;
    }
    if (row.startsWith('! ')) continue;
    if (row.startsWith('u ')) {
      summary.conflicts += 1;
      continue;
    }
    if (row.startsWith('1 ') || row.startsWith('2 ')) {
      const xy = row.split(' ', 3)[1] || '..';
      if (xy[0] && xy[0] !== '.') summary.staged += 1;
      if (xy[1] && xy[1] !== '.') summary.unstaged += 1;
    }
  }
  summary.dirty = summary.staged > 0 || summary.unstaged > 0 || summary.untracked > 0 || summary.conflicts > 0;
  return summary;
}

async function nearestExistingParent(candidate) {
  let current = path.resolve(candidate);
  for (;;) {
    try { await fs.lstat(current); return current; }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

export class MachineActionService {
  constructor({
    enabled = false,
    allowedLocalRoots = [],
    allowedExecutables = [],
    deviceId = null,
    deviceName = os.hostname(),
    maxReadBytes = DEFAULT_LIMITS.maxReadBytes,
    maxWriteBytes = DEFAULT_LIMITS.maxWriteBytes,
    maxSearchFiles = DEFAULT_LIMITS.maxSearchFiles,
    maxSearchMatches = DEFAULT_LIMITS.maxSearchMatches,
    maxSessionOutputBytes = DEFAULT_LIMITS.maxSessionOutputBytes,
    maxSessions = DEFAULT_LIMITS.maxSessions,
    defaultTimeoutMs = DEFAULT_LIMITS.defaultTimeoutMs,
    maxTimeoutMs = DEFAULT_LIMITS.maxTimeoutMs,
    maxPersistentMs = DEFAULT_LIMITS.maxPersistentMs
  } = {}) {
    this.enabled = enabled === true;
    this.allowedLocalRoots = [...new Set((allowedLocalRoots || []).map((value) => path.resolve(String(value))))];
    this.allowedExecutables = [...new Set((allowedExecutables || []).map((value) => executableKey(value)))];
    this.deviceId = deviceId || null;
    this.deviceName = String(deviceName || os.hostname());
    this.limits = {
      maxReadBytes: positiveInteger(maxReadBytes, DEFAULT_LIMITS.maxReadBytes, 4 * 1024 * 1024),
      maxWriteBytes: positiveInteger(maxWriteBytes, DEFAULT_LIMITS.maxWriteBytes, 8 * 1024 * 1024),
      maxSearchFiles: positiveInteger(maxSearchFiles, DEFAULT_LIMITS.maxSearchFiles, 20_000),
      maxSearchMatches: positiveInteger(maxSearchMatches, DEFAULT_LIMITS.maxSearchMatches, 2_000),
      maxSessionOutputBytes: positiveInteger(maxSessionOutputBytes, DEFAULT_LIMITS.maxSessionOutputBytes, 8 * 1024 * 1024),
      maxSessions: positiveInteger(maxSessions, DEFAULT_LIMITS.maxSessions, 32),
      defaultTimeoutMs: positiveInteger(defaultTimeoutMs, DEFAULT_LIMITS.defaultTimeoutMs, 10 * 60 * 1000),
      maxTimeoutMs: positiveInteger(maxTimeoutMs, DEFAULT_LIMITS.maxTimeoutMs, 30 * 60 * 1000),
      maxPersistentMs: positiveInteger(maxPersistentMs, DEFAULT_LIMITS.maxPersistentMs, 24 * 60 * 60 * 1000)
    };
    this.sessions = new Map();
  }

  #assertEnabled() {
    if (!this.enabled) throw codedError('MACHINE_ACTIONS_DISABLED', 'Veteran Machine Actions are disabled for this host. Enable them explicitly in Remote Host config.');
    if (this.allowedLocalRoots.length === 0) throw codedError('MACHINE_WORKSPACE_REQUIRED', 'Veteran Machine Actions require at least one allowed local workspace root.');
  }

  async #allowedReadPath(candidate, label = 'machine path') {
    this.#assertEnabled();
    if (typeof candidate !== 'string' || !candidate.trim()) throw codedError('MACHINE_PATH_REQUIRED', label + ' is required');
    return assertLocalPathAllowed(candidate, this.allowedLocalRoots, { label });
  }

  async #allowedWritePath(candidate, label = 'machine write path') {
    this.#assertEnabled();
    if (typeof candidate !== 'string' || !candidate.trim()) throw codedError('MACHINE_PATH_REQUIRED', label + ' is required');
    const resolved = path.resolve(candidate);
    await assertLocalPathAllowed(await nearestExistingParent(resolved), this.allowedLocalRoots, { label });
    return resolved;
  }

  #assertExecutable(command) {
    this.#assertEnabled();
    const key = executableKey(command);
    if (!this.allowedExecutables.includes(key)) {
      throw codedError('MACHINE_EXECUTABLE_NOT_ALLOWED', 'Executable is not allowlisted for Veteran Machine Actions: ' + key, {
        executable: key, allowedExecutables: this.allowedExecutables
      });
    }
    return String(command).trim();
  }

  #pruneSessions() {
    if (this.sessions.size < this.limits.maxSessions) return;
    const finished = [...this.sessions.values()].filter((item) => item.status !== 'running')
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    while (this.sessions.size >= this.limits.maxSessions && finished.length) {
      const next = finished.shift();
      clearTimeout(next.timeoutHandle);
      this.sessions.delete(next.id);
    }
    if (this.sessions.size >= this.limits.maxSessions) {
      throw codedError('MACHINE_SESSION_LIMIT', 'Veteran Machine Actions reached the configured active session limit', { maxSessions: this.limits.maxSessions });
    }
  }

  #sessionSummary(session) {
    return {
      id: session.id, actionId: session.actionId || null, pid: session.pid, status: session.status,
      command: session.command, args: session.args, cwd: session.cwd,
      startedAt: session.startedAt, endedAt: session.endedAt || null, exitCode: session.exitCode ?? null,
      signal: session.signal || null, timedOut: session.timedOut === true, droppedEvents: session.droppedEvents || 0
    };
  }

  #actionReceipt({ actionId, operation, startedAt, outcome = 'completed', resultIdentity = null, target = null, parentActionId = null, endedAt = null } = {}) {
    return {
      contract: MACHINE_ACTION_RECEIPT_CONTRACT,
      actionId,
      operation,
      device: { id: this.deviceId, name: this.deviceName, platform: process.platform, arch: process.arch },
      startedAt,
      endedAt: endedAt ?? (outcome === 'running' ? null : new Date().toISOString()),
      outcome,
      ...(resultIdentity ? { resultIdentity } : {}),
      ...(target ? { target } : {}),
      ...(parentActionId ? { parentActionId } : {})
    };
  }

  #recordEvent(session, stream, chunk) {
    const text = String(chunk);
    if (!text) return;
    session.events.push({ seq: session.nextSeq++, at: new Date().toISOString(), stream, text });
    session.eventBytes += Buffer.byteLength(text);
    while (session.events.length && session.eventBytes > this.limits.maxSessionOutputBytes) {
      const removed = session.events.shift();
      session.eventBytes -= Buffer.byteLength(removed.text);
      session.droppedEvents += 1;
    }
  }

  async inspect(args = {}) {
    const operation = String(args.operation || '');
    if (operation === 'status') {
      return {
        operation, contract: MACHINE_ACTION_CONTRACT, enabled: this.enabled,
        device: { id: this.deviceId, name: this.deviceName, platform: process.platform, arch: process.arch, hostname: os.hostname() },
        allowedLocalRoots: [...this.allowedLocalRoots], allowedExecutables: [...this.allowedExecutables], limits: { ...this.limits },
        sessions: { total: this.sessions.size, running: [...this.sessions.values()].filter((item) => item.status === 'running').length },
        executionBoundary: 'application-policy-not-os-sandbox'
      };
    }
    this.#assertEnabled();

    if (operation === 'fs.list') {
      const target = await this.#allowedReadPath(args.path, 'directory path');
      const limit = positiveInteger(args.limit, 200, 500);
      const entries = await fs.readdir(target, { withFileTypes: true });
      return {
        operation, path: target,
        entries: entries.slice(0, limit).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other'
        })),
        total: entries.length, truncated: entries.length > limit
      };
    }

    if (operation === 'fs.stat') {
      const target = await this.#allowedReadPath(args.path);
      const stat = await fs.lstat(target);
      return { operation, path: target, stat: {
        type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other',
        size: stat.size, mode: stat.mode, mtime: stat.mtime.toISOString(), ctime: stat.ctime.toISOString()
      }};
    }

    if (operation === 'fs.read') {
      const target = await this.#allowedReadPath(args.path, 'file path');
      const offsetBytes = nonNegativeInteger(args.offsetBytes, 0);
      const maxBytes = positiveInteger(args.maxBytes, this.limits.maxReadBytes, this.limits.maxReadBytes);
      const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
      const handle = await fs.open(target, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw codedError('MACHINE_FILE_REQUIRED', 'fs.read requires a regular file', { path: target });
        const bytesToRead = Math.min(maxBytes, Math.max(0, stat.size - offsetBytes));
        const buffer = Buffer.alloc(bytesToRead);
        const read = bytesToRead ? await handle.read(buffer, 0, bytesToRead, offsetBytes) : { bytesRead: 0 };
        const body = buffer.subarray(0, read.bytesRead);
        return {
          operation, path: target, encoding, offsetBytes, bytes: read.bytesRead, totalBytes: stat.size,
          nextOffsetBytes: offsetBytes + read.bytesRead, eof: offsetBytes + read.bytesRead >= stat.size, data: body.toString(encoding)
        };
      } finally { await handle.close(); }
    }

    if (operation === 'fs.digest') {
      const target = await this.#allowedReadPath(args.path, 'file path');
      const fingerprint = await fileFingerprint(target);
      if (!fingerprint.exists || fingerprint.type !== 'file') {
        throw codedError('MACHINE_FILE_REQUIRED', 'fs.digest requires a regular file', { path: target, actualType: fingerprint.type });
      }
      return { operation, path: target, algorithm: 'sha256', digest: fingerprint.sha256, bytes: fingerprint.bytes, mtime: fingerprint.mtime };
    }

    if (operation === 'repo.status') {
      const target = await this.#allowedReadPath(args.path || this.allowedLocalRoots[0], 'repository path');
      const targetStat = await fs.stat(target);
      const cwd = targetStat.isDirectory() ? target : path.dirname(target);
      let rootProbe;
      try {
        rootProbe = await runBoundedProcess('git', ['rev-parse', '--show-toplevel'], cwd, {
          timeoutMs: Math.min(this.limits.defaultTimeoutMs, 10_000),
          maxOutputBytes: this.limits.maxReadBytes
        });
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw codedError('MACHINE_GIT_UNAVAILABLE', 'repo.status requires git on the machine PATH');
        }
        if (error?.code === 'MACHINE_INSPECT_PROCESS_FAILED') {
          throw codedError('MACHINE_GIT_REPOSITORY_REQUIRED', 'repo.status path is not inside a readable Git worktree', { path: target });
        }
        throw error;
      }
      const repositoryRoot = await this.#allowedReadPath(rootProbe.stdout.trim(), 'repository root');
      const [headResult, branchResult, statusResult, originResult] = await Promise.all([
        runBoundedProcess('git', ['rev-parse', 'HEAD'], repositoryRoot, {
          timeoutMs: Math.min(this.limits.defaultTimeoutMs, 10_000), maxOutputBytes: this.limits.maxReadBytes
        }),
        runBoundedProcess('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], repositoryRoot, {
          timeoutMs: Math.min(this.limits.defaultTimeoutMs, 10_000), maxOutputBytes: this.limits.maxReadBytes, allowExitCodes: [0, 1]
        }),
        runBoundedProcess('git', ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'], repositoryRoot, {
          timeoutMs: Math.min(this.limits.defaultTimeoutMs, 10_000), maxOutputBytes: this.limits.maxReadBytes
        }),
        runBoundedProcess('git', ['remote', 'get-url', 'origin'], repositoryRoot, {
          timeoutMs: Math.min(this.limits.defaultTimeoutMs, 10_000), maxOutputBytes: this.limits.maxReadBytes, allowExitCodes: [0, 2]
        })
      ]);
      const parsed = parseGitStatusPorcelainV2(statusResult.stdout);
      const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || parsed.branch : parsed.branch;
      return {
        operation,
        contract: MACHINE_ACTION_CONTRACT,
        observedAt: new Date().toISOString(),
        repository: {
          root: repositoryRoot,
          head: headResult.stdout.trim(),
          branch: branch || null,
          detached: !branch,
          upstream: parsed.upstream,
          ahead: parsed.ahead,
          behind: parsed.behind,
          dirty: parsed.dirty,
          staged: parsed.staged,
          unstaged: parsed.unstaged,
          untracked: parsed.untracked,
          conflicts: parsed.conflicts,
          origin: originResult.exitCode === 0 ? originResult.stdout.trim() || null : null
        }
      };
    }

    if (operation === 'fs.search') {
      const root = await this.#allowedReadPath(args.path, 'search root');
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) throw codedError('MACHINE_SEARCH_QUERY_REQUIRED', 'fs.search requires a non-empty query');
      const maxMatches = positiveInteger(args.limit, Math.min(50, this.limits.maxSearchMatches), this.limits.maxSearchMatches);
      const includeContent = args.includeContent !== false;
      const queue = [root];
      const matches = [];
      let filesScanned = 0;
      while (queue.length && matches.length < maxMatches && filesScanned < this.limits.maxSearchFiles) {
        const current = queue.shift();
        let entries;
        try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (matches.length >= maxMatches || filesScanned >= this.limits.maxSearchFiles) break;
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (!SEARCH_SKIP_DIRS.has(entry.name)) queue.push(full);
            continue;
          }
          if (!entry.isFile()) continue;
          filesScanned += 1;
          if (entry.name.toLowerCase().includes(query)) {
            matches.push({ path: full, kind: 'name' });
            if (matches.length >= maxMatches) break;
          }
          if (!includeContent) continue;
          let stat;
          try { stat = await fs.stat(full); } catch { continue; }
          if (stat.size > this.limits.maxReadBytes) continue;
          let text;
          try { text = await fs.readFile(full, 'utf8'); } catch { continue; }
          const lines = text.split(/\r?\n/);
          for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
            if (lines[index].toLowerCase().includes(query)) matches.push({ path: full, kind: 'content', line: index + 1, preview: lines[index].slice(0, 500) });
          }
        }
      }
      return { operation, path: root, query, matches, filesScanned, truncated: queue.length > 0 || matches.length >= maxMatches || filesScanned >= this.limits.maxSearchFiles };
    }

    if (operation === 'process.list') return { operation, sessions: [...this.sessions.values()].map((item) => this.#sessionSummary(item)) };
    if (operation === 'process.status' || operation === 'process.output') {
      const session = this.sessions.get(String(args.sessionId || ''));
      if (!session) throw codedError('MACHINE_SESSION_NOT_FOUND', 'Unknown machine process session', { sessionId: args.sessionId || null });
      if (operation === 'process.status') return { operation, session: this.#sessionSummary(session) };
      const offset = nonNegativeInteger(args.offset, 0);
      const limit = positiveInteger(args.limit, 100, 1000);
      const events = session.events.slice(offset, offset + limit);
      return {
        operation, session: this.#sessionSummary(session), events, offset, nextOffset: offset + events.length,
        totalEvents: session.events.length, truncated: offset + events.length < session.events.length, droppedEvents: session.droppedEvents
      };
    }
    throw codedError('MACHINE_INSPECT_OPERATION_UNSUPPORTED', 'Unsupported machine_inspect operation: ' + operation);
  }

  async act(args = {}) {
    const operation = String(args.operation || '');
    this.#assertEnabled();
    const actionId = randomId('machineaction');
    const startedAt = new Date().toISOString();
    const receipt = (options = {}) => this.#actionReceipt({ actionId, operation, startedAt, ...options });

    if (operation === 'fs.write' || operation === 'fs.append') {
      const target = await this.#allowedWritePath(args.path, 'file write path');
      const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
      const data = decodeContent(args.content, encoding);
      if (data.length > this.limits.maxWriteBytes) {
        throw codedError('MACHINE_WRITE_TOO_LARGE', 'Machine file write exceeds configured maxWriteBytes', { bytes: data.length, maxWriteBytes: this.limits.maxWriteBytes });
      }
      const before = await fileFingerprint(target);
      assertMutationPrecondition(before, args, target, { requireRegularFile: operation === 'fs.append' });
      if (args.createParents !== false) await fs.mkdir(path.dirname(target), { recursive: true });
      if (operation === 'fs.append') await fs.appendFile(target, data);
      else await fs.writeFile(target, data);
      const after = await fileFingerprint(target);
      return {
        operation, path: target, bytes: data.length, encoding,
        created: !before.exists,
        ...(before.sha256 ? { beforeSha256: before.sha256, beforeBytes: before.bytes } : {}),
        ...(after.sha256 ? { afterSha256: after.sha256, afterBytes: after.bytes } : {}),
        receipt: receipt({ resultIdentity: after.sha256 ? 'sha256:' + after.sha256 : 'action:' + actionId, target })
      };
    }

    if (operation === 'fs.mkdir') {
      const target = await this.#allowedWritePath(args.path, 'directory create path');
      const before = await fileFingerprint(target);
      if (args.requireAbsent === true && before.exists) {
        throw codedError('MACHINE_FILE_PRECONDITION_FAILED', 'Machine action expected the directory path to be absent before mkdir', {
          path: target, actualType: before.type
        });
      }
      await fs.mkdir(target, { recursive: true });
      return {
        operation, path: target, created: !before.exists,
        receipt: receipt({ resultIdentity: 'action:' + actionId, target })
      };
    }

    if (operation === 'fs.move') {
      const source = await this.#allowedReadPath(args.path, 'move source');
      const destination = await this.#allowedWritePath(args.destination, 'move destination');
      const sourceBefore = await fileFingerprint(source);
      assertMutationPrecondition(sourceBefore, { expectedSha256: args.expectedSha256 }, source, { requireRegularFile: args.expectedSha256 != null });
      const destinationBefore = await fileFingerprint(destination);
      if (args.requireAbsent === true && destinationBefore.exists) {
        throw codedError('MACHINE_FILE_PRECONDITION_FAILED', 'Machine action expected the move destination to be absent', {
          path: destination, actualSha256: destinationBefore.sha256, actualType: destinationBefore.type
        });
      }
      if (args.createParents !== false) await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      const destinationAfter = await fileFingerprint(destination);
      return {
        operation, path: source, destination,
        ...(sourceBefore.sha256 ? { beforeSha256: sourceBefore.sha256, beforeBytes: sourceBefore.bytes } : {}),
        ...(destinationAfter.sha256 ? { afterSha256: destinationAfter.sha256, afterBytes: destinationAfter.bytes } : {}),
        receipt: receipt({
          resultIdentity: destinationAfter.sha256 ? 'sha256:' + destinationAfter.sha256 : 'action:' + actionId,
          target: destination
        })
      };
    }

    if (operation === 'process.start') {
      this.#pruneSessions();
      const command = this.#assertExecutable(args.command);
      const argv = Array.isArray(args.args) ? args.args.map((value) => String(value)) : [];
      if (argv.length > 128 || argv.some((value) => value.length > 8192)) {
        throw codedError('MACHINE_COMMAND_ARGUMENTS_INVALID', 'Machine process arguments exceed bounded count/length limits');
      }
      const cwd = await this.#allowedReadPath(args.cwd || this.allowedLocalRoots[0], 'process cwd');
      const persistent = args.persistent === true;
      const maxTimeout = persistent ? this.limits.maxPersistentMs : this.limits.maxTimeoutMs;
      const timeoutMs = positiveInteger(args.timeoutMs, persistent ? Math.min(30 * 60 * 1000, maxTimeout) : this.limits.defaultTimeoutMs, maxTimeout);
      const child = spawn(command, argv, {
        cwd, env: safeChildEnvironment(), shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
      });
      await new Promise((resolve, reject) => {
        const onSpawn = () => { child.off('error', onError); resolve(); };
        const onError = (error) => { child.off('spawn', onSpawn); reject(error); };
        child.once('spawn', onSpawn); child.once('error', onError);
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      if (args.input !== undefined && args.input !== null) child.stdin.write(String(args.input));

      if (!persistent) {
        let stdout = '', stderr = '', stdoutTruncated = false, stderrTruncated = false, timedOut = false;
        const processStartedAt = Date.now();
        child.stdout.on('data', (chunk) => { const next = appendBounded(stdout, chunk, this.limits.maxSessionOutputBytes); stdout = next.text; stdoutTruncated ||= next.truncated; });
        child.stderr.on('data', (chunk) => { const next = appendBounded(stderr, chunk, this.limits.maxSessionOutputBytes); stderr = next.text; stderrTruncated ||= next.truncated; });
        const timeoutHandle = setTimeout(() => { timedOut = true; signalProcessTree(child.pid, 'SIGKILL'); }, timeoutMs);
        timeoutHandle.unref?.();
        const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
        clearTimeout(timeoutHandle);
        const outputSha256 = sha256Buffer(Buffer.from(stdout + '\0' + stderr, 'utf8'));
        return {
          operation, persistent: false, pid: child.pid, command, args: argv, cwd,
          ...(Number.isInteger(exit.code) ? { exitCode: exit.code } : {}),
          ...(exit.signal ? { signal: exit.signal } : {}),
          timedOut, durationMs: Date.now() - processStartedAt, stdout, stderr,
          outputSha256,
          truncated: { stdout: stdoutTruncated, stderr: stderrTruncated },
          receipt: receipt({ resultIdentity: 'process-action:' + actionId, target: cwd })
        };
      }

      const session = {
        id: randomId('machinesession'), actionId, pid: child.pid, command, args: argv, cwd, child, status: 'running',
        startedAt, endedAt: null, exitCode: null, signal: null, timedOut: false,
        events: [], eventBytes: 0, droppedEvents: 0, nextSeq: 0, timeoutHandle: null
      };
      child.stdout.on('data', (chunk) => this.#recordEvent(session, 'stdout', chunk));
      child.stderr.on('data', (chunk) => this.#recordEvent(session, 'stderr', chunk));
      child.once('close', (code, signal) => {
        session.status = 'exited'; session.endedAt = new Date().toISOString(); session.exitCode = code; session.signal = signal || null;
        clearTimeout(session.timeoutHandle);
      });
      child.once('error', (error) => this.#recordEvent(session, 'system', (error?.code ? error.code + ': ' : '') + (error?.message || String(error))));
      session.timeoutHandle = setTimeout(() => {
        if (session.status !== 'running') return;
        session.timedOut = true;
        this.#recordEvent(session, 'system', 'Persistent process exceeded configured timeout; terminating process tree.');
        signalProcessTree(session.pid, 'SIGKILL');
      }, timeoutMs);
      session.timeoutHandle.unref?.();
      this.sessions.set(session.id, session);
      return {
        operation, persistent: true, session: this.#sessionSummary(session),
        receipt: receipt({ outcome: 'running', resultIdentity: 'machinesession:' + session.id, target: cwd, endedAt: null })
      };
    }

    if (operation === 'process.input') {
      const session = this.sessions.get(String(args.sessionId || ''));
      if (!session) throw codedError('MACHINE_SESSION_NOT_FOUND', 'Unknown machine process session', { sessionId: args.sessionId || null });
      if (session.status !== 'running' || !session.child.stdin?.writable) throw codedError('MACHINE_SESSION_NOT_WRITABLE', 'Machine process session is not accepting input', { sessionId: session.id, status: session.status });
      const input = String(args.input ?? '');
      session.child.stdin.write(input);
      return {
        operation, sessionId: session.id, acceptedBytes: Buffer.byteLength(input),
        receipt: receipt({
          resultIdentity: 'machineinput:' + actionId,
          target: session.id,
          parentActionId: session.actionId || null
        })
      };
    }

    if (operation === 'process.stop') {
      const session = this.sessions.get(String(args.sessionId || ''));
      if (!session) throw codedError('MACHINE_SESSION_NOT_FOUND', 'Unknown machine process session', { sessionId: args.sessionId || null });
      if (session.status !== 'running') {
        return {
          operation, session: this.#sessionSummary(session), signalled: false, reason: 'already-exited',
          receipt: receipt({
            resultIdentity: 'machinestop:' + actionId,
            target: session.id,
            parentActionId: session.actionId || null
          })
        };
      }
      const signal = args.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM';
      const result = signalProcessTree(session.pid, signal);
      this.#recordEvent(session, 'system', 'Process stop requested with ' + signal + '.');
      return {
        operation, session: this.#sessionSummary(session), ...result,
        receipt: receipt({
          resultIdentity: 'machinestop:' + actionId,
          target: session.id,
          parentActionId: session.actionId || null
        })
      };
    }
    throw codedError('MACHINE_ACT_OPERATION_UNSUPPORTED', 'Unsupported machine_act operation: ' + operation);
  }

  async shutdown() {
    const active = [...this.sessions.values()].filter((session) => session.status === 'running');
    for (const session of active) {
      clearTimeout(session.timeoutHandle);
      signalProcessTree(session.pid, 'SIGKILL');
    }
    return { stopped: active.map((session) => session.id) };
  }
}
