import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPathsWithinScope, changedPaths, git, sourceIdentity } from './git.mjs';
import { MissionService } from './mission-service.mjs';
import { nowIso, randomId } from './util.mjs';
import { resolveWorkerConfig } from './worker-adapter.mjs';
import { ProjectBootstrapExecutor, normalizeBootstrapAuthorization } from './bootstrap-executor.mjs';

function packetFor(project, mission, task, waveBase, experience = { items: [], precedence: 'Current repository/runtime evidence outranks project experience.' }) {
  return {
    protocol: 'veteran-worker-v1',
    project: { id: project.id, repoPath: project.repoPath },
    mission: { id: mission.id, goal: mission.goal, doneDefinition: mission.doneDefinition, baseHead: mission.baseSourceIdentity.head },
    task: {
      id: task.id,
      contract: task.contract,
      owner: task.owner,
      dependencies: task.dependencies,
      writeSet: task.writeSet,
      protectedPaths: task.protectedPaths,
      risk: task.risk,
      validationCapability: task.validationCapability
    },
    waveBase,
    projectExperience: experience.items || [],
    experiencePrecedence: experience.precedence || 'Current repository/runtime evidence outranks project experience.',
    returnContract: ['files changed', 'behavior changed', 'tests/evidence', 'unresolved risks', 'discoveries that invalidate plan'],
    stopConditions: ['write outside declared scope', 'mission-level semantic ambiguity', 'release/production action required', 'security-policy change required']
  };
}

export class WorkerOrchestrator {
  constructor({ store, projectService, missionService, worktreeManager, workerAdapter, evidenceService, experienceService = null, bootstrapExecutor = null }) {
    this.store = store;
    this.projectService = projectService;
    this.missionService = missionService;
    this.worktreeManager = worktreeManager;
    this.workerAdapter = workerAdapter;
    this.evidenceService = evidenceService;
    this.experienceService = experienceService;
    this.bootstrapExecutor = bootstrapExecutor || new ProjectBootstrapExecutor();
  }

