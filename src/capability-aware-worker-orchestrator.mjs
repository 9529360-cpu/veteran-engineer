import { sourceIdentity } from './git.mjs';
import { nowIso, randomId } from './util.mjs';
import {
  activeRuntimeResourceConflicts,
  bindRuntimeResources,
  buildCapabilitySnapshot,
  runtimeResourceConflicts,
  taskCapabilityReadiness,
  taskRuntimeContext
} from './capability-plane.mjs';

const ACTIVE_EXECUTION_STATUSES = new Set(['admitted', 'executing', 'cancelling', 'interrupted']);
const OUTSTANDING_LEASE_STATUSES = new Set(['admitted', 'dispatched', 'executing', 'cancelling', 'interrupted']);
const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled', 'blocked', 'superseded']);

function readyWaveTasks(state, mission) {
  const waveIds = mission.waves?.[mission.nextWaveIndex] || [];
  const missionTasks = Object.values(state.tasks).filter((task) => task.missionId === mission.id);
  const byId = new Map(missionTasks.map((task) => [task.id, task]));
  return waveIds
    .map((id) => byId.get(id))
    .filter((task) => task?.status === 'planned')
    .filter((task) => task.dependencies.every((dep) => byId.get(dep)?.status === 'done'));
}

function predictedAdmission(state, mission, project, runWorkers) {
  const ready = readyWaveTasks(state, mission);
  const maxWorkers = Math.max(1, Number(project.workerPolicy?.maxWorkers || 2));
  const globalActive = runWorkers
    ? Object.values(state.tasks).filter((task) => ACTIVE_EXECUTION_STATUSES.has(task.status)).length
    : 0;
  const capacity = runWorkers ? Math.max(0, maxWorkers - globalActive) : maxWorkers;
  return { ready, capacity, selected: ready.slice(0, capacity) };
}

function sameReservationConflicts(tasks, mission, project) {
  const conflicts = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const left = tasks[i];
      const right = tasks[j];
      const resources = runtimeResourceConflicts(
        left.runtimeResources || [],
        right.runtimeResources || [],
        taskRuntimeContext(left, mission, project),
        taskRuntimeContext(right, mission, project)
      );
      if (resources.length) conflicts.push({ taskId: right.id, conflictingTaskId: left.id, resources });
    }
  }
  return conflicts;
}

export class CapabilityAwareWorkerOrchestrator {
  constructor({ delegate, store, projectService, missionService }) {
    this.delegate = delegate;
    this.store = store;
    this.projectService = projectService;
    this.missionService = missionService;
  }

