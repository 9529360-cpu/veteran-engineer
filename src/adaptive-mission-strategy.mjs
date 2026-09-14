import { RISK_LEVELS } from './constants.mjs';
import { writeSetsConflict } from './git.mjs';

export const ADAPTIVE_MISSION_CONTRACT = 'veteran-adaptive-mission-v1';

const RISK_RANK = new Map(RISK_LEVELS.map((risk, index) => [risk, index]));
const TERMINAL_MISSION_STATUSES = new Set(['completed', 'cancelled']);
const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled', 'blocked', 'superseded']);
const ACTIVE_EXECUTION_STATUSES = new Set(['admitted', 'dispatched', 'executing', 'cancelling', 'interrupted']);
const MAX_CONTINUITY_MISSIONS = 8;
const MAX_CONTINUITY_TASKS = 32;

function compactString(value, limit = 240) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, limit);
}

function maxRisk(tasks) {
  return tasks.reduce((highest, task) => {
    const candidate = RISK_RANK.get(task.risk) ?? 0;
    return candidate > (RISK_RANK.get(highest) ?? 0) ? task.risk : highest;
  }, 'low');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function assessTaskRisk({
  explicitRisk = null,
  writeSet = [],
  validationCapability = null,
  sensingCapabilities = [],
  executionCapabilities = [],
  coordinationKeys = [],
  runtimeResources = []
} = {}) {
  if (explicitRisk !== undefined && explicitRisk !== null && String(explicitRisk).trim()) {
    const risk = String(explicitRisk).trim();
    if (!RISK_LEVELS.includes(risk)) throw new Error(`Invalid risk level: ${risk}`);
    return { risk, source: 'explicit', signals: [] };
  }

  const signals = [];
  let risk = 'low';
  const promote = (candidate, signal) => {
    if ((RISK_RANK.get(candidate) ?? 0) > (RISK_RANK.get(risk) ?? 0)) risk = candidate;
    if (signal) signals.push(signal);
  };

  if (writeSet.includes('.')) promote('high', 'broad-write-set');
  if (runtimeResources.some((resource) =>
    ['project', 'global'].includes(resource?.scope)
    && (resource?.mode || 'exclusive') === 'exclusive'
  )) promote('high', 'shared-authority-exclusive-resource');
  if (coordinationKeys.length) promote('medium', 'project-coordination-key');
  if (executionCapabilities.length) promote('medium', 'execution-capability-required');
  if (sensingCapabilities.length) promote('medium', 'sensing-capability-required');
  if (validationCapability) promote('medium', 'validation-boundary-required');
  if (writeSet.length >= 4) promote('medium', 'wide-write-set');

  return { risk, source: 'inferred', signals: unique(signals) };
}

export function buildProjectContinuitySnapshot({ state, projectId, liveHead = null } = {}) {
  const missions = Object.values(state?.missions || {})
    .filter((mission) => mission.projectId === projectId && !TERMINAL_MISSION_STATUSES.has(mission.status))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

  let taskBudget = MAX_CONTINUITY_TASKS;
  const activeMissions = [];
  for (const mission of missions.slice(0, MAX_CONTINUITY_MISSIONS)) {
    const tasks = Object.values(state?.tasks || {})
      .filter((task) => task.missionId === mission.id && !TERMINAL_TASK_STATUSES.has(task.status))
      .sort((left, right) => left.id.localeCompare(right.id));
    const visibleTasks = tasks.slice(0, Math.max(0, taskBudget));
    taskBudget -= visibleTasks.length;
    activeMissions.push({
      id: mission.id,
      phase: mission.phase || null,
      status: mission.status || null,
      baseHead: mission.baseSourceIdentity?.head || null,
      updatedAt: mission.updatedAt || null,
      taskCount: tasks.length,
      tasks: visibleTasks.map((task) => ({
        id: task.id,
        status: task.status,
        owner: compactString(task.owner),
        writeSet: [...(task.writeSet || [])],
        risk: task.risk || null
      })),
      tasksTruncated: visibleTasks.length < tasks.length
    });
    if (taskBudget <= 0) break;
  }

  return {
    contract: ADAPTIVE_MISSION_CONTRACT,
    projectId,
    liveHead,
    activeMissionCount: missions.length,
    activeMissions,
    missionsTruncated: activeMissions.length < missions.length,
    taskBudgetExhausted: taskBudget <= 0
  };
}

export function plannedProjectWriteConflicts(tasks = [], continuity = null) {
  const conflicts = [];
  for (const task of tasks) {
    for (const mission of continuity?.activeMissions || []) {
      for (const other of mission.tasks || []) {
        if (!writeSetsConflict(task.writeSet || [], other.writeSet || [])) continue;
        conflicts.push({
          taskId: task.id,
          conflictingMissionId: mission.id,
          conflictingTaskId: other.id,
          conflictingTaskStatus: other.status,
          writeSet: [...(other.writeSet || [])]
        });
      }
    }
  }
  return conflicts.slice(0, 32);
}

export function activeProjectWriteConflicts({ state, mission, task } = {}) {
  if (!state || !mission || !task) return [];
  const conflicts = [];
  for (const other of Object.values(state.tasks || {})) {
    if (other.projectId !== mission.projectId || other.missionId === mission.id) continue;
    if (!ACTIVE_EXECUTION_STATUSES.has(other.status)) continue;
    const otherMission = state.missions?.[other.missionId];
    if (!otherMission || TERMINAL_MISSION_STATUSES.has(otherMission.status)) continue;
    if (!writeSetsConflict(task.writeSet || [], other.writeSet || [])) continue;
    conflicts.push({
      missionId: other.missionId,
      taskId: other.id,
      status: other.status,
      writeSet: [...(other.writeSet || [])]
    });
  }
  return conflicts;
}

export function compileMissionExecutionStrategy({ tasks = [], waves = [], project = {}, riskEnvelope = 'medium', continuity = null } = {}) {
  const maxWaveWidth = waves.reduce((largest, wave) => Math.max(largest, wave.length), 0);
  const taskRisk = maxRisk(tasks);
  const inferredRiskTasks = tasks.filter((task) => task.riskAssessment?.source === 'inferred').map((task) => task.id);
  const projectWriteConflicts = plannedProjectWriteConflicts(tasks, continuity);
  const executionMode = tasks.length <= 1
    ? 'single-worker'
    : maxWaveWidth > 1
      ? 'parallel-mission'
      : 'serial-mission';

  let taskClass = 'light';
  if (taskRisk === 'critical') taskClass = 'consequential';
  else if (taskRisk === 'high' || tasks.length >= 5 || waves.length >= 4) taskClass = 'heavy';
  else if (taskRisk === 'medium' || tasks.length > 1 || projectWriteConflicts.length) taskClass = 'moderate';

  const runtimeFeedbackCapabilities = project.runtimeFeedbackCapabilities || [];
  const validationNames = (project.validationCapabilities || []).map((capability) => capability?.name).filter(Boolean);
  const browserLikeValidationAvailable = validationNames.some((name) => /browser|e2e|playwright|visual|ui/i.test(name));
  const validationMode = taskClass === 'light'
    ? 'focused'
    : taskClass === 'moderate'
      ? 'cross-boundary'
      : 'runtime-closed';

  const reasons = [];
  if (tasks.length > 1) reasons.push('multi-task');
  if (maxWaveWidth > 1) reasons.push('safe-parallel-wave');
  if (taskRisk !== 'low') reasons.push(`max-task-risk:${taskRisk}`);
  if (inferredRiskTasks.length) reasons.push('runtime-inferred-task-risk');
  if (projectWriteConflicts.length) reasons.push('same-project-write-overlap');
  if (runtimeFeedbackCapabilities.length) reasons.push('runtime-feedback-available');
  if (browserLikeValidationAvailable) reasons.push('browser-validation-available');

  return {
    contract: ADAPTIVE_MISSION_CONTRACT,
    taskClass,
    executionMode,
    maxWaveWidth,
    riskEnvelope,
    maxTaskRisk: taskRisk,
    inferredRiskTasks,
    coordination: {
      requiresCoordination: projectWriteConflicts.length > 0,
      plannedProjectWriteConflicts: projectWriteConflicts
    },
    validation: {
      mode: validationMode,
      runtimeFeedbackAvailable: runtimeFeedbackCapabilities.length > 0,
      liveCheckpointEnabled: project.runtimeFeedbackPolicy?.liveSession === true,
      autoRepairEnabled: project.runtimeFeedbackPolicy?.autoRepair === true,
      browserLikeValidationAvailable
    },
    reasons: unique(reasons)
  };
}

export function plannerProjectAwareness(project, continuity) {
  return {
    contract: ADAPTIVE_MISSION_CONTRACT,
    continuity,
    environment: {
      contract: project.environmentProfile?.contract || null,
      runtimeFamilies: project.environmentProfile?.runtimeFamilies || [],
      readiness: project.environmentReadiness?.status || null,
      bootstrap: project.bootstrapPlan?.status || null
    },
    validation: {
      capabilities: (project.validationCapabilities || []).map((capability) => capability?.name).filter(Boolean),
      runtimeFeedbackCapabilities: [...(project.runtimeFeedbackCapabilities || [])],
      requireValidation: project.requireValidation === true,
      requireSemanticReview: project.requireSemanticReview === true
    }
  };
}