  async execute({ missionId, runWorkers = false, bootstrapAuthorization = null }) {
    const normalizedBootstrapAuthorization = normalizeBootstrapAuthorization(bootstrapAuthorization);
    if (normalizedBootstrapAuthorization && !runWorkers) {
      throw Object.assign(new Error('Bootstrap execution is only supported when mission_execute runs workers'), { code: 'BOOTSTRAP_EXECUTION_REQUIRES_RUN_WORKERS' });
    }
    const { mission, tasks } = await this.missionService.status({ missionId });
    if (mission.status === 'cancelled') throw Object.assign(new Error('Mission is cancelled'), { code: 'MISSION_CANCELLED' });
    if (mission.phase !== 'execution') return { missionId, phase: mission.phase, message: 'Execution phase already complete' };
    let project = await this.projectService.get(mission.projectId);
    const live = await sourceIdentity(project.repoPath);
    if (live.dirty) throw Object.assign(new Error('Dirty source checkout blocks first dispatch/execution'), { code: 'DIRTY_SOURCE_BLOCKED', details: live.dirtyPaths });
    if (mission.nextWaveIndex === 0 && live.head !== mission.baseSourceIdentity.head) {
      throw Object.assign(new Error('Mission base is stale before first dispatch'), { code: 'MISSION_BASE_STALE', details: { planned: mission.baseSourceIdentity.head, live: live.head } });
    }
    if (normalizedBootstrapAuthorization) {
      project = await this.projectService.snapshot({ projectId: project.id });
      if (project.sourceIdentity.dirty || project.sourceIdentity.head !== live.head) {
        throw Object.assign(new Error('Project environment snapshot changed source identity before bootstrap execution'), { code: 'BOOTSTRAP_SOURCE_IDENTITY_STALE', details: { expectedHead: live.head, actualHead: project.sourceIdentity.head, dirty: project.sourceIdentity.dirty } });
      }
    }
    const waveIds = mission.waves[mission.nextWaveIndex] || [];
    if (!waveIds.length) {
      await this.store.transaction('mission_execution_complete', (state) => {
        const target = state.missions[missionId];
        target.phase = 'validation';
        target.status = 'ready';
        target.updatedAt = nowIso();
        state.runtime.timeline.push({ type: 'mission_execution_complete', missionId, at: nowIso() });
      }, { missionId });
      return { missionId, phase: 'validation', completed: true };
    }
    const waveTasks = tasks.filter((task) => waveIds.includes(task.id));
    const outstanding = waveTasks.filter((task) => ['admitted', 'dispatched', 'executing', 'cancelling', 'interrupted'].includes(task.status));
    if (outstanding.length) {
      return {
        missionId,
        waveIndex: mission.nextWaveIndex,
        reason: 'wave-has-outstanding-dispatches',
        pending: outstanding.map((task) => ({ taskId: task.id, status: task.status, dispatchId: task.dispatches.at(-1)?.id || null }))
      };
    }
    const retryRequired = waveTasks.filter((task) => ['failed', 'cancelled'].includes(task.status));
    if (retryRequired.length) {
      return {
        missionId,
        waveIndex: mission.nextWaveIndex,
        reason: 'wave-has-tasks-requiring-retry',
        tasks: retryRequired.map((task) => ({ taskId: task.id, status: task.status }))
      };
    }
    const currentTasks = waveTasks.filter((task) => task.status === 'planned');
    if (!currentTasks.length && waveTasks.every((task) => task.status === 'done')) {
      const advanced = await this.#advanceWaveIfComplete(missionId, mission.nextWaveIndex);
      return { missionId, waveIndex: mission.nextWaveIndex, completed: advanced, reason: 'wave-already-complete' };
    }
    for (const task of currentTasks) {
      if (!MissionService.dependenciesSatisfied(task, tasks)) {
        throw Object.assign(new Error(`Dependencies are not satisfied for ${task.id}`), { code: 'TASK_DEPENDENCY_BLOCKED' });
      }
    }
    const admission = await this.#reserveAdmissions({ missionId, projectId: project.id, waveIndex: mission.nextWaveIndex, runWorkers });
    if (!admission.taskIds.length) return { missionId, admitted: [], reason: admission.reason || 'global-worker-admission-full' };

    let missionWt;
    let waveBase;
    try {
      missionWt = await this.worktreeManager.ensureMissionWorktree(project, mission);
      const missionIdentity = await sourceIdentity(missionWt.path);
      waveBase = missionIdentity.head;
    } catch (error) {
      await this.#releaseAdmissions(admission, 'mission-worktree-preparation-failed');
      throw error;
    }
    const experience = this.experienceService
      ? await this.experienceService.route({ projectId: project.id, sourceHead: waveBase, role: 'worker', limit: 8 })
      : { items: [], precedence: 'Current repository/runtime evidence outranks project experience.' };
    const refreshed = await this.missionService.status({ missionId });
    const admitted = refreshed.tasks.filter((task) => admission.taskIds.includes(task.id));

    const prepared = [];
    const preparationFailures = [];
    for (const task of admitted) {
      let worktree = null;
      const dispatchId = randomId('dispatch');
      try {
        worktree = await this.worktreeManager.createTaskWorktree(project, mission, task, waveBase);
        let bootstrap = null;
        let bootstrapEvidenceId = null;
        if (normalizedBootstrapAuthorization) {
          try {
            bootstrap = await this.bootstrapExecutor.prepare({ worktreePath: worktree.path, plan: project.bootstrapPlan, authorization: normalizedBootstrapAuthorization });
            const evidence = await this.evidenceService.record({
              projectId: project.id, missionId, taskId: task.id, type: 'bootstrap',
              summary: bootstrap, sourceIdentity: { head: waveBase },
              metadata: { planContract: project.bootstrapPlan?.contract || null }
            });
            bootstrapEvidenceId = evidence.id;
          } catch (error) {
            const safeDetails = error?.details && typeof error.details === 'object' ? error.details : null;
            const evidence = await this.evidenceService.record({
              projectId: project.id, missionId, taskId: task.id, type: 'bootstrap-failure',
              summary: { code: error?.code || 'BOOTSTRAP_FAILED', message: String(error?.message || error).slice(0, 500), details: safeDetails },
              sourceIdentity: { head: waveBase }, metadata: { planContract: project.bootstrapPlan?.contract || null }
            });
            error.bootstrapEvidenceId = evidence.id;
            throw error;
          }
        }
        const packet = packetFor(project, mission, task, waveBase, experience);
        const packetPath = path.join(this.store.artifactsDir, 'worker-packets', `${dispatchId}.json`);
        await fs.mkdir(path.dirname(packetPath), { recursive: true });
        await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
        await this.store.transaction('worker_dispatched', (state) => {
          const target = state.tasks[task.key];
          if (target.status !== 'admitted' || target.admission?.id !== admission.id) {
            throw Object.assign(new Error(`Worker admission was lost for ${task.id}`), { code: 'WORKER_ADMISSION_LOST' });
          }
          target.status = runWorkers ? 'executing' : 'dispatched';
          target.attempts += 1;
          target.updatedAt = nowIso();
          target.admission = null;
          target.dispatches.push({ id: dispatchId, waveBase, worktreePath: worktree.path, packetPath, packet, bootstrapEvidenceId, status: runWorkers ? 'executing' : 'ready', createdAt: nowIso() });
          state.missions[missionId].status = runWorkers ? 'executing' : 'ready';
          state.runtime.timeline.push({ type: 'worker_dispatched', missionId, taskId: task.id, dispatchId, runWorkers, at: nowIso() });
        }, { missionId, taskId: task.id, dispatchId, runWorkers, admissionId: admission.id });
        prepared.push({ task: { ...task, attempts: task.attempts + 1 }, packet, packetPath, worktree, dispatchId, bootstrap, bootstrapEvidenceId });
      } catch (error) {
        if (worktree) await this.worktreeManager.removeTaskWorktree(project, mission, task).catch(() => {});
        await this.#releaseAdmissions({ ...admission, taskIds: [task.id] }, 'task-preparation-failed');
        preparationFailures.push({ taskId: task.id, code: error.code || 'ERROR', message: error.message, bootstrapEvidenceId: error.bootstrapEvidenceId || null });
      }
    }
    if (!runWorkers) return { missionId, waveIndex: mission.nextWaveIndex, waveBase, dispatched: prepared.map(({ task, packet, packetPath, worktree, dispatchId }) => ({ taskId: task.id, dispatchId, worktreePath: worktree.path, packetPath, packet })), preparationFailures };
    if (!prepared.length) return { missionId, waveIndex: mission.nextWaveIndex, waveBase, results: [], preparationFailures };

    const results = await Promise.all(prepared.map(async (item) => {
      const config = resolveWorkerConfig(project, item.task.worker);
      try {
        const before = await sourceIdentity(item.worktree.path);
        if (before.head !== waveBase) throw Object.assign(new Error('Task worktree HEAD drifted before worker start'), { code: 'TASK_HEAD_OWNERSHIP_VIOLATION' });
        const run = await this.workerAdapter.run({ project, mission, task: { ...item.task, key: `${mission.id}:${item.task.id}` }, worktreePath: item.worktree.path, packet: item.packet, packetPath: item.packetPath, config });
        const after = await sourceIdentity(item.worktree.path);
        if (after.head !== waveBase) throw Object.assign(new Error('Worker changed task HEAD; runtime owns commits'), { code: 'TASK_HEAD_OWNERSHIP_VIOLATION', details: { before: waveBase, after: after.head } });
        if (run.code !== 0) throw Object.assign(new Error(`Worker exited with code ${run.code}`), { code: 'WORKER_FAILED', details: run });
        const paths = await changedPaths(item.worktree.path, waveBase);
        await assertPathsWithinScope(item.worktree.path, paths, item.task.writeSet);
        const evidence = await this.evidenceService.record({ projectId: project.id, missionId, taskId: item.task.id, type: 'worker', summary: { exitCode: run.code, changedPaths: paths }, sourceIdentity: { head: waveBase }, artifact: `${run.stdout}\n--- stderr ---\n${run.stderr}` });
        let commitSha = null;
        if (paths.length) {
          await git(item.worktree.path, ['add', '-A']);
          await git(item.worktree.path, ['-c', 'user.name=Veteran Engineer Runtime', '-c', 'user.email=veteran-engineer@local.invalid', 'commit', '-m', `veteran(${mission.id}): ${item.task.id}`]);
          commitSha = (await git(item.worktree.path, ['rev-parse', 'HEAD'])).stdout.trim();
          await this.#validateTaskCommit(item.worktree.path, waveBase, commitSha, item.task.writeSet);
        }
        return { ...item, ok: true, commitSha, evidenceId: evidence.id, changedPaths: paths };
      } catch (error) {
        const evidence = await this.evidenceService.record({ projectId: project.id, missionId, taskId: item.task.id, type: 'worker-failure', summary: { code: error.code || 'ERROR', message: error.message }, sourceIdentity: { head: waveBase }, artifact: error.details || null });
        if (this.experienceService) {
          await this.experienceService.commit({
            projectId: project.id,
            mechanism: 'worker-execution',
            statement: `Worker failure ${error.code || 'ERROR'} occurred at owner ${item.task.owner}; treat this only as a reviewable project-scoped failed-attempt candidate.`,
            kind: 'failed-assumption',
            equivalenceClass: `${item.task.owner}:${error.code || 'ERROR'}`,
            evidenceIds: [evidence.id],
            sourceIdentity: { head: waveBase },
            appliesWhen: `Task owner is ${item.task.owner} and failure class is ${error.code || 'ERROR'}`,
            doesNotApplyWhen: 'Current repository/runtime evidence contradicts this candidate or scope differs.'
          }).catch(() => {});
        }
        return { ...item, ok: false, error, evidenceId: evidence.id };
      }
    }));

    for (const result of results.sort((a, b) => a.task.id.localeCompare(b.task.id))) {
      if (!result.ok) {
        await this.store.transaction('worker_failed', (state) => {
          const task = state.tasks[`${missionId}:${result.task.id}`];
          task.status = 'failed';
          task.updatedAt = nowIso();
          const dispatch = task.dispatches.find((entry) => entry.id === result.dispatchId);
          if (dispatch) Object.assign(dispatch, { status: 'failed', endedAt: nowIso(), error: { code: result.error.code || 'ERROR', message: result.error.message } });
          state.missions[missionId].status = 'blocked';
          state.runtime.timeline.push({ type: 'worker_failed', missionId, taskId: result.task.id, at: nowIso(), code: result.error.code || 'ERROR' });
        }, { missionId, taskId: result.task.id, code: result.error.code || 'ERROR' });
        continue;
      }
      let integrationSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
      if (result.commitSha) {
        const cherry = await git(missionWt.path, ['cherry-pick', result.commitSha], { allowFailure: true });
        if (cherry.code !== 0) {
          await git(missionWt.path, ['cherry-pick', '--abort'], { allowFailure: true });
          await this.store.transaction('task_integration_failed', (state) => {
            const task = state.tasks[`${missionId}:${result.task.id}`];
            task.status = 'failed';
            task.commitSha = result.commitSha;
            task.updatedAt = nowIso();
            state.missions[missionId].status = 'blocked';
            state.runtime.timeline.push({ type: 'task_integration_failed', missionId, taskId: result.task.id, at: nowIso() });
          }, { missionId, taskId: result.task.id });
          continue;
        }
        integrationSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
      }
      await this.store.transaction('task_integrated', (state) => {
        const task = state.tasks[`${missionId}:${result.task.id}`];
        task.status = 'done';
        task.commitSha = result.commitSha;
        task.integrationSha = integrationSha;
        task.updatedAt = nowIso();
        const dispatch = task.dispatches.find((entry) => entry.id === result.dispatchId);
        if (dispatch) Object.assign(dispatch, { status: 'integrated', endedAt: nowIso(), commitSha: result.commitSha, integrationSha });
        state.runtime.timeline.push({ type: 'task_integrated', missionId, taskId: result.task.id, integrationSha, at: nowIso() });
      }, { missionId, taskId: result.task.id, integrationSha });
      await this.worktreeManager.removeTaskWorktree(project, mission, result.task);
    }

    await this.#advanceWaveIfComplete(missionId, mission.nextWaveIndex);
    return { missionId, waveIndex: mission.nextWaveIndex, waveBase, results: results.map((result) => ({ taskId: result.task.id, ok: result.ok, commitSha: result.commitSha || null, bootstrap: result.bootstrap || null, bootstrapEvidenceId: result.bootstrapEvidenceId || null, error: result.ok ? null : { code: result.error.code || 'ERROR', message: result.error.message } })), preparationFailures };
  }

