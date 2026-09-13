import { nowIso } from './util.mjs';
import { git } from './git.mjs';

export class MissionAdvanceService {
  constructor({ store, projectService, missionService, worktreeManager, workerOrchestrator, validationService, reviewService, candidateService, evidenceService }) {
    Object.assign(this, { store, projectService, missionService, worktreeManager, workerOrchestrator, validationService, reviewService, candidateService, evidenceService });
  }

  async advance({ missionId, runWorkers = false }) {
    const { mission } = await this.missionService.status({ missionId });
    if (mission.status === 'cancelled') throw Object.assign(new Error('Mission is cancelled'), { code: 'MISSION_CANCELLED' });
    if (mission.interruption?.requiresReconciliation) throw Object.assign(new Error('Mission requires interruption reconciliation before advance'), { code: 'RECONCILIATION_REQUIRED' });
    if (mission.phase === 'execution') {
      const result = await this.workerOrchestrator.execute({ missionId, runWorkers });
      const after = (await this.missionService.status({ missionId })).mission;
      return { action: 'execution', result, nextPhase: after.phase };
    }
    const project = await this.projectService.get(mission.projectId);
    const candidateId = mission.activeCandidateId;
    if (mission.phase === 'validation') {
      const required = project.requiredValidationCapabilities || [];
      if (required.length === 0) {
        if (project.requireValidation) throw Object.assign(new Error('Validation is required but no requiredValidationCapabilities are configured'), { code: 'VALIDATION_REQUIRED_NOT_CONFIGURED' });
        let commitSha;
        if (candidateId) {
          const state = await this.store.read();
          commitSha = state.runtime.candidates?.[candidateId]?.commitSha || null;
        } else {
          const missionWt = await this.worktreeManager.ensureMissionWorktree(project, mission);
          commitSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
        }
        const evidence = await this.evidenceService.record({ projectId: project.id, missionId, type: 'validation', summary: { passed: true, skipped: true, reason: 'no-required-capabilities', commitSha }, sourceIdentity: { head: commitSha } });
        await this.store.transaction('mission_validation_skipped', (state) => {
          const target = state.missions[missionId];
          target.validation = { status: 'skipped', evidenceIds: [evidence.id], commitSha };
          target.phase = 'review';
          target.status = 'ready';
          target.updatedAt = nowIso();
          state.runtime.timeline.push({ type: 'mission_validation_skipped', missionId, evidenceId: evidence.id, at: nowIso() });
        }, { missionId, evidenceId: evidence.id });
        return { action: 'validation-skipped', nextPhase: 'review', evidenceId: evidence.id };
      }
      const results = [];
      for (const capability of required) {
        const result = await this.validationService.run({ projectId: project.id, missionId, candidateId, capability });
        results.push(result);
        if (!result.passed) return { action: 'validation', results, nextPhase: 'validation', blocked: true };
      }
      await this.store.transaction('mission_validation_passed', (state) => {
        const target = state.missions[missionId];
        target.validation.status = 'passed';
        target.phase = 'review';
        target.status = 'ready';
        target.updatedAt = nowIso();
      }, { missionId, capabilities: required });
      return { action: 'validation', results, nextPhase: 'review' };
    }
    if (mission.phase === 'review') {
      const result = await this.reviewService.deterministic({ missionId, candidateId });
      if (!result.passed) return { action: 'review', result, nextPhase: 'review', blocked: true };
      await this.store.transaction('mission_review_passed', (state) => {
        const target = state.missions[missionId];
        target.phase = 'semantic-review';
        target.status = 'ready';
        target.updatedAt = nowIso();
      }, { missionId });
      return { action: 'review', result, nextPhase: 'semantic-review' };
    }
    if (mission.phase === 'semantic-review') {
      const result = await this.reviewService.semantic({ missionId, candidateId });
      if (!result.passed) return { action: 'semantic-review', result, nextPhase: 'semantic-review', blocked: true };
      await this.store.transaction('mission_semantic_review_passed', (state) => {
        const target = state.missions[missionId];
        target.phase = 'candidate';
        target.status = 'ready';
        target.updatedAt = nowIso();
      }, { missionId });
      return { action: 'semantic-review', result, nextPhase: 'candidate' };
    }
    if (mission.phase === 'candidate') {
      if (candidateId) {
        const state = await this.store.read();
        const candidate = state.runtime.candidates?.[candidateId];
        if (!candidate) throw Object.assign(new Error(`Unknown candidate ${candidateId}`), { code: 'CANDIDATE_NOT_FOUND' });
        const preflight = await this.candidateService.preflight({ missionId });
        const sourceChanged = preflight.sourceHead !== candidate.sourceHead || preflight.missionHead !== candidate.missionHead;
        if (sourceChanged) {
          const result = await this.candidateService.createOrRefresh({ missionId, reason: 'source-drift-refresh' });
          return { action: 'candidate-refresh', result, nextPhase: result.requiresRevalidation ? 'validation' : 'candidate' };
        }
        const proofFresh = ['passed', 'skipped'].includes(mission.validation.status) && mission.review.status === 'passed' && ['passed', 'skipped'].includes(mission.semanticReview.status) && mission.validation.commitSha === candidate.commitSha && mission.review.commitSha === candidate.commitSha && mission.semanticReview.commitSha === candidate.commitSha;
        if (proofFresh) {
          await this.store.transaction('mission_candidate_ready', (working) => {
            const target = working.missions[missionId];
            target.status = 'candidate-ready';
            target.updatedAt = nowIso();
          }, { missionId, candidateId });
          return { action: 'candidate-ready', candidate, nextPhase: 'candidate' };
        }
      }
      const result = await this.candidateService.createOrRefresh({ missionId, reason: candidateId ? 'proof-refresh' : 'finalize' });
      if (result.requiresRevalidation) return { action: 'candidate-refresh', result, nextPhase: 'validation' };
      return { action: 'candidate-created', result, nextPhase: 'candidate' };
    }
    return { action: 'noop', phase: mission.phase, status: mission.status };
  }
}
