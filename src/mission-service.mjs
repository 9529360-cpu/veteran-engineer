import { RISK_LEVELS } from './constants.mjs';
import { runProcess, sourceIdentity, writeSetsConflict } from './git.mjs';
import { normalizePathList, nowIso, randomId } from './util.mjs';

const TERMINAL_TASKS = new Set(['done', 'failed', 'cancelled', 'blocked', 'superseded']);
const SUCCESS_TASKS = new Set(['done']);

function validateTask(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`tasks[${index}] must be an object`);
  const id = String(raw.id || `T${index + 1}`);
  const dependencies = [...new Set((raw.dependencies || []).map(String))];
  const writeSet = normalizePathList(raw.writeSet || []);
  const risk = raw.risk || 'low';
  if (!RISK_LEVELS.includes(risk)) throw new Error(`Invalid risk level for ${id}: ${risk}`);
  if (!String(raw.contract || '').trim()) throw new Error(`Task ${id} requires a contract`);
  if (!String(raw.owner || '').trim()) throw new Error(`Task ${id} requires an owner/boundary`);
  return {
    id,
    contract: String(raw.contract).trim(),
    owner: String(raw.owner).trim(),
    dependencies,
    writeSet,
    protectedPaths: normalizePathList(raw.protectedPaths || []),
    risk,
    validationCapability: raw.validationCapability || null,
    worker: raw.worker || 'default',
    notes: raw.notes || null
  };
}

function topo(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Task IDs must be unique');
  for (const task of tasks) {
    for (const dep of task.dependencies) if (!byId.has(dep)) throw new Error(`Task ${task.id} depends on unknown task ${dep}`);
    if (task.dependencies.includes(task.id)) throw new Error(`Task ${task.id} cannot depend on itself`);
  }
  const indegree = new Map(tasks.map((task) => [task.id, task.dependencies.length]));
  const dependents = new Map(tasks.map((task) => [task.id, []]));
  for (const task of tasks) for (const dep of task.dependencies) dependents.get(dep).push(task.id);
  const order = [];
  const queue = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id).sort();
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
    queue.sort();
  }
  if (order.length !== tasks.length) throw Object.assign(new Error('Mission task graph contains a cycle'), { code: 'MISSION_DAG_CYCLE' });
  return order;
}

export function computeWaves(tasks) {
  const remaining = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set();
  const waves = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((task) => task.dependencies.every((dep) => done.has(dep))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error('Unable to compute mission waves');
    const wave = [];
    for (const task of ready) {
      if (!wave.some((selected) => writeSetsConflict(selected.writeSet, task.writeSet))) wave.push(task);
    }
    if (!wave.length) wave.push(ready[0]);
    waves.push(wave.map((task) => task.id));
    for (const task of wave) {
      remaining.delete(task.id);
      done.add(task.id);
    }
  }
  return waves;
}

export class MissionService {
  constructor({ store, projectService, experienceService = null, evidenceService = null }) {
    this.store = store;
    this.projectService = projectService;
    this.experienceService = experienceService;
    this.evidenceService = evidenceService;
  }

