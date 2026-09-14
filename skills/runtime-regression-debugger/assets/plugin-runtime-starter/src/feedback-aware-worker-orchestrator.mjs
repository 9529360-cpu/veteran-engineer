export class FeedbackAwareWorkerOrchestrator {
  constructor({ delegate, missionService, runtimeFeedbackService, validationService = null }) {
    this.delegate = delegate;
    this.missionService = missionService;
    this.runtimeFeedbackService = runtimeFeedbackService;
    this.validationService = validationService;
  }

  async #runWithFeedback(missionId, operation) {
    const before = await this.missionService.status({ missionId });
    const result = await operation();
    const after = await this.missionService.status({ missionId });
    const rounds = [];
    const start = before.mission.nextWaveIndex;
    const end = after.mission.nextWaveIndex;
    if (before.mission.phase === 'execution' && end > start) {
      for (let waveIndex = start; waveIndex < end; waveIndex += 1) {
        const feedback = await this.runtimeFeedbackService.runAfterWaveSafe({ missionId, waveIndex });
        const repair = await this.runtimeFeedbackService.scheduleRepairWaveSafe({ missionId, feedbackRound: feedback });
        rounds.push({ ...feedback, repair });
      }
    }
    const latest = await this.missionService.status({ missionId });
    if (latest.mission.phase !== 'execution' && this.validationService) {
      await this.validationService.releaseRuntimeFeedbackSessions({ missionId, reason: `mission-${latest.mission.phase}` });
    }
    if (!rounds.length) return result;
    return {
      ...result,
      runtimeFeedback: rounds.length === 1 ? rounds[0] : rounds
    };
  }

  execute(args) {
    return this.#runWithFeedback(args.missionId, () => this.delegate.execute(args));
  }

  commitExternalTaskResult(args) {
    return this.#runWithFeedback(args.missionId, () => this.delegate.commitExternalTaskResult(args));
  }

  resumeWorker(args) {
    return this.#runWithFeedback(args.missionId, () => this.delegate.resumeWorker(args));
  }

  cancelWorker(args) {
    return this.delegate.cancelWorker(args);
  }

  retryWorker(args) {
    return this.delegate.retryWorker(args);
  }
}
