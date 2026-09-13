import { createRequire } from 'node:module';
import path from 'node:path';
import { STATE_SCHEMA_VERSION } from './constants.mjs';
import { STATE_BACKEND_CONTRACT } from './state-backend-contract.mjs';
import { STATE_BACKEND_TRANSACTION_CONTRACT, stateRevisionConflict } from './state-backend-transaction-contract.mjs';
import {
  STATE_BACKEND_DURABILITY_CONTRACT,
  STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN
} from './state-backend-durability-contract.mjs';
import { emptyState } from './state-store.mjs';
import { clone, ensureDir, nowIso, randomId, sha256, stableStringify } from './util.mjs';

export const POSTGRES_DRIVER_VERSION = '8.23.0';
const STATE_TABLE = 'veteran_engineer_state';
const AUDIT_TABLE = 'veteran_engineer_audit';
const require = createRequire(import.meta.url);

function configError(message, details = null) {
  const error = new Error(message);
  error.code = 'POSTGRES_STATE_BACKEND_CONFIG_INVALID';
  if (details) error.details = details;
  return error;
}

function auditIntegrityError(details) {
  const error = new Error(`PostgreSQL audit chain is not safe to use: ${details.reason || 'invalid audit chain'}`);
  error.code = 'STATE_AUDIT_INTEGRITY_FAILURE';
  error.details = details;
  return error;
}

function commitOutcomeUnknown(commit, cause) {
  const error = new Error(`PostgreSQL commit ${commit.id} outcome could not be reconciled; replay is unsafe until connectivity returns`);
  error.code = STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN;
  error.stateCommitted = 'unknown';
  error.auditOutcome = 'unknown';
  error.requiresReconciliation = true;
  error.details = {
    stateCommitId: commit.id,
    eventType: commit.eventType,
    commitOutcome: 'unknown',
    causeCode: cause?.code || 'ERROR',
    causeMessage: cause?.message || String(cause)
  };
  error.cause = cause;
  return error;
}

function auditMaterial(entry) {
  const material = {
    seq: entry.seq,
    at: entry.at,
    type: entry.type,
    summary: entry.summary,
    prevHash: entry.prevHash
  };
  if (entry.stateCommitId) material.stateCommitId = entry.stateCommitId;
  return material;
}

function attachStateCommit(state, eventType, auditSummary) {
  state.runtime ||= {};
  state.runtime.durability ||= {};
  const commit = {
    id: randomId('statecommit'),
    at: state.updatedAt || nowIso(),
    eventType,
    auditSummary: clone(auditSummary || {})
  };
  state.runtime.durability.lastStateCommit = commit;
  return commit;
}

