import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.mjs';
import { nowIso, randomId, sha256, stableStringify } from './util.mjs';
import {
  startValidationService,
  stopValidationService,
  waitForValidationReadiness
} from './product-validation-runner.mjs';

const DEFAULT_IDLE_MS = 5 * 60_000;
const MAX_IDLE_MS = 30 * 60_000;
const MAX_LIVE_SESSIONS = 16;
const SESSION_ADMISSION_KEY = 'live-session-admission';

function boundedIdleMs(value) {
  if (!Number.isInteger(value)) return DEFAULT_IDLE_MS;
  return Math.max(1_000, Math.min(MAX_IDLE_MS, value));
}

function sessionPolicy(project) {
  const raw = project?.runtimeFeedbackPolicy || {};
  return {
    enabled: raw.liveSession === true,
    idleMs: boundedIdleMs(raw.liveSessionIdleMs)
  };
}

function sessionKey(projectId, missionId, capability) {
  return `${projectId}:${missionId}:${capability}`;
}

function serviceFingerprint(service) {
  return sha256(stableStringify(service));
}

function readinessEndpoint(service) {
  const url = new URL(service.readiness.url);
  const port = url.port || '80';
  return {
    leaseKey: `loopback-http:${port}`,
    origin: url.origin,
    port
  };
}

function worktreeNameFor(key) {
  return `live-validation-${sha256(key).slice(0, 24)}`;
}

