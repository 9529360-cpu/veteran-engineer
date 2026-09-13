import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOCK_STALE_MS, DEFAULT_LOCK_TIMEOUT_MS, STATE_SCHEMA_VERSION } from './constants.mjs';
import { clone, ensureDir, nowIso, pathExists, randomId, sha256, sleep, stableStringify } from './util.mjs';

function emptyState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    projects: {},
    missions: {},
    tasks: {},
    evidence: {},
    experiences: {},
    requests: {},
    runtime: {
      timeline: [],
      maintenance: {}
    }
  };
}

async function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export class StateStore {
  constructor({ root, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS, lockStaleMs = DEFAULT_LOCK_STALE_MS } = {}) {
    if (!root) throw new Error('StateStore root is required');
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, 'state.json');
    this.backupPath = path.join(this.root, 'state.json.bak');
    this.lockPath = path.join(this.root, 'state.lock');
    this.auditPath = path.join(this.root, 'audit.jsonl');
    this.artifactsDir = path.join(this.root, 'artifacts');
    this.worktreesDir = path.join(this.root, 'worktrees');
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
  }

  async init() {
    await ensureDir(this.root);
    await ensureDir(this.artifactsDir);
    await ensureDir(this.worktreesDir);
    const release = await this.acquireLock();
    try {
      if (!(await pathExists(this.statePath))) {
        await this.#writeAtomic(emptyState(), { backup: false });
        await this.#appendAudit('state_initialized', { schemaVersion: STATE_SCHEMA_VERSION });
      } else {
        const state = await this.read();
        let changed = false;
        for (const request of Object.values(state.requests || {})) {
          if (request.status === 'started') {
            request.status = 'unknown';
            request.reconciledAt = nowIso();
            changed = true;
          }
        }
        if (changed) {
          await this.#writeAtomic(state);
          await this.#appendAudit('request_outcomes_reconciled_unknown', { count: Object.values(state.requests || {}).filter((request) => request.status === 'unknown').length });
        }
      }
    } finally {
      await release();
    }
    return this;
  }

  async acquireLock() {
    await ensureDir(this.root);
    const started = Date.now();
    const token = randomId('lock');
    while (true) {
      try {
        const handle = await fs.open(this.lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: nowIso() }));
          await handle.sync();
        } finally {
          // Windows may deny other processes even read access while this handle is open.
          // Lock ownership is represented by the atomically-created file and token.
          await handle.close().catch(() => {});
        }
        return async () => {
          try {
            const raw = await fs.readFile(this.lockPath, 'utf8');
            const current = JSON.parse(raw);
            if (current.token === token) await fs.unlink(this.lockPath);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let stale = false;
        try {
          const [stat, raw] = await Promise.all([fs.stat(this.lockPath), fs.readFile(this.lockPath, 'utf8')]);
          const ageMs = Date.now() - stat.mtimeMs;
          try {
            const lock = JSON.parse(raw);
            stale = ageMs > this.lockStaleMs && !(await pidAlive(lock.pid));
          } catch {
            // A newly created lock can be observed before its JSON payload is fully written.
            // Never delete a young malformed/partial lock; only age can make it reclaimable.
            stale = ageMs > this.lockStaleMs;
          }
        } catch (inspectError) {
          if (inspectError?.code === 'ENOENT') continue;
          throw inspectError;
        }
        if (stale) {
          await fs.unlink(this.lockPath).catch((unlinkError) => {
            if (unlinkError?.code !== 'ENOENT') throw unlinkError;
          });
          continue;
        }
        if (Date.now() - started >= this.lockTimeoutMs) {
          const timeout = new Error(`Timed out waiting for state lock after ${this.lockTimeoutMs}ms`);
          timeout.code = 'STATE_LOCK_TIMEOUT';
          throw timeout;
        }
        await sleep(25);
      }
    }
  }

  async read() {
    await ensureDir(this.root);
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
        const error = new Error(`Unsupported state schema: ${parsed.schemaVersion}`);
        error.code = 'STATE_SCHEMA_UNSUPPORTED';
        throw error;
      }
      return parsed;
    } catch (error) {
      if (!(await pathExists(this.backupPath))) throw error;
      const recovered = JSON.parse(await fs.readFile(this.backupPath, 'utf8'));
      if (recovered.schemaVersion !== STATE_SCHEMA_VERSION) throw error;
      await this.#writeAtomic(recovered, { backup: false });
      await this.#appendAudit('state_recovered_from_backup', { reason: error.message });
      return recovered;
    }
  }

  async transaction(eventType, mutator, auditSummary = {}) {
    const release = await this.acquireLock();
    try {
      const state = await this.read();
      const working = clone(state);
      const result = await mutator(working);
      working.updatedAt = nowIso();
      await this.#writeAtomic(working);
      await this.#appendAudit(eventType, auditSummary);
      return result;
    } finally {
      await release();
    }
  }

  async recordTimeline(event) {
    return this.transaction('runtime_timeline', (state) => {
      state.runtime.timeline.push({ ...event, at: event.at || nowIso() });
      if (state.runtime.timeline.length > 2000) state.runtime.timeline.splice(0, state.runtime.timeline.length - 2000);
    }, { type: event.type, missionId: event.missionId, taskId: event.taskId });
  }

  async verifyAudit() {
    if (!(await pathExists(this.auditPath))) return { ok: true, entries: 0, head: null };
    const raw = await fs.readFile(this.auditPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let prevHash = null;
    let seq = 0;
    for (const line of lines) {
      const entry = JSON.parse(line);
      seq += 1;
      if (entry.seq !== seq || entry.prevHash !== prevHash) {
        return { ok: false, entries: seq - 1, reason: 'chain-link-mismatch', entry };
      }
      const material = stableStringify({ seq: entry.seq, at: entry.at, type: entry.type, summary: entry.summary, prevHash: entry.prevHash });
      const expected = sha256(material);
      if (entry.hash !== expected) return { ok: false, entries: seq - 1, reason: 'hash-mismatch', entry };
      prevHash = entry.hash;
    }
    return { ok: true, entries: lines.length, head: prevHash };
  }

  async #writeAtomic(state, { backup = true } = {}) {
    await ensureDir(this.root);
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    const handle = await fs.open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(serialized);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (backup && (await pathExists(this.statePath))) {
      await fs.copyFile(this.statePath, this.backupPath);
    }
    await fs.rename(tempPath, this.statePath);
    try {
      const dir = await fs.open(this.root, 'r');
      await dir.sync();
      await dir.close();
    } catch {
      // Directory fsync is not uniformly supported; state file fsync remains authoritative.
    }
  }

  async #appendAudit(type, summary) {
    await ensureDir(this.root);
    let prevHash = null;
    let seq = 1;
    if (await pathExists(this.auditPath)) {
      const raw = await fs.readFile(this.auditPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length) {
        const last = JSON.parse(lines.at(-1));
        prevHash = last.hash;
        seq = last.seq + 1;
      }
    }
    const base = { seq, at: nowIso(), type, summary, prevHash };
    const entry = { ...base, hash: sha256(stableStringify(base)) };
    const handle = await fs.open(this.auditPath, 'a', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export { emptyState };
