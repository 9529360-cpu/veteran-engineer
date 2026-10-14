/**
 * Evidence-bound adaptive Worker selection.
 * Only real, supervised runtime dispatches with durable Worker evidence may
 * affect ranking. This is integration reliability, NOT code-quality judgment.
 * A named task Worker and high/critical-risk routing are never overridden.
 */
import { runtimeManagedExecutionReadiness } from './worker-capability-profile.mjs';

export const WORKER_SELECTION_CONTRACT = 'veteran-worker-selection-v1';
const NEUTRAL_FAILURES = new Set([
  'WORKER_CANCELLED', 'MISSION_CANCELLED', 'WORKER_SUPERVISOR_LOST',
  'WORKER_RECONCILIATION_REQUIRED', 'WORKER_TIMEOUT', 'TASK_INTEGRATION_FAILED'
]);
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function preferredWorker(policy) {
  if (typeof policy.defaultWorker === 'string' && policy.defaultWorker.trim()) return policy.defaultWorker;
  if (policy.worker || policy.workers?.default) return 'default';
  if (policy.nativeAgent) return 'native';
  return 'default';
}

function allowedWorkerNames(policy) {
  const configured = new Set(Object.keys(policy.workers || {}));
  if (policy.worker) configured.add('default');
  if (policy.nativeAgent?.model && policy.nativeAgent?.baseURL) configured.add('native');
  const preferred = preferredWorker(policy);
  // An operator-selected default is explicitly authorized; Codex is never
  // discovered or selected just because its CLI exists on the computer.
  configured.add(preferred);
  const allowlist = policy.adaptiveSelection?.candidates;
  // Codex may be selected only if an operator explicitly names its preset.
  if (Array.isArray(allowlist) && allowlist.includes('codex')) configured.add('codex');
  const names = Array.isArray(allowlist) ? allowlist : [...configured];
  return [...new Set(names)]
    .filter((name) => typeof name === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(name) && !RESERVED_NAMES.has(name))
    .filter((name) => configured.has(name));
}

function verifiedOutcome(dispatch, state) {
  if (dispatch?.runWorkers !== true || dispatch.workerSpawnConfirmed !== true
    || !dispatch.workerKey || !dispatch.evidenceId || !state.evidence?.[dispatch.evidenceId]
    || !dispatch.endedAt) return null;
  if (dispatch.status === 'integrated' && dispatch.integrationSha) return 'integrated';
  if (dispatch.status === 'failed' && dispatch.error?.code && !NEUTRAL_FAILURES.has(dispatch.error.code)) {
    return 'failed';
  }
  return null;
}

function observations({ state, projectId, owner = null }) {
  const events = [];
  for (const task of Object.values(state?.tasks || {})) {
    if (task.projectId !== projectId) continue;
    for (const dispatch of task.dispatches || []) {
      const outcome = verifiedOutcome(dispatch, state);
      if (!outcome) continue;
      events.push({
        worker: dispatch.workerKey,
        owner: task.owner,
        outcome,
        evidenceId: dispatch.evidenceId,
        durationMs: Number.isFinite(dispatch.durationMs) && dispatch.durationMs >= 0 ? dispatch.durationMs : null
      });
    }
  }
  const local = owner ? events.filter((event) => event.owner === owner) : events;
  return { events: local.length ? local : events, scope: local.length || !owner ? 'task-owner' : 'project-fallback' };
}

export function workerPerformanceSnapshot({ state, projectId, owner = null, candidates = [] } = {}) {
  const { events, scope } = observations({ state, projectId, owner });
  const names = [...new Set(candidates)];
  const workers = names.map((worker) => {
    const runs = events.filter((event) => event.worker === worker);
    const integrated = runs.filter((event) => event.outcome === 'integrated').length;
    const failed = runs.length - integrated;
    const durations = runs.map((event) => event.durationMs).filter((value) => value !== null).sort((a, b) => a - b);
    return {
      worker,
      samples: runs.length,
      integrated,
      failed,
      estimatedIntegrationRate: (integrated + 1) / (runs.length + 2),
      medianDurationMs: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null,
      evidenceIds: [...new Set(runs.map((event) => event.evidenceId))].slice(-4)
    };
  });
  return {
    contract: WORKER_SELECTION_CONTRACT,
    projectId,
    owner,
    evidenceScope: scope,
    workers,
    note: 'Counts only confirmed independent Workers and evidence-backed task integration/failure; cancellations, uncertain launches and unverified outcomes are not scored. Integration is not final validation.'
  };
}

export function selectWorkerForTask({ state, project, task } = {}) {
  const policy = project?.workerPolicy || {};
  const requested = task?.worker || 'default';
  const preferred = preferredWorker(policy);
  const fixed = (reason) => ({ contract: WORKER_SELECTION_CONTRACT, worker: requested, preferred, mode: reason, observations: [] });
  if (requested !== 'default') return fixed('explicit-task-worker');
  if (policy.enabled !== true || policy.adaptiveSelection?.enabled !== true) return fixed('operator-default');
  if (task.risk === 'high' || task.risk === 'critical') return fixed('risk-preserves-default');

  const eligible = allowedWorkerNames(policy).filter((worker) => {
    const proposed = { ...task, worker };
    const readiness = runtimeManagedExecutionReadiness(proposed, project);
    return readiness.profile.policyValid && readiness.ready;
  });
  if (!eligible.length) return fixed('no-eligible-authorized-workers');

  const snapshot = workerPerformanceSnapshot({
    state, projectId: project.id, owner: task.owner, candidates: eligible
  });
  const total = snapshot.workers.reduce((count, item) => count + item.samples, 0);
  if (total === 0) {
    return {
      contract: WORKER_SELECTION_CONTRACT,
      worker: eligible.includes(preferred) ? preferred : eligible.slice().sort()[0],
      preferred,
      mode: 'cold-start',
      evidenceScope: snapshot.evidenceScope,
      observations: snapshot.workers
    };
  }
  const ranked = snapshot.workers.map((item) => ({
    ...item,
    score: item.estimatedIntegrationRate
      + 0.24 * Math.sqrt(Math.log(total + 2) / (item.samples + 1))
  })).sort((a, b) => b.score - a.score
    || Number(b.worker === preferred) - Number(a.worker === preferred)
    || a.worker.localeCompare(b.worker));
  return {
    contract: WORKER_SELECTION_CONTRACT,
    worker: ranked[0].worker,
    preferred,
    mode: 'evidence-ranking',
    evidenceScope: snapshot.evidenceScope,
    observations: ranked.map((item) => ({
      worker: item.worker,
      samples: item.samples,
      integrated: item.integrated,
      failed: item.failed,
      score: Number(item.score.toFixed(5)),
      evidenceIds: item.evidenceIds
    }))
  };
}
