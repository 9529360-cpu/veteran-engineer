import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertLocalPathAllowed } from './workspace-policy.mjs';
import { signalProcessTree } from './process-lifecycle-authority.mjs';
import { randomId } from './util.mjs';

export const MACHINE_ACTION_CONTRACT = 'veteran-machine-action-v1';

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
      id: session.id, pid: session.pid, status: session.status, command: session.command, args: session.args, cwd: session.cwd,
      startedAt: session.startedAt, endedAt: session.endedAt || null, exitCode: session.exitCode ?? null,
      signal: session.signal || null, timedOut: session.timedOut === true, droppedEvents: session.droppedEvents || 0
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

    if (operation === 'fs.write' || operation === 'fs.append') {
      const target = await this.#allowedWritePath(args.path, 'file write path');
      const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
      const data = decodeContent(args.content, encoding);
      if (data.length > this.limits.maxWriteBytes) {
        throw codedError('MACHINE_WRITE_TOO_LARGE', 'Machine file write exceeds configured maxWriteBytes', { bytes: data.length, maxWriteBytes: this.limits.maxWriteBytes });
      }
      if (args.createParents !== false) await fs.mkdir(path.dirname(target), { recursive: true });
      if (operation === 'fs.append') await fs.appendFile(target, data);
      else await fs.writeFile(target, data);
      return { operation, path: target, bytes: data.length, encoding };
    }

    if (operation === 'fs.mkdir') {
      const target = await this.#allowedWritePath(args.path, 'directory create path');
      await fs.mkdir(target, { recursive: true });
      return { operation, path: target, created: true };
    }

    if (operation === 'fs.move') {
      const source = await this.#allowedReadPath(args.path, 'move source');
      const destination = await this.#allowedWritePath(args.destination, 'move destination');
      if (args.createParents !== false) await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      return { operation, path: source, destination };
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
        const startedAt = Date.now();
        child.stdout.on('data', (chunk) => { const next = appendBounded(stdout, chunk, this.limits.maxSessionOutputBytes); stdout = next.text; stdoutTruncated ||= next.truncated; });
        child.stderr.on('data', (chunk) => { const next = appendBounded(stderr, chunk, this.limits.maxSessionOutputBytes); stderr = next.text; stderrTruncated ||= next.truncated; });
        const timeoutHandle = setTimeout(() => { timedOut = true; signalProcessTree(child.pid, 'SIGKILL'); }, timeoutMs);
        timeoutHandle.unref?.();
        const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
        clearTimeout(timeoutHandle);
        return {
          operation, persistent: false, pid: child.pid, command, args: argv, cwd, exitCode: exit.code, signal: exit.signal || null,
          timedOut, durationMs: Date.now() - startedAt, stdout, stderr, truncated: { stdout: stdoutTruncated, stderr: stderrTruncated }
        };
      }

      const session = {
        id: randomId('machinesession'), pid: child.pid, command, args: argv, cwd, child, status: 'running',
        startedAt: new Date().toISOString(), endedAt: null, exitCode: null, signal: null, timedOut: false,
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
      return { operation, persistent: true, session: this.#sessionSummary(session) };
    }

    if (operation === 'process.input') {
      const session = this.sessions.get(String(args.sessionId || ''));
      if (!session) throw codedError('MACHINE_SESSION_NOT_FOUND', 'Unknown machine process session', { sessionId: args.sessionId || null });
      if (session.status !== 'running' || !session.child.stdin?.writable) throw codedError('MACHINE_SESSION_NOT_WRITABLE', 'Machine process session is not accepting input', { sessionId: session.id, status: session.status });
      const input = String(args.input ?? '');
      session.child.stdin.write(input);
      return { operation, sessionId: session.id, acceptedBytes: Buffer.byteLength(input) };
    }

    if (operation === 'process.stop') {
      const session = this.sessions.get(String(args.sessionId || ''));
      if (!session) throw codedError('MACHINE_SESSION_NOT_FOUND', 'Unknown machine process session', { sessionId: args.sessionId || null });
      if (session.status !== 'running') return { operation, session: this.#sessionSummary(session), signalled: false, reason: 'already-exited' };
      const signal = args.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM';
      const result = signalProcessTree(session.pid, signal);
      this.#recordEvent(session, 'system', 'Process stop requested with ' + signal + '.');
      return { operation, session: this.#sessionSummary(session), ...result };
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
