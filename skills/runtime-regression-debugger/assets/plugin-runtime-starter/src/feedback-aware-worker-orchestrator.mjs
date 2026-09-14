export class FeedbackAwareWorkerOrchestrator {
  constructor({ delegate, missionService, runtimeFeedbackService }) {
    this.delegate = delegate;
    this.missionService = missionService;
    this.runtimeFeedbackService = runtimeFeedbackService;
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
        rounds.push(await this.runtimeFeedbackService.runAfterWaveSafe({ missionId, waveIndex }));
      }
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
