import { nowIso } from './util.mjs';

export const RUNTIME_FEEDBACK_CONTRACT = 'veteran-runtime-feedback-v1';

const MAX_OBSERVATION_ITEMS = 12;

function boundedText(value, limit = 1000) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, limit);
}

function compactServiceObservation(service) {
  if (!service?.configured) return null;
  return {
    ready: service.ready === true,
    reason: service.readiness?.reason || null,
    lastStatus: service.readiness?.lastStatus ?? null,
    lastError: boundedText(service.readiness?.lastError, 500)
  };
}

function compactBrowserObservation(browser) {
  if (!browser) return null;
  const failedAssertions = (browser.assertions || [])
    .filter((item) => item?.passed === false)
    .slice(0, MAX_OBSERVATION_ITEMS)
    .map((item) => ({
      name: boundedText(item.name, 240),
      detail: boundedText(item.detail, 800)
    }));
  return {
    kind: 'browser',
    summary: boundedText(browser.summary, 1200),
    currentUrl: boundedText(browser.currentUrl, 500),
    failureCode: browser.failureCode || null,
    failedAssertions
  };
}

function compactObservabilityObservation(observability) {
  if (!observability) return null;
  const failedChecks = (observability.checks || [])
    .filter((item) => item?.passed === false)
    .slice(0, MAX_OBSERVATION_ITEMS)
    .map((item) => ({
      name: boundedText(item.name, 240),
      signal: boundedText(item.signal, 120),
      observed: item.observed ?? null,
      threshold: item.threshold ?? null,
      detail: boundedText(item.detail, 800)
    }));
  return {
    kind: 'observability',
    summary: boundedText(observability.summary, 1200),
    failureCode: observability.failureCode || null,
    observedSourceHead: boundedText(observability.observedSourceHead, 240),
    failedChecks
  };
}

function compactArtifactObservation(artifacts) {
  if (!artifacts?.configured) return null;
  return {
    complete: artifacts.complete === true,
    requiredMissing: artifacts.requiredMissing === true,
    files: artifacts.files ?? null,
    errorCode: artifacts.error?.code || null
  };
}

function compactObservation(result) {
  const browser = compactBrowserObservation(result?.browser);
  const observability = compactObservabilityObservation(result?.observability);
  const service = compactServiceObservation(result?.service);
  const artifacts = compactArtifactObservation(result?.artifacts);
  if (browser) return { ...browser, service, artifacts };
  if (observability) return { ...observability, service, artifacts };
  if (service && service.ready === false) {
    return {
      kind: 'service-readiness',
      summary: 'Product service did not become ready for runtime feedback.',
      service,
      artifacts
    };
  }
  if (artifacts && artifacts.complete === false) {
    return {
      kind: 'artifact-collection',
      summary: 'Required runtime feedback artifacts were incomplete.',
      service,
      artifacts
    };
  }
  return {
    kind: 'command',
    summary: result?.passed === true
      ? 'Runtime feedback command passed.'
      : `Runtime feedback command failed${result?.exitCode === null || result?.exitCode === undefined ? '' : ` with exit code ${result.exitCode}`}.`,
    service,
    artifacts
  };
}

function compactCapabilityResult(capability, result) {
  return {
    capability,
    passed: result?.passed === true,
    evidenceId: result?.evidenceId || null,
    exitCode: result?.exitCode ?? null,
    failureStage: result?.failureStage || null,
    errorCode: null,
    observation: compactObservation(result)
  };
}

function compactCapabilityError(capability, error) {
  return {
    capability,
    passed: false,
    evidenceId: null,
    exitCode: null,
    failureStage: 'runtime-feedback',
    errorCode: error?.code || 'RUNTIME_FEEDBACK_CAPABILITY_FAILED',
    observation: {
      kind: 'provider-error',
      summary: boundedText(error?.message || error, 1000)
    }
  };
}