function within(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function resolveContainedCwd(root, relativeCwd) {
  const candidate = path.resolve(root, relativeCwd || '.');
  const realRoot = await fs.realpath(root);
  const realCandidate = await fs.realpath(candidate).catch(() => candidate);
  if (!within(realRoot, realCandidate)) {
    throw Object.assign(new Error('Live validation service cwd escapes its runtime-owned worktree'), {
      code: 'LIVE_VALIDATION_CWD_ESCAPE'
    });
  }
  return candidate;
}

function sessionSummary(session, extra = {}) {
  return {
    mode: 'persistent-live',
    sessionId: session.id,
    generation: session.generation,
    sourceHead: session.commitSha,
    worktreeName: session.worktreeName,
    readinessOrigin: session.endpointOrigin,
    startedAt: session.startedAt,
    lastUsedAt: session.lastUsedAt,
    ...extra
  };
}

export class LiveValidationSessionManager {
  constructor({ store, maxSessions = MAX_LIVE_SESSIONS } = {}) {
    if (!store) throw new Error('LiveValidationSessionManager requires a state store');
    this.store = store;
    this.maxSessions = Math.max(1, Math.min(MAX_LIVE_SESSIONS, Number(maxSessions) || MAX_LIVE_SESSIONS));
    this.sessions = new Map();
    this.startingSessionKeys = new Set();
    this.locks = new Map();
    this.sessionAdmissionLocks = new Map();
    this.endpointLeases = new Map();
    this.endpointLocks = new Map();
  }

  support({ project, service }) {
    const policy = sessionPolicy(project);
    if (!policy.enabled) return { enabled: false, reason: 'live-session-disabled', idleMs: policy.idleMs };
    if (!service) return { enabled: false, reason: 'validation-service-required', idleMs: policy.idleMs };
    if (this.store.backendKind === 'postgres') {
      return { enabled: false, reason: 'hosted-backend-requires-session-lease', idleMs: policy.idleMs };
    }
    return { enabled: true, reason: null, idleMs: policy.idleMs };
  }

  snapshot() {
    return [...this.sessions.values()].map((session) => {
      const status = session.serviceRun.status();
      return {
        id: session.id,
        projectId: session.projectId,
        missionId: session.missionId,
        capability: session.capability,
        worktreeName: session.worktreeName,
        commitSha: session.commitSha,
        generation: session.generation,
        readinessOrigin: session.endpointOrigin,
        startedAt: session.startedAt,
        lastUsedAt: session.lastUsedAt,
        running: status.running,
        treeRunning: status.treeRunning
      };
    });
  }

  async acquire({ project, mission, capability, commitSha, service }) {
    const support = this.support({ project, service });
    if (!support.enabled) return { enabled: false, ...support };
    const key = sessionKey(project.id, mission.id, capability);
    return this.#withLock(this.locks, key, async () => {
      let session = this.sessions.get(key) || null;
      let reused = Boolean(session);
      let restarted = false;
      let restartReason = null;
      let sourceChanged = false;

      if (session) {
        this.#clearIdle(session);
        const status = session.serviceRun.status();
        if (session.serviceFingerprint !== serviceFingerprint(service)) {
          restartReason = 'service-configuration-changed';
        } else if (!status.running || !status.treeRunning) {
          restartReason = 'service-not-running';
        }
        if (restartReason) {
          await this.#releaseSession(session, restartReason);
          session = null;
          reused = false;
          restarted = true;
        }
      }

      if (!session) {
        session = await this.#startSession({ project, mission, capability, commitSha, service, idleMs: support.idleMs });
      } else if (session.commitSha !== commitSha) {
        const moved = await this.#moveSessionSource(session, commitSha);
        if (!moved.ok) {
          await this.#releaseSession(session, 'source-transition-failed');
          session = await this.#startSession({ project, mission, capability, commitSha, service, idleMs: support.idleMs });
          reused = false;
          restarted = true;
          restartReason = 'source-transition-failed';
        } else {
          sourceChanged = true;
        }
      }

      let readiness;
      try {
        readiness = await waitForValidationReadiness(session.serviceRun, service.readiness);
      } catch (error) {
        await this.#releaseSession(session, 'readiness-error');
        throw error;
      }
      if (!readiness.ready && reused) {
        await this.#releaseSession(session, 'reuse-readiness-failed');
        session = await this.#startSession({ project, mission, capability, commitSha, service, idleMs: support.idleMs });
        try {
          readiness = await waitForValidationReadiness(session.serviceRun, service.readiness);
        } catch (error) {
          await this.#releaseSession(session, 'restart-readiness-error');
          throw error;
        }
        reused = false;
        restarted = true;
        restartReason = 'reuse-readiness-failed';
      }

      session.lastUsedAt = nowIso();
      if (reused) session.reuseCount += 1;
      return {
        enabled: true,
        active: readiness.ready === true && session.serviceRun.status().running,
        worktreePath: session.worktreePath,
        serviceRun: session.serviceRun,
        readiness,
        sessionId: session.id,
        summary: sessionSummary(session, {
          reused,
          restarted,
          restartReason,
          sourceChanged,
          idleMs: session.idleMs
        })
      };
    });
  }

  async checkSource({ sessionId, expectedHead }) {
    const session = [...this.sessions.values()].find((item) => item.id === sessionId) || null;
    if (!session) return { ok: false, reason: 'session-not-found', head: null, trackedDirty: null };
    const head = (await git(session.worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true })).stdout.trim() || null;
    const status = await git(session.worktreePath, ['status', '--porcelain', '--untracked-files=no'], { allowFailure: true });
    const trackedDirty = status.code !== 0 || Boolean(status.stdout.trim());
    return {
      ok: head === expectedHead && !trackedDirty,
      reason: head !== expectedHead ? 'head-mismatch' : (trackedDirty ? 'tracked-source-dirty' : null),
      head,
      trackedDirty
    };
  }

  async finish({ sessionId, keepAlive = true, reason = null } = {}) {
    const session = [...this.sessions.values()].find((item) => item.id === sessionId) || null;
    if (!session) return { released: false, reason: 'session-not-found' };
    const status = session.serviceRun.status();
    if (!keepAlive || !status.running || !status.treeRunning) {
      const cleanup = await this.#withLock(this.locks, session.key, () => this.#releaseSession(session, reason || 'session-not-healthy'));
      return { released: true, cleanup };
    }
    session.lastUsedAt = nowIso();
    this.#scheduleIdle(session);
    return { released: false, reason: null, summary: sessionSummary(session) };
  }

  async releaseMission({ missionId, reason = 'mission-finished' } = {}) {
    const targets = [...this.sessions.values()].filter((session) => session.missionId === missionId);
    const released = [];
    for (const session of targets) {
      const cleanup = await this.#withLock(this.locks, session.key, () => this.#releaseSession(session, reason));
      released.push({ sessionId: session.id, worktreeName: session.worktreeName, cleanup });
    }
    return released;
  }

  async releaseAll({ reason = 'runtime-cleanup' } = {}) {
    const targets = [...this.sessions.values()];
    const released = [];
    for (const session of targets) {
      const cleanup = await this.#withLock(this.locks, session.key, () => this.#releaseSession(session, reason));
      released.push({ sessionId: session.id, worktreeName: session.worktreeName, cleanup });
    }
    return released;
  }

  async #reserveSessionSlot(key) {
    return this.#withLock(this.sessionAdmissionLocks, SESSION_ADMISSION_KEY, async () => {
      const activeSessions = this.sessions.size;
      const startingSessions = this.startingSessionKeys.size;
      if (activeSessions + startingSessions >= this.maxSessions) {
        throw Object.assign(new Error(`Persistent live validation session limit reached (${this.maxSessions})`), {
          code: 'LIVE_VALIDATION_SESSION_LIMIT_REACHED',
          details: { maxSessions: this.maxSessions, activeSessions, startingSessions }
        });
      }
      this.startingSessionKeys.add(key);
    });
  }

  async #promoteSessionSlot(key, session) {
    return this.#withLock(this.sessionAdmissionLocks, SESSION_ADMISSION_KEY, async () => {
      if (!this.startingSessionKeys.has(key)) {
        throw Object.assign(new Error('Persistent live validation session admission reservation was lost'), {
          code: 'LIVE_VALIDATION_SESSION_ADMISSION_LOST'
        });
      }
      this.startingSessionKeys.delete(key);
      this.sessions.set(key, session);
    });
  }

  async #releaseSessionSlot(key, sessionId = null) {
    return this.#withLock(this.sessionAdmissionLocks, SESSION_ADMISSION_KEY, async () => {
      this.startingSessionKeys.delete(key);
      const active = this.sessions.get(key) || null;
      if (active && (!sessionId || active.id === sessionId)) this.sessions.delete(key);
    });
  }

  async #startSession({ project, mission, capability, commitSha, service, idleMs }) {
    const key = sessionKey(project.id, mission.id, capability);
    const endpoint = readinessEndpoint(service);
    await this.#reserveSessionSlot(key);
    let promoted = false;
    try {
      const session = await this.#withLock(this.endpointLocks, endpoint.leaseKey, async () => {
        const existingLease = this.endpointLeases.get(endpoint.leaseKey) || null;
        if (existingLease && existingLease.key !== key) {
          throw Object.assign(new Error(`Persistent live validation endpoint ${endpoint.origin} is already owned by another session`), {
            code: 'LIVE_VALIDATION_ENDPOINT_IN_USE',
            details: {
              readinessOrigin: endpoint.origin,
              port: endpoint.port,
              ownerMissionId: existingLease.missionId,
              ownerCapability: existingLease.capability,
              ownerSessionId: existingLease.sessionId || null
            }
          });
        }

        const sessionId = randomId('livesession');
        const reservation = {
          key,
          missionId: mission.id,
          capability,
          sessionId,
          readinessOrigin: endpoint.origin
        };
        this.endpointLeases.set(endpoint.leaseKey, reservation);

        const worktreeName = worktreeNameFor(key);
        const worktreePath = path.join(this.store.worktreesDir, worktreeName);
        let serviceRun = null;
        try {
          await git(project.repoPath, ['worktree', 'remove', '--force', worktreePath], { allowFailure: true });
          await fs.rm(worktreePath, { recursive: true, force: true });
          await git(project.repoPath, ['worktree', 'prune', '--expire', 'now'], { allowFailure: true });
          await git(project.repoPath, ['worktree', 'add', '--detach', worktreePath, commitSha]);
          const serviceCwd = await resolveContainedCwd(worktreePath, service.cwd);
          serviceRun = startValidationService(service, { cwd: serviceCwd });
          const session = {
            id: sessionId,
            key,
            projectId: project.id,
            missionId: mission.id,
            capability,
            projectRepoPath: project.repoPath,
            worktreeName,
            worktreePath,
            commitSha,
            generation: 1,
            reuseCount: 0,
            serviceFingerprint: serviceFingerprint(service),
            service,
            serviceRun,
            endpointLeaseKey: endpoint.leaseKey,
            endpointOrigin: endpoint.origin,
            idleMs,
            idleTimer: null,
            startedAt: nowIso(),
            lastUsedAt: nowIso()
          };
          await this.#promoteSessionSlot(key, session);
          promoted = true;
          return session;
        } catch (error) {
          if (serviceRun) await stopValidationService(serviceRun, service.shutdownGraceMs).catch(() => {});
          await git(project.repoPath, ['worktree', 'remove', '--force', worktreePath], { allowFailure: true });
          await fs.rm(worktreePath, { recursive: true, force: true });
          await git(project.repoPath, ['worktree', 'prune', '--expire', 'now'], { allowFailure: true });
          const lease = this.endpointLeases.get(endpoint.leaseKey);
          if (lease?.sessionId === sessionId) this.endpointLeases.delete(endpoint.leaseKey);
          throw error;
        }
      });
      return session;
    } finally {
      if (!promoted) await this.#releaseSessionSlot(key);
    }
  }

  async #moveSessionSource(session, commitSha) {
    const checkout = await git(session.worktreePath, ['checkout', '--detach', '--force', commitSha], { allowFailure: true });
    if (checkout.code !== 0) return { ok: false, code: checkout.code };
    const head = (await git(session.worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true })).stdout.trim();
    if (head !== commitSha) return { ok: false, code: 'head-mismatch' };
    session.commitSha = commitSha;
    session.generation += 1;
    session.lastUsedAt = nowIso();
    return { ok: true };
  }

  #scheduleIdle(session) {
    this.#clearIdle(session);
    session.idleTimer = setTimeout(() => {
      this.#withLock(this.locks, session.key, () => this.#releaseSession(session, 'idle-timeout')).catch(() => {});
    }, session.idleMs);
    session.idleTimer.unref?.();
  }

  #clearIdle(session) {
    if (!session?.idleTimer) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  async #releaseSession(session, reason) {
    if (!session || this.sessions.get(session.key)?.id !== session.id) {
      return { stopped: false, removedWorktree: false, reason: 'session-already-released' };
    }
    this.#clearIdle(session);
    const cleanup = await stopValidationService(session.serviceRun, session.service.shutdownGraceMs);
    await git(session.projectRepoPath, ['worktree', 'remove', '--force', session.worktreePath], { allowFailure: true });
    await fs.rm(session.worktreePath, { recursive: true, force: true });
    await git(session.projectRepoPath, ['worktree', 'prune', '--expire', 'now'], { allowFailure: true });
    await this.#releaseSessionSlot(session.key, session.id);
    await this.#withLock(this.endpointLocks, session.endpointLeaseKey, async () => {
      const lease = this.endpointLeases.get(session.endpointLeaseKey);
      if (lease?.sessionId === session.id) this.endpointLeases.delete(session.endpointLeaseKey);
    });
    return { stopped: true, removedWorktree: true, reason, process: cleanup };
  }

  async #withLock(lockMap, key, operation) {
    const prior = lockMap.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    lockMap.set(key, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (lockMap.get(key) === tail) lockMap.delete(key);
    }
  }
}