  async plan({ projectId, goal, doneDefinition, nonGoals = [], tasks = null, riskEnvelope = 'medium' }) {
    const project = await this.projectService.get(projectId);
    const live = await sourceIdentity(project.repoPath);
    if (live.dirty) {
      const error = new Error('Cannot plan a mission from a dirty source checkout; HEAD alone is not complete source identity.');
      error.code = 'DIRTY_SOURCE_BLOCKED';
      error.details = live.dirtyPaths;
      throw error;
    }
    if (!String(goal || '').trim() || !String(doneDefinition || '').trim()) throw new Error('goal and doneDefinition are required');
    const experience = this.experienceService
      ? await this.experienceService.route({ projectId, sourceHead: live.head, role: 'planner', limit: 8 })
      : { role: 'planner', items: [], excludedConflicts: 0, precedence: 'Current repository/runtime evidence outranks project experience.' };
    let proposedTasks = tasks;
    let plannerEvidenceId = null;
    if (!Array.isArray(proposedTasks) || proposedTasks.length === 0) {
      const provider = project.plannerProvider || null;
      if (!provider?.command) throw new Error('mission requires at least one task or an operator-configured plannerProvider');
      const payload = {
        protocol: 'veteran-planner-v1',
        project: { id: project.id, repoPath: project.repoPath, sourceIdentity: live },
        mission: { goal: String(goal).trim(), doneDefinition: String(doneDefinition).trim(), nonGoals: nonGoals.map(String), riskEnvelope },
        projectExperience: experience.items,
        experiencePrecedence: experience.precedence,
        limits: { maxTasks: 64 }
      };
      const result = await runProcess(provider.command, provider.args || [], {
        cwd: project.repoPath,
        input: JSON.stringify(payload),
        allowFailure: true,
        timeoutMs: provider.timeoutMs || 180_000
      });
      let parsed = null;
      try { parsed = JSON.parse(result.stdout); } catch { }
      if (result.code !== 0 || !Array.isArray(parsed?.tasks) || parsed.tasks.length === 0 || parsed.tasks.length > 64) {
        const error = new Error('Planner provider failed or returned an invalid task graph');
        error.code = 'PLANNER_PROVIDER_FAILED';
        error.details = { exitCode: result.code, stderr: result.stderr.slice(0, 2000), taskCount: Array.isArray(parsed?.tasks) ? parsed.tasks.length : null };
        throw error;
      }
      proposedTasks = parsed.tasks;
      if (this.evidenceService) {
        const evidence = await this.evidenceService.record({
          projectId,
          type: 'planner-provider',
          summary: { exitCode: result.code, taskCount: proposedTasks.length, experienceIds: experience.items.map((item) => item.id) },
          sourceIdentity: live,
          artifact: `${result.stdout}\n--- stderr ---\n${result.stderr}`
        });
        plannerEvidenceId = evidence.id;
      }
    }
    if (proposedTasks.length > 64) throw Object.assign(new Error('Mission plan exceeds the 64-task safety bound'), { code: 'MISSION_PLAN_TOO_LARGE' });
    const normalized = proposedTasks.map(validateTask);
    topo(normalized);
    const waves = computeWaves(normalized);
    const missionId = randomId('mission');
    const createdAt = nowIso();
    const mission = {
      id: missionId,
      projectId,
      goal: String(goal).trim(),
      doneDefinition: String(doneDefinition).trim(),
      nonGoals: nonGoals.map(String),
      riskEnvelope,
      baseSourceIdentity: live,
      currentSourceIdentity: live,
      status: 'ready',
      phase: 'execution',
      waves,
      nextWaveIndex: 0,
      validation: { status: 'pending', evidenceIds: [] },
      review: { status: 'pending', evidenceIds: [], findings: [] },
      semanticReview: { status: 'pending', evidenceIds: [], findings: [] },
      candidateIds: [],
      activeCandidateId: null,
      mergeProposalIds: [],
      activeMergeProposalId: null,
      interruption: null,
      planningExperience: {
        ids: experience.items.map((item) => item.id),
        excludedConflicts: experience.excludedConflicts,
        precedence: experience.precedence,
        evidenceId: plannerEvidenceId
      },
      createdAt,
      updatedAt: createdAt
    };
    const taskRecords = normalized.map((task) => ({
      ...task,
      key: `${missionId}:${task.id}`,
      missionId,
      projectId,
      status: 'planned',
      attempts: 0,
      dispatches: [],
      commitSha: null,
      integrationSha: null,
      evidenceIds: [],
      createdAt,
      updatedAt: createdAt
    }));
    return this.store.transaction('mission_planned', (state) => {
      state.missions[missionId] = mission;
      for (const task of taskRecords) state.tasks[task.key] = task;
      state.runtime.timeline.push({ type: 'mission_planned', missionId, at: createdAt, baseHead: live.head });
      return { mission, tasks: taskRecords };
    }, { missionId, projectId, baseHead: live.head, taskCount: taskRecords.length });
  }