function uniqueCapabilityNames(project, waveTasks) {
  const names = [];
  const seen = new Set();
  for (const value of [
    ...(project.runtimeFeedbackCapabilities || []),
    ...waveTasks.map((task) => task.validationCapability).filter(Boolean)
  ]) {
    const name = String(value || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function completedWaveTasks(mission, tasks, waveIndex) {
  const ids = mission.waves?.[waveIndex] || [];
  if (!ids.length) return { ready: false, reason: 'wave-not-found', tasks: [] };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const waveTasks = ids.map((id) => byId.get(id)).filter(Boolean);
  if (waveTasks.length !== ids.length || waveTasks.some((task) => task.status !== 'done')) {
    return { ready: false, reason: 'wave-not-complete', tasks: waveTasks };
  }
  return { ready: true, reason: null, tasks: waveTasks };
}

function deriveWaveCommit(waveTasks) {
  const ordered = [...waveTasks].sort((a, b) => a.id.localeCompare(b.id));
  const integrationSha = ordered.at(-1)?.integrationSha || null;
  if (!integrationSha) {
    throw Object.assign(new Error('Completed wave is missing its integrated source identity'), {
      code: 'RUNTIME_FEEDBACK_SOURCE_IDENTITY_MISSING'
    });
  }
  return integrationSha;
}

function reusedRound(mission, waveIndex, commitSha) {
  return (mission.runtimeFeedback?.rounds || []).find((round) =>
    round.waveIndex === waveIndex && round.commitSha === commitSha
  ) || null;
}

export class RuntimeFeedbackService {
  constructor({ store, projectService, missionService, validationService, evidenceService }) {
    Object.assign(this, { store, projectService, missionService, validationService, evidenceService });
  }

  async runAfterWave({ missionId, waveIndex, targetCommitSha = null }) {
    if (!Number.isInteger(waveIndex) || waveIndex < 0) {
      throw Object.assign(new Error('runtime feedback waveIndex must be a non-negative integer'), { code: 'RUNTIME_FEEDBACK_WAVE_INVALID' });
    }
    const { mission, tasks } = await this.missionService.status({ missionId });
    const wave = completedWaveTasks(mission, tasks, waveIndex);
    if (!wave.ready) {
      return {
        contract: RUNTIME_FEEDBACK_CONTRACT,
        configured: true,
        recorded: false,
        reason: wave.reason,
        missionId,
        waveIndex
      };
    }
    const project = await this.projectService.get(mission.projectId);
    const capabilities = uniqueCapabilityNames(project, wave.tasks);
    if (!capabilities.length) {
      return {
        contract: RUNTIME_FEEDBACK_CONTRACT,
        configured: false,
        recorded: false,
        reason: 'no-runtime-feedback-capabilities',
        missionId,
        waveIndex
      };
    }
    const commitSha = targetCommitSha ? String(targetCommitSha).trim() : deriveWaveCommit(wave.tasks);
    if (!commitSha) {
      throw Object.assign(new Error('runtime feedback requires an exact integrated source identity'), { code: 'RUNTIME_FEEDBACK_SOURCE_IDENTITY_MISSING' });
    }
    const existing = reusedRound(mission, waveIndex, commitSha);
    if (existing) return { contract: RUNTIME_FEEDBACK_CONTRACT, configured: true, recorded: true, reused: true, ...existing };

    const results = [];
    for (const capability of capabilities) {
      try {
        const result = await this.validationService.run({
          projectId: project.id,
          missionId,
          capability,
          purpose: 'runtime-feedback',
          targetCommitSha: commitSha
        });
        results.push(compactCapabilityResult(capability, result));
      } catch (error) {
        results.push(compactCapabilityError(capability, error));
      }
    }
    const passed = results.every((item) => item.passed);
    const createdAt = nowIso();
    const summary = {
      contract: RUNTIME_FEEDBACK_CONTRACT,
      missionId,
      waveIndex,
      commitSha,
      passed,
      capabilities: results
    };
    const aggregateEvidence = await this.evidenceService.record({
      projectId: project.id,
      missionId,
      type: 'runtime-feedback-round',
      summary,
      sourceIdentity: { head: commitSha }
    });
    const round = { ...summary, aggregateEvidenceId: aggregateEvidence.id, createdAt };

    return this.store.transaction('mission_runtime_feedback_recorded', (state) => {
      const target = state.missions[missionId];
      if (!target) throw Object.assign(new Error(`Unknown mission: ${missionId}`), { code: 'MISSION_NOT_FOUND' });
      target.runtimeFeedback ||= {
        contract: RUNTIME_FEEDBACK_CONTRACT,
        status: 'pending',
        latestRound: null,
        rounds: []
      };
      const duplicate = reusedRound(target, waveIndex, commitSha);
      if (duplicate) return { contract: RUNTIME_FEEDBACK_CONTRACT, configured: true, recorded: true, reused: true, ...duplicate };
      target.runtimeFeedback.status = passed ? 'passed' : 'failed';
      target.runtimeFeedback.latestRound = round;
      target.runtimeFeedback.rounds.push(round);
      if (target.runtimeFeedback.rounds.length > 65) target.runtimeFeedback.rounds = target.runtimeFeedback.rounds.slice(-65);
      target.updatedAt = nowIso();
      state.runtime.timeline.push({
        type: 'mission_runtime_feedback_recorded',
        missionId,
        waveIndex,
        commitSha,
        passed,
        evidenceId: aggregateEvidence.id,
        at: createdAt
      });
      return { contract: RUNTIME_FEEDBACK_CONTRACT, configured: true, recorded: true, reused: false, ...round };
    }, { missionId, waveIndex, commitSha, passed, evidenceId: aggregateEvidence.id });
  }

  async runAfterWaveSafe(args) {
    try {
      return await this.runAfterWave(args);
    } catch (error) {
      return {
        contract: RUNTIME_FEEDBACK_CONTRACT,
        configured: true,
        recorded: false,
        reason: 'runtime-feedback-unavailable',
        missionId: args?.missionId || null,
        waveIndex: Number.isInteger(args?.waveIndex) ? args.waveIndex : null,
        error: {
          code: error?.code || 'RUNTIME_FEEDBACK_UNAVAILABLE',
          message: String(error?.message || error).slice(0, 500)
        }
      };
    }
  }
}