  async #reserveAdmissions({ missionId, projectId, waveIndex, runWorkers }) {
    const admissionId = randomId('admission');
    return this.store.transaction('worker_admission_reserved', (state) => {
      const mission = state.missions[missionId];
      const project = state.projects[projectId];
      if (!mission || !project || mission.phase !== 'execution' || mission.nextWaveIndex !== waveIndex) {
        return { id: admissionId, missionId, taskIds: [], reason: 'mission-state-changed' };
      }
      const waveIds = mission.waves[waveIndex] || [];
      const candidates = waveIds.map((id) => state.tasks[`${missionId}:${id}`]).filter((task) => task?.status === 'planned');
      const byId = new Map(Object.values(state.tasks).filter((task) => task.missionId === missionId).map((task) => [task.id, task]));
      const ready = candidates.filter((task) => task.dependencies.every((dep) => byId.get(dep)?.status === 'done'));
      const maxWorkers = Math.max(1, Number(project.workerPolicy?.maxWorkers || 2));
      const activeStatuses = new Set(['admitted', 'executing', 'cancelling', 'interrupted']);
      const globalActive = runWorkers ? Object.values(state.tasks).filter((task) => activeStatuses.has(task.status)).length : 0;
      const capacity = runWorkers ? Math.max(0, maxWorkers - globalActive) : maxWorkers;
      const selected = ready.slice(0, capacity);
      for (const task of selected) {
        task.status = 'admitted';
        task.admission = { id: admissionId, runWorkers, reservedAt: nowIso() };
        task.updatedAt = nowIso();
      }
      if (selected.length) {
        state.runtime.timeline.push({ type: 'worker_admission_reserved', missionId, admissionId, taskIds: selected.map((task) => task.id), runWorkers, at: nowIso() });
      }
      return { id: admissionId, missionId, taskIds: selected.map((task) => task.id), reason: selected.length ? null : (capacity === 0 ? 'global-worker-admission-full' : 'no-ready-planned-tasks') };
    }, { missionId, projectId, waveIndex, runWorkers, admissionId });
  }

  async #releaseAdmissions(admission, reason) {
    if (!admission?.taskIds?.length) return;
    await this.store.transaction('worker_admission_released', (state) => {
      const released = [];
      for (const taskId of admission.taskIds) {
        const task = state.tasks[`${admission.missionId || ''}:${taskId}`] || Object.values(state.tasks).find((item) => item.id === taskId && item.admission?.id === admission.id);
        if (!task || task.status !== 'admitted' || task.admission?.id !== admission.id) continue;
        task.status = 'planned';
        task.admission = null;
        task.updatedAt = nowIso();
        released.push(task.id);
      }
      if (released.length) state.runtime.timeline.push({ type: 'worker_admission_released', admissionId: admission.id, taskIds: released, reason, at: nowIso() });
    }, { admissionId: admission.id, taskIds: admission.taskIds, reason });
  }

  async commitExternalTaskResult({ missionId, taskId }) {
    const { mission, tasks } = await this.missionService.status({ missionId });
    const task = tasks.find((item) => item.id === taskId);
    if (!task) throw Object.assign(new Error(`Unknown task ${taskId}`), { code: 'TASK_NOT_FOUND' });
    if (!['dispatched', 'interrupted'].includes(task.status)) {
      throw Object.assign(new Error('External task result is only accepted for dispatched/interrupted tasks'), { code: 'TASK_RESULT_STATE_INVALID', details: { status: task.status } });
    }
    const project = await this.projectService.get(mission.projectId);
    const dispatch = task.dispatches.at(-1);
    if (!dispatch?.worktreePath) throw Object.assign(new Error('Task has no dispatched worktree'), { code: 'TASK_NOT_DISPATCHED' });
    const beforeHead = dispatch.waveBase;
    const current = await sourceIdentity(dispatch.worktreePath);
    if (current.head !== beforeHead) throw Object.assign(new Error('External worker changed HEAD; runtime owns commits'), { code: 'TASK_HEAD_OWNERSHIP_VIOLATION' });
    const paths = await changedPaths(dispatch.worktreePath, beforeHead);
    await assertPathsWithinScope(dispatch.worktreePath, paths, task.writeSet);
    let commitSha = null;
    if (paths.length) {
      await git(dispatch.worktreePath, ['add', '-A']);
      await git(dispatch.worktreePath, ['-c', 'user.name=Veteran Engineer Runtime', '-c', 'user.email=veteran-engineer@local.invalid', 'commit', '-m', `veteran(${mission.id}): ${task.id}`]);
      commitSha = (await git(dispatch.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
      await this.#validateTaskCommit(dispatch.worktreePath, beforeHead, commitSha, task.writeSet);
    }
    const missionWt = await this.worktreeManager.ensureMissionWorktree(project, mission);
    let integrationSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    if (commitSha) {
      await git(missionWt.path, ['cherry-pick', commitSha]);
      integrationSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    }
    await this.store.transaction('external_task_result_integrated', (state) => {
      const target = state.tasks[`${missionId}:${taskId}`];
      target.status = 'done';
      target.commitSha = commitSha;
      target.integrationSha = integrationSha;
      target.updatedAt = nowIso();
      const d = target.dispatches.at(-1);
      if (d) Object.assign(d, { status: 'integrated', endedAt: nowIso(), commitSha, integrationSha });
      state.runtime.timeline.push({ type: 'external_task_result_integrated', missionId, taskId, integrationSha, at: nowIso() });
    }, { missionId, taskId, integrationSha });
    const waveAdvanced = await this.#advanceWaveIfComplete(missionId, mission.nextWaveIndex);
    await this.worktreeManager.removeTaskWorktree(project, mission, task);
    return { taskId, commitSha, integrationSha, changedPaths: paths, waveAdvanced };
  }

  async cancelWorker({ missionId, taskId }) {
    const key = `${missionId}:${taskId}`;
    const signalled = this.workerAdapter.cancel(key);
    await this.store.transaction('worker_cancel_requested', (state) => {
      const task = state.tasks[key];
      if (!task) throw Object.assign(new Error(`Unknown task ${taskId}`), { code: 'TASK_NOT_FOUND' });
      if (!['executing', 'cancelling'].includes(task.status)) throw Object.assign(new Error('Task is not executing'), { code: 'TASK_NOT_EXECUTING' });
      task.status = 'cancelling';
      task.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'worker_cancel_requested', missionId, taskId, signalled, at: nowIso() });
    }, { missionId, taskId, signalled });
    return { missionId, taskId, signalled };
  }

  async retryWorker({ missionId, taskId }) {
    return this.store.transaction('worker_retry_scheduled', (state) => {
      const task = state.tasks[`${missionId}:${taskId}`];
      if (!task) throw Object.assign(new Error(`Unknown task ${taskId}`), { code: 'TASK_NOT_FOUND' });
      if (!['failed', 'interrupted', 'cancelled'].includes(task.status)) throw Object.assign(new Error('Only failed/interrupted/cancelled tasks can be retried'), { code: 'TASK_RETRY_INVALID' });
      task.status = 'planned';
      task.admission = null;
      task.updatedAt = nowIso();
      const mission = state.missions[missionId];
      mission.status = 'ready';
      mission.interruption = null;
      mission.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'worker_retry_scheduled', missionId, taskId, at: nowIso() });
      return task;
    }, { missionId, taskId });
  }

  async resumeWorker({ missionId, taskId }) {
    const { mission, tasks } = await this.missionService.status({ missionId });
    const task = tasks.find((item) => item.id === taskId);
    if (!task) throw Object.assign(new Error(`Unknown task ${taskId}`), { code: 'TASK_NOT_FOUND' });
    if (task.status !== 'interrupted') throw Object.assign(new Error('Task is not interrupted'), { code: 'TASK_NOT_INTERRUPTED' });
    const dispatch = task.dispatches.at(-1);
    if (!dispatch?.worktreePath) return this.retryWorker({ missionId, taskId });
    const current = await sourceIdentity(dispatch.worktreePath).catch(() => null);
    if (!current || current.head !== dispatch.waveBase) {
      throw Object.assign(new Error('Interrupted worker outcome cannot be reconciled safely; task HEAD changed or worktree disappeared'), { code: 'WORKER_RECONCILIATION_REQUIRED' });
    }
    const paths = await changedPaths(dispatch.worktreePath, dispatch.waveBase);
    await assertPathsWithinScope(dispatch.worktreePath, paths, task.writeSet);
    if (paths.length) return this.commitExternalTaskResult({ missionId, taskId });
    return this.retryWorker({ missionId, taskId });
  }

  async #advanceWaveIfComplete(missionId, expectedWaveIndex) {
    const snapshot = await this.store.read();
    const mission = snapshot.missions[missionId];
    if (!mission || mission.nextWaveIndex !== expectedWaveIndex) return false;
    const waveIds = mission.waves[expectedWaveIndex] || [];
    if (!waveIds.length) return false;
    const allDone = waveIds.every((id) => snapshot.tasks[`${missionId}:${id}`]?.status === 'done');
    if (!allDone) return false;
    return this.store.transaction('mission_wave_completed', (state) => {
      const target = state.missions[missionId];
      if (!target || target.nextWaveIndex !== expectedWaveIndex) return false;
      const ids = target.waves[expectedWaveIndex] || [];
      if (!ids.every((id) => state.tasks[`${missionId}:${id}`]?.status === 'done')) return false;
      target.nextWaveIndex += 1;
      target.status = 'ready';
      target.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'mission_wave_completed', missionId, waveIndex: expectedWaveIndex, at: nowIso() });
      return true;
    }, { missionId, waveIndex: expectedWaveIndex });
  }
  async #validateTaskCommit(repo, baseHead, commitSha, writeSet) {
    const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', commitSha])).stdout.trim().split(/\s+/);
    if (parents[1] !== baseHead) throw Object.assign(new Error('Task commit parent does not equal wave base'), { code: 'TASK_COMMIT_STRUCTURE_INVALID', details: parents });
    const diff = (await git(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commitSha])).stdout.split('\0').filter(Boolean);
    await assertPathsWithinScope(repo, diff, writeSet);
  }
}