function parseState(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function loadPgPool() {
  let packageJson;
  try {
    packageJson = require('pg/package.json');
  } catch (cause) {
    const error = new Error(`PostgreSQL state backend requires pg@${POSTGRES_DRIVER_VERSION}; install it in the shared Veteran runtime before selecting postgres`);
    error.code = 'POSTGRES_DRIVER_REQUIRED';
    error.details = { requiredVersion: POSTGRES_DRIVER_VERSION };
    error.cause = cause;
    throw error;
  }
  if (packageJson.version !== POSTGRES_DRIVER_VERSION) {
    const error = new Error(`PostgreSQL driver version mismatch: expected pg@${POSTGRES_DRIVER_VERSION}, found pg@${packageJson.version}`);
    error.code = 'POSTGRES_DRIVER_VERSION_MISMATCH';
    error.details = { expected: POSTGRES_DRIVER_VERSION, actual: packageJson.version };
    throw error;
  }
  const imported = await import('pg');
  const Pool = imported.Pool || imported.default?.Pool;
  if (typeof Pool !== 'function') {
    const error = new Error('Installed pg package does not expose Pool');
    error.code = 'POSTGRES_DRIVER_INVALID';
    throw error;
  }
  return Pool;
}

export class PostgresStateBackend {
  constructor({ root, connectionString, instanceKey, poolMax = 4, faultInjector = null } = {}) {
    if (!root) throw configError('PostgreSQL state backend requires an execution-local root');
    if (typeof connectionString !== 'string' || !connectionString.trim()) throw configError('PostgreSQL state backend requires a non-empty connectionString');
    if (typeof instanceKey !== 'string' || !instanceKey.trim()) throw configError('PostgreSQL state backend requires an explicit non-empty instanceKey');
    if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 32) throw configError('PostgreSQL poolMax must be an integer between 1 and 32');
    this.root = path.resolve(root);
    this.artifactsDir = path.join(this.root, 'artifacts');
    this.worktreesDir = path.join(this.root, 'worktrees');
    this.connectionString = connectionString;
    this.instanceKey = instanceKey.trim();
    this.poolMax = poolMax;
    this.faultInjector = typeof faultInjector === 'function' ? faultInjector : null;
    this.backendContract = STATE_BACKEND_CONTRACT;
    this.backendKind = 'postgres';
    this.transactionContract = STATE_BACKEND_TRANSACTION_CONTRACT;
    this.durabilityContract = STATE_BACKEND_DURABILITY_CONTRACT;
    this.pool = null;
  }

  async init() {
    await ensureDir(this.root);
    await ensureDir(this.artifactsDir);
    await ensureDir(this.worktreesDir);
    const Pool = await loadPgPool();
    this.pool ||= new Pool({ connectionString: this.connectionString, max: this.poolMax, application_name: 'veteran-engineer' });
    await this.#ensureSchema();
    await this.#bootstrap();
    await this.reconcilePendingAudit();
    await this.#reconcileStartedRequests();
    return this;
  }

  async close() {
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.end();
  }

  async read() {
    const row = await this.#readStateRow();
    return clone(this.#validateStateRow(row).state);
  }

  async readSnapshot() {
    const row = this.#validateStateRow(await this.#readStateRow());
    return { state: clone(row.state), revision: String(row.revision) };
  }

  async transaction(eventType, mutator, auditSummary = {}) {
    return this.#commitMutation({ eventType, mutator, auditSummary });
  }

  async compareAndCommit(expectedRevision, eventType, mutator, auditSummary = {}) {
    if (typeof expectedRevision !== 'string' || !expectedRevision) {
      const error = new Error('compareAndCommit requires a non-empty expected revision');
      error.code = 'STATE_REVISION_REQUIRED';
      throw error;
    }
    return this.#commitMutation({ expectedRevision, eventType, mutator, auditSummary });
  }

  async recordTimeline(event) {
    return this.transaction('runtime_timeline', (state) => {
      state.runtime.timeline.push({ ...event, at: event.at || nowIso() });
      if (state.runtime.timeline.length > 2000) state.runtime.timeline.splice(0, state.runtime.timeline.length - 2000);
    }, { type: event.type, missionId: event.missionId, taskId: event.taskId });
  }

  async verifyAudit() {
    const client = await this.#pool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rowResult = await client.query(`SELECT schema_version, revision::text AS revision, state FROM ${STATE_TABLE} WHERE instance_key = $1`, [this.instanceKey]);
      if (rowResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, entries: 0, head: null, reason: 'state-row-missing' };
      }
      const state = this.#validateStateRow(rowResult.rows[0]).state;
      const inspection = await this.#inspectAudit(client);
      await client.query('COMMIT');
      if (!inspection.ok) return inspection;
      return this.#verifyLatestStateCommit(state, inspection);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcilePendingAudit() {
    const client = await this.#pool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.#selectStateForUpdate(client);
      const state = this.#validateStateRow(row).state;
      const result = await this.#reconcileLocked(client, state);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async #ensureSchema() {
    const client = await this.#pool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
          instance_key TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          revision BIGINT NOT NULL CHECK (revision >= 1),
          state JSONB NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
          instance_key TEXT NOT NULL,
          seq BIGINT NOT NULL CHECK (seq >= 1),
          at TEXT NOT NULL,
          type TEXT NOT NULL,
          summary JSONB NOT NULL,
          prev_hash TEXT NULL,
          state_commit_id TEXT NULL,
          hash TEXT NOT NULL,
          PRIMARY KEY (instance_key, seq),
          UNIQUE (instance_key, state_commit_id)
        )
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async #bootstrap() {
    const client = await this.#pool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`veteran-engineer:${this.instanceKey}`]);
      const existing = await client.query(`SELECT schema_version, revision::text AS revision, state FROM ${STATE_TABLE} WHERE instance_key = $1 FOR UPDATE`, [this.instanceKey]);
      if (existing.rowCount === 0) {
        const state = emptyState();
        const summary = { schemaVersion: STATE_SCHEMA_VERSION };
        const commit = attachStateCommit(state, 'state_initialized', summary);
        await client.query(
          `INSERT INTO ${STATE_TABLE} (instance_key, schema_version, revision, state, updated_at) VALUES ($1, $2, 1, $3::jsonb, $4)`,
          [this.instanceKey, STATE_SCHEMA_VERSION, JSON.stringify(state), state.updatedAt]
        );
        await this.#appendAuditLocked(client, commit.eventType, commit.auditSummary, { stateCommitId: commit.id, at: commit.at });
      } else {
        this.#validateStateRow(existing.rows[0]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async #reconcileStartedRequests() {
    const client = await this.#pool().connect();
    let commit = null;
    let result = null;
    let commitAttempted = false;
    let uncertain = null;
    try {
      await client.query('BEGIN');
      const locked = this.#validateStateRow(await this.#selectStateForUpdate(client));
      await this.#reconcileLocked(client, locked.state);
      const working = clone(locked.state);
      let count = 0;
      for (const request of Object.values(working.requests || {})) {
        if (request.status === 'started') {
          request.status = 'unknown';
          request.reconciledAt = nowIso();
          count += 1;
        }
      }
      if (count === 0) {
        await client.query('COMMIT');
        return;
      }
      working.updatedAt = nowIso();
      const summary = { count };
      commit = attachStateCommit(working, 'request_outcomes_reconciled_unknown', summary);
      const nextRevision = (BigInt(locked.revision) + 1n).toString();
      await client.query(
        `UPDATE ${STATE_TABLE} SET revision = $2::bigint, state = $3::jsonb, updated_at = $4 WHERE instance_key = $1`,
        [this.instanceKey, nextRevision, JSON.stringify(working), working.updatedAt]
      );
      await this.#appendAuditLocked(client, commit.eventType, commit.auditSummary, { stateCommitId: commit.id, at: commit.at });
      commitAttempted = true;
      await client.query('COMMIT');
      await this.#injectFault('after_db_commit_before_ack', commit);
      result = true;
    } catch (error) {
      if (!commitAttempted) await client.query('ROLLBACK').catch(() => {});
      else uncertain = error;
      if (!commitAttempted) throw error;
    } finally {
      client.release();
    }
    if (uncertain) await this.#resolveCommitOutcome(commit, result, uncertain);
  }

  async #commitMutation({ expectedRevision = null, eventType, mutator, auditSummary }) {
    if (typeof eventType !== 'string' || !eventType) throw configError('State transaction requires a non-empty eventType');
    if (typeof mutator !== 'function') throw configError('State transaction requires a mutator function');
    const client = await this.#pool().connect();
    let commit = null;
    let result;
    let commitAttempted = false;
    let uncertain = null;
    try {
      await client.query('BEGIN');
      const locked = this.#validateStateRow(await this.#selectStateForUpdate(client));
      await this.#reconcileLocked(client, locked.state);
      const actualRevision = String(locked.revision);
      if (expectedRevision !== null && expectedRevision !== actualRevision) {
        throw stateRevisionConflict({ expectedRevision, actualRevision });
      }
      const working = clone(locked.state);
      result = await mutator(working);
      working.updatedAt = nowIso();
      commit = attachStateCommit(working, eventType, auditSummary);
      const nextRevision = (BigInt(actualRevision) + 1n).toString();
      const updated = await client.query(
        `UPDATE ${STATE_TABLE} SET revision = $2::bigint, state = $3::jsonb, updated_at = $4 WHERE instance_key = $1 AND revision = $5::bigint`,
        [this.instanceKey, nextRevision, JSON.stringify(working), working.updatedAt, actualRevision]
      );
      if (updated.rowCount !== 1) throw stateRevisionConflict({ expectedRevision: actualRevision, actualRevision: 'changed-during-locked-update' });
      await this.#appendAuditLocked(client, commit.eventType, commit.auditSummary, { stateCommitId: commit.id, at: commit.at });
      commitAttempted = true;
      await client.query('COMMIT');
      await this.#injectFault('after_db_commit_before_ack', commit);
    } catch (error) {
      if (!commitAttempted) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      uncertain = error;
    } finally {
      client.release();
    }
    if (uncertain) return this.#resolveCommitOutcome(commit, result, uncertain);
    return result;
  }

  async #resolveCommitOutcome(commit, result, cause) {
    try {
      const client = await this.#pool().connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const inspection = await this.#inspectAudit(client);
        if (!inspection.ok) throw auditIntegrityError(inspection);
        const matches = inspection.items.filter((entry) => entry.stateCommitId === commit.id);
        await client.query('COMMIT');
        if (matches.length === 1) {
          const entry = matches[0];
          if (entry.type !== commit.eventType || entry.at !== commit.at || stableStringify(entry.summary) !== stableStringify(commit.auditSummary)) {
            throw auditIntegrityError({ ok: false, reason: 'state-commit-audit-mismatch', stateCommitId: commit.id, entry });
          }
          return result;
        }
        if (matches.length > 1) throw auditIntegrityError({ ok: false, reason: 'state-commit-audit-duplicate', stateCommitId: commit.id });
        const error = new Error(`PostgreSQL transaction ${commit.id} was not committed`);
        error.code = 'POSTGRES_COMMIT_NOT_APPLIED';
        error.details = { stateCommitId: commit.id, causeCode: cause?.code || 'ERROR' };
        error.cause = cause;
        throw error;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (resolutionError) {
      if (['POSTGRES_COMMIT_NOT_APPLIED', 'STATE_AUDIT_INTEGRITY_FAILURE'].includes(resolutionError?.code)) throw resolutionError;
      throw commitOutcomeUnknown(commit, resolutionError || cause);
    }
  }

  async #readStateRow() {
    const result = await this.#pool().query(`SELECT schema_version, revision::text AS revision, state FROM ${STATE_TABLE} WHERE instance_key = $1`, [this.instanceKey]);
    if (result.rowCount !== 1) {
      const error = new Error(`PostgreSQL state row is missing for instance ${this.instanceKey}`);
      error.code = 'POSTGRES_STATE_MISSING';
      throw error;
    }
    return result.rows[0];
  }

  async #selectStateForUpdate(client) {
    const result = await client.query(`SELECT schema_version, revision::text AS revision, state FROM ${STATE_TABLE} WHERE instance_key = $1 FOR UPDATE`, [this.instanceKey]);
    if (result.rowCount !== 1) {
      const error = new Error(`PostgreSQL state row is missing for instance ${this.instanceKey}`);
      error.code = 'POSTGRES_STATE_MISSING';
      throw error;
    }
    return result.rows[0];
  }

  #validateStateRow(row) {
    const state = parseState(row.state);
    if (Number(row.schema_version) !== STATE_SCHEMA_VERSION || state?.schemaVersion !== STATE_SCHEMA_VERSION) {
      const error = new Error(`Unsupported state schema: ${state?.schemaVersion}`);
      error.code = 'STATE_SCHEMA_UNSUPPORTED';
      throw error;
    }
    return { revision: String(row.revision), state };
  }

  async #inspectAudit(client) {
    const result = await client.query(
      `SELECT seq::text AS seq, at, type, summary, prev_hash, state_commit_id, hash FROM ${AUDIT_TABLE} WHERE instance_key = $1 ORDER BY seq ASC`,
      [this.instanceKey]
    );
    const items = [];
    let prevHash = null;
    let expectedSeq = 0n;
    for (const row of result.rows) {
      expectedSeq += 1n;
      const seq = BigInt(row.seq);
      if (seq !== expectedSeq || row.prev_hash !== prevHash) {
        return { ok: false, entries: items.length, head: prevHash, reason: 'chain-link-mismatch' };
      }
      const entry = {
        seq: Number(seq),
        at: row.at,
        type: row.type,
        summary: row.summary,
        prevHash: row.prev_hash,
        stateCommitId: row.state_commit_id || null,
        hash: row.hash
      };
      const expected = sha256(stableStringify(auditMaterial(entry)));
      if (entry.hash !== expected) return { ok: false, entries: items.length, head: prevHash, reason: 'hash-mismatch', entry };
      prevHash = entry.hash;
      items.push(entry);
    }
    return { ok: true, entries: items.length, head: prevHash, items };
  }

  #verifyLatestStateCommit(state, inspection) {
    const commit = state.runtime?.durability?.lastStateCommit;
    if (!commit) return { ok: true, entries: inspection.entries, head: inspection.head };
    const matches = inspection.items.filter((entry) => entry.stateCommitId === commit.id);
    if (matches.length === 0) return { ok: false, entries: inspection.entries, head: inspection.head, reason: 'state-commit-audit-missing', stateCommitId: commit.id };
    if (matches.length > 1) return { ok: false, entries: inspection.entries, head: inspection.head, reason: 'state-commit-audit-duplicate', stateCommitId: commit.id };
    const entry = matches[0];
    if (entry.type !== commit.eventType || entry.at !== commit.at || stableStringify(entry.summary) !== stableStringify(commit.auditSummary)) {
      return { ok: false, entries: inspection.entries, head: inspection.head, reason: 'state-commit-audit-mismatch', stateCommitId: commit.id };
    }
    return { ok: true, entries: inspection.entries, head: inspection.head };
  }

  async #reconcileLocked(client, state) {
    const commit = state.runtime?.durability?.lastStateCommit;
    const inspection = await this.#inspectAudit(client);
    if (!inspection.ok) throw auditIntegrityError(inspection);
    if (!commit) return { ok: true, status: 'no-state-commit-marker', stateCommitId: null };
    const matches = inspection.items.filter((entry) => entry.stateCommitId === commit.id);
    if (matches.length > 1) throw auditIntegrityError({ ok: false, reason: 'state-commit-audit-duplicate', stateCommitId: commit.id });
    if (matches.length === 1) {
      const entry = matches[0];
      if (entry.type !== commit.eventType || entry.at !== commit.at || stableStringify(entry.summary) !== stableStringify(commit.auditSummary)) {
        throw auditIntegrityError({ ok: false, reason: 'state-commit-audit-mismatch', stateCommitId: commit.id, entry });
      }
      return { ok: true, status: 'already-audited', stateCommitId: commit.id, repaired: false };
    }
    await this.#appendAuditLocked(client, commit.eventType, commit.auditSummary, { stateCommitId: commit.id, at: commit.at });
    return { ok: true, status: 'audit-repaired', stateCommitId: commit.id, repaired: true };
  }

  async #appendAuditLocked(client, type, summary, { stateCommitId = null, at = nowIso() } = {}) {
    const inspection = await this.#inspectAudit(client);
    if (!inspection.ok) throw auditIntegrityError(inspection);
    const seq = BigInt(inspection.entries) + 1n;
    const base = {
      seq: Number(seq),
      at,
      type,
      summary: clone(summary || {}),
      prevHash: inspection.head
    };
    if (stateCommitId) base.stateCommitId = stateCommitId;
    const hash = sha256(stableStringify(base));
    await client.query(
      `INSERT INTO ${AUDIT_TABLE} (instance_key, seq, at, type, summary, prev_hash, state_commit_id, hash) VALUES ($1, $2::bigint, $3, $4, $5::jsonb, $6, $7, $8)`,
      [this.instanceKey, seq.toString(), at, type, JSON.stringify(summary || {}), inspection.head, stateCommitId, hash]
    );
  }

  async #injectFault(stage, commit) {
    if (this.faultInjector) await this.faultInjector(stage, clone(commit));
  }

  #pool() {
    if (!this.pool) {
      const error = new Error('PostgreSQL state backend is not initialized');
      error.code = 'POSTGRES_STATE_BACKEND_NOT_INITIALIZED';
      throw error;
    }
    return this.pool;
  }
}