  async status({ missionId }) {
    const state = await this.store.read();
    const mission = state.missions[missionId];
    if (!mission) throw Object.assign(new Error(`Unknown mission: ${missionId}`), { code: 'MISSION_NOT_FOUND' });
    const tasks = Object.values(state.tasks).filter((task) => task.missionId === missionId).sort((a, b) => a.id.localeCompare(b.id));
    const candidates = (mission.candidateIds || []).map((id) => state.runtime.candidates?.[id]).filter(Boolean);
    const mergeProposals = (mission.mergeProposalIds || []).map((id) => state.runtime.mergeProposals?.[id]).filter(Boolean);
    return { mission, tasks, candidates, mergeProposals };
  }

  async readiness({ missionId }) {
    const { mission, tasks } = await this.status({ missionId });
    const project = await this.projectService.get(mission.projectId);
    const live = await sourceIdentity(project.repoPath);
    const blockers = [];
    if (live.dirty && ['execution', 'candidate', 'finalize'].includes(mission.phase)) blockers.push({ code: 'DIRTY_SOURCE_BLOCKED', details: live.dirtyPaths });
    if (mission.status === 'cancelled') blockers.push({ code: 'MISSION_CANCELLED' });
    if (mission.interruption?.requiresReconciliation) blockers.push({ code: 'RECONCILIATION_REQUIRED' });
    if (mission.phase === 'execution') {
      const failed = tasks.filter((task) => task.status === 'failed');
      if (failed.length) blockers.push({ code: 'FAILED_TASKS', taskIds: failed.map((task) => task.id) });
    }
    if (mission.phase === 'finalize' && !mission.activeCandidateId) blockers.push({ code: 'CANDIDATE_REQUIRED' });
    const operatorActionRequired = mission.phase === 'finalize' && mission.status === 'awaiting-operator-merge';
    return {
      missionId,
      ready: blockers.length === 0,
      phase: mission.phase,
      status: mission.status,
      liveSourceIdentity: live,
      blockers,
      operatorActionRequired,
      nextAction: operatorActionRequired ? 'operator-merge' : null,
      activeMergeProposalId: mission.activeMergeProposalId || null
    };
  }

  async timeline({ missionId }) {
    const state = await this.store.read();
    return state.runtime.timeline.filter((event) => event.missionId === missionId);
  }

  async cancel({ missionId, reason = 'operator-request' }) {
    return this.store.transaction('mission_cancelled', (state) => {
      const mission = state.missions[missionId];
      if (!mission) throw Object.assign(new Error(`Unknown mission: ${missionId}`), { code: 'MISSION_NOT_FOUND' });
      mission.status = 'cancelled';
      mission.updatedAt = nowIso();
      for (const task of Object.values(state.tasks).filter((item) => item.missionId === missionId)) {
        if (!TERMINAL_TASKS.has(task.status)) {
          task.status = task.status === 'executing' ? 'cancelling' : 'cancelled';
          if (task.status === 'cancelled') task.admission = null;
        }
      }
      state.runtime.timeline.push({ type: 'mission_cancelled', missionId, reason, at: nowIso() });
      return mission;
    }, { missionId, reason });
  }

  async resume({ missionId }) {
    return this.store.transaction('mission_resumed', (state) => {
      const mission = state.missions[missionId];
      if (!mission) throw Object.assign(new Error(`Unknown mission: ${missionId}`), { code: 'MISSION_NOT_FOUND' });
      if (mission.status === 'cancelled') throw Object.assign(new Error('Cancelled missions cannot be resumed'), { code: 'MISSION_CANCELLED' });
      const tasks = Object.values(state.tasks).filter((task) => task.missionId === missionId);
      const uncertain = tasks.filter((task) => ['admitted', 'executing', 'cancelling'].includes(task.status));
      for (const task of uncertain) {
        task.status = 'interrupted';
        task.updatedAt = nowIso();
      }
      mission.interruption = uncertain.length ? {
        requiresReconciliation: true,
        taskIds: uncertain.map((task) => task.id),
        detectedAt: nowIso()
      } : null;
      mission.status = uncertain.length ? 'blocked' : 'ready';
      mission.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'mission_resume_checked', missionId, uncertainTaskIds: uncertain.map((task) => task.id), at: nowIso() });
      return mission;
    }, { missionId });
  }

  static dependenciesSatisfied(task, tasks) {
    const byId = new Map(tasks.map((item) => [item.id, item]));
    return task.dependencies.every((dep) => SUCCESS_TASKS.has(byId.get(dep)?.status));
  }
}