  async #snapshot(missionId) {
    const { mission, tasks } = await this.missionService.status({ missionId });
    const project = await this.projectService.get(mission.projectId);
    const live = await sourceIdentity(project.repoPath);
    const state = await this.store.read();
    return buildCapabilitySnapshot({ project, mission, tasks, liveSourceIdentity: live, state });
  }

  async #reserve({ missionId, runWorkers }) {
    const reservationId = randomId('capability');
    return this.store.transaction('capability_execution_reserved', (state) => {
      const mission = state.missions[missionId];
      if (!mission || mission.phase !== 'execution') {
        return { id: reservationId, missionId, taskIds: [], blocked: [], reason: 'mission-not-executing' };
      }
      const project = state.projects[mission.projectId];
      if (!project) throw Object.assign(new Error(`Unknown project: ${mission.projectId}`), { code: 'PROJECT_NOT_FOUND' });

      for (const task of Object.values(state.tasks)) {
        if (task.capabilityLease && TERMINAL_TASK_STATUSES.has(task.status)) task.capabilityLease = null;
      }

      const admission = predictedAdmission(state, mission, project, runWorkers);
      if (!admission.selected.length) {
        return {
          id: reservationId,
          missionId,
          taskIds: [],
          blocked: [],
          reason: admission.capacity === 0 ? 'global-worker-admission-full' : 'no-ready-planned-tasks'
        };
      }

      const blocked = [];
      for (const task of admission.selected) {
        const readiness = taskCapabilityReadiness(task, project);
        if (!readiness.ready) {
          blocked.push({
            taskId: task.id,
            reason: 'capability-missing',
            missingSensing: readiness.missingSensing,
            missingExecution: readiness.missingExecution
          });
          continue;
        }
        const conflicts = activeRuntimeResourceConflicts({ state, task, mission, project });
        if (conflicts.length) blocked.push({ taskId: task.id, reason: 'runtime-resource-conflict', conflicts });
      }
      blocked.push(...sameReservationConflicts(admission.selected, mission, project).map((entry) => ({
        ...entry,
        reason: 'same-admission-resource-conflict'
      })));

      if (blocked.length) {
        state.runtime.timeline.push({ type: 'capability_execution_blocked', missionId, taskIds: admission.selected.map((task) => task.id), blocked, at: nowIso() });
        return { id: reservationId, missionId, taskIds: [], blocked, reason: 'capability-preflight-blocked' };
      }

      const leases = admission.selected.map((task) => {
        const lease = {
          id: randomId('lease'),
          reservationId,
          missionId,
          projectId: mission.projectId,
          taskId: task.id,
          resources: bindRuntimeResources(task.runtimeResources || [], taskRuntimeContext(task, mission, project)),
          sensingCapabilities: task.sensingCapabilities || [],
          executionCapabilities: task.executionCapabilities || [],
          runWorkers: runWorkers === true,
          reservedAt: nowIso()
        };
        task.capabilityLease = lease;
        task.updatedAt = nowIso();
        return lease;
      });
      state.runtime.timeline.push({ type: 'capability_execution_reserved', missionId, reservationId, taskIds: admission.selected.map((task) => task.id), at: nowIso() });
      return { id: reservationId, missionId, taskIds: admission.selected.map((task) => task.id), leases, blocked: [], reason: null };
    }, { missionId, runWorkers, reservationId });
  }

  async #release(reservation, reason, keepTaskIds = []) {
    if (!reservation?.taskIds?.length) return { released: [] };
    const keep = new Set(keepTaskIds);
    return this.store.transaction('capability_execution_released', (state) => {
      const released = [];
      for (const taskId of reservation.taskIds) {
        if (keep.has(taskId)) continue;
        const task = state.tasks[`${reservation.missionId}:${taskId}`];
        if (!task?.capabilityLease || task.capabilityLease.reservationId !== reservation.id) continue;
        task.capabilityLease = null;
        task.updatedAt = nowIso();
        released.push(taskId);
      }
      if (released.length) state.runtime.timeline.push({ type: 'capability_execution_released', missionId: reservation.missionId, reservationId: reservation.id, taskIds: released, reason, at: nowIso() });
      return { released };
    }, { missionId: reservation.missionId, reservationId: reservation.id, reason });
  }

  async #reconcileReservation(reservation, reason) {
    if (!reservation?.taskIds?.length) return { released: [], retained: [] };
    const state = await this.store.read();
    const retained = reservation.taskIds.filter((taskId) => {
      const task = state.tasks[`${reservation.missionId}:${taskId}`];
      return task?.capabilityLease?.reservationId === reservation.id && OUTSTANDING_LEASE_STATUSES.has(task.status);
    });
    const released = await this.#release(reservation, reason, retained);
    return { released: released.released, retained };
  }

  async #releaseTask(missionId, taskId, reason) {
    return this.store.transaction('capability_task_released', (state) => {
      const task = state.tasks[`${missionId}:${taskId}`];
      if (!task?.capabilityLease) return { released: false };
      const leaseId = task.capabilityLease.id;
      task.capabilityLease = null;
      task.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'capability_task_released', missionId, taskId, leaseId, reason, at: nowIso() });
      return { released: true, leaseId };
    }, { missionId, taskId, reason });
  }

  async execute(args) {
    const runWorkers = args.runWorkers === true;
    const snapshot = await this.#snapshot(args.missionId);
    const reservation = await this.#reserve({ missionId: args.missionId, runWorkers });
    if (reservation.reason === 'capability-preflight-blocked') {
      return {
        missionId: args.missionId,
        reason: reservation.reason,
        blocked: reservation.blocked,
        capabilitySnapshot: snapshot
      };
    }
    if (!reservation.taskIds.length) {
      const result = await this.delegate.execute(args);
      return { ...result, capabilitySnapshot: snapshot };
    }

    let result;
    try {
      result = await this.delegate.execute(args);
    } catch (error) {
      await this.#reconcileReservation(reservation, 'delegate-threw').catch(() => {});
      throw error;
    }

    await this.#reconcileReservation(reservation, 'delegate-returned');
    return { ...result, capabilitySnapshot: snapshot };
  }

  async commitExternalTaskResult(args) {
    try {
      return await this.delegate.commitExternalTaskResult(args);
    } finally {
      await this.#releaseTask(args.missionId, args.taskId, 'external-task-result-finished').catch(() => {});
    }
  }

  cancelWorker(args) {
    return this.delegate.cancelWorker(args);
  }

  async resumeWorker(args) {
    try {
      return await this.delegate.resumeWorker(args);
    } finally {
      await this.#releaseTask(args.missionId, args.taskId, 'worker-resume-finished').catch(() => {});
    }
  }

  async retryWorker(args) {
    const result = await this.delegate.retryWorker(args);
    await this.#releaseTask(args.missionId, args.taskId, 'worker-retry-scheduled');
    return result;
  }
}
