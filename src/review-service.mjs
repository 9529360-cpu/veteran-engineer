import { allowlistedProcessEnvironment, runProcess, git } from './git.mjs';
import { nowIso, randomId, redactKnownSecrets } from './util.mjs';

export class ReviewService {
  constructor({ store, projectService, missionService, worktreeManager, evidenceService, experienceService = null }) {
    this.store = store;
    this.projectService = projectService;
    this.missionService = missionService;
    this.worktreeManager = worktreeManager;
    this.evidenceService = evidenceService;
    this.experienceService = experienceService;
  }

  async deterministic({ missionId, candidateId = null }) {
    const { mission, tasks } = await this.missionService.status({ missionId });
    const project = await this.projectService.get(mission.projectId);
    let head;
    let reviewBase = mission.baseSourceIdentity.head;
    if (candidateId) {
      const state = await this.store.read();
      const candidate = state.runtime.candidates?.[candidateId];
      if (!candidate || candidate.missionId !== missionId) throw Object.assign(new Error(`Unknown candidate ${candidateId}`), { code: 'CANDIDATE_NOT_FOUND' });
      head = candidate.commitSha;
      reviewBase = candidate.sourceHead;
    } else {
      const wt = await this.worktreeManager.ensureMissionWorktree(project, mission);
      head = (await git(wt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    }
    const diff = await git(project.repoPath, ['diff', '--check', `${reviewBase}..${head}`], { allowFailure: true });
    const names = (await git(project.repoPath, ['diff', '--name-status', '-z', `${reviewBase}..${head}`])).stdout.split('\0').filter(Boolean);
    const patch = (await git(project.repoPath, ['diff', '--no-ext-diff', '--unified=3', `${reviewBase}..${head}`])).stdout;
    const findings = [];
    if (diff.code !== 0 || diff.stdout.trim() || diff.stderr.trim()) findings.push({ severity: 'high', code: 'DIFF_CHECK_FAILED', message: (diff.stdout || diff.stderr).trim().slice(0, 2000) });
    if (/^<<<<<<< |^=======\s*$|^>>>>>>> /m.test(patch)) findings.push({ severity: 'critical', code: 'CONFLICT_MARKER', message: 'Conflict marker found in whole-change diff' });
    const incomplete = tasks.filter((task) => task.status !== 'done');
    if (incomplete.length) findings.push({ severity: 'high', code: 'TASKS_INCOMPLETE', taskIds: incomplete.map((task) => task.id) });
    const passed = findings.every((item) => !['high', 'critical'].includes(item.severity));
    const evidence = await this.evidenceService.record({
      projectId: project.id,
      missionId,
      type: 'review',
      summary: { passed, head, reviewBase, changedEntries: names.length, findings },
      sourceIdentity: { head },
      artifact: patch,
      metadata: { candidateId }
    });
    await this.store.transaction('deterministic_review_completed', (state) => {
      const target = state.missions[missionId];
      target.review.status = passed ? 'passed' : 'failed';
      target.review.findings = findings;
      target.review.evidenceIds.push(evidence.id);
      target.review.commitSha = head;
      target.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'deterministic_review_completed', missionId, at: nowIso(), passed, evidenceId: evidence.id, head });
    }, { missionId, passed, head });
    return { passed, head, reviewBase, findings, evidenceId: evidence.id };
  }

  async semantic({ missionId, candidateId = null }) {
    const { mission } = await this.missionService.status({ missionId });
    const project = await this.projectService.get(mission.projectId);
    const provider = project.reviewerProvider || null;
    let head;
    if (candidateId) {
      const state = await this.store.read();
      const candidate = state.runtime.candidates?.[candidateId];
      if (!candidate || candidate.missionId !== missionId) throw Object.assign(new Error(`Unknown candidate ${candidateId}`), { code: 'CANDIDATE_NOT_FOUND' });
      head = candidate.commitSha;
    } else {
      const wt = await this.worktreeManager.ensureMissionWorktree(project, mission);
      head = (await git(wt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    }
    if (!provider?.command) {
      const passed = project.requireSemanticReview !== true;
      const evidence = await this.evidenceService.record({ projectId: project.id, missionId, type: 'semantic-review', summary: { passed, skipped: true, reason: 'provider-not-configured', head }, sourceIdentity: { head } });
      await this.store.transaction('semantic_review_completed', (state) => {
        const target = state.missions[missionId];
        target.semanticReview.status = passed ? 'skipped' : 'blocked';
        target.semanticReview.findings = passed ? [] : [{ severity: 'high', code: 'SEMANTIC_REVIEWER_REQUIRED' }];
        target.semanticReview.evidenceIds.push(evidence.id);
        target.semanticReview.commitSha = head;
        target.updatedAt = nowIso();
      }, { missionId, passed, skipped: true });
      return { passed, skipped: true, reason: 'provider-not-configured', head, evidenceId: evidence.id };
    }
    const experience = this.experienceService
      ? await this.experienceService.route({ projectId: project.id, sourceHead: head, role: 'reviewer', limit: 8 })
      : { items: [], precedence: 'Current repository/runtime evidence outranks project experience.' };
    const payload = {
      protocol: 'veteran-reviewer-v1',
      mission: { id: mission.id, goal: mission.goal, doneDefinition: mission.doneDefinition, baseHead: mission.baseSourceIdentity.head, head },
      projectExperience: experience.items,
      experiencePrecedence: experience.precedence,
      reviewPolicy: [
        'Review the whole semantic change, not style in isolation. Look for new authorities, state machines, stores, services, wrappers, adapters, extension points, or dependencies that lack a distinct responsibility, lifecycle, or repeated semantic contract.',
        'Flag parallel sources of truth, duplicate state machines, wrapper-on-wrapper indirection, speculative generic interfaces, and product policy hidden behind generic plumbing when a simpler existing owner can safely carry the behavior.',
        'Check negative space after the change: obsolete branches, superseded compatibility, redundant helpers, duplicate tests, old owners, and temporary scaffolding should be removed when their live consumer is gone.',
        'Do not recommend simplification that erases real authorization, concurrency, durability, failure-recovery, observability, compatibility, isolation, or cleanup guarantees.',
        'Treat complexity as justified when current repository evidence demonstrates a distinct correctness boundary; do not report mere line count, file size, or personal style preference as a finding.'
      ],
      limits: { maxFindings: 20, maxRemediationTasks: 8 }
    };
    const providerEnv = allowlistedProcessEnvironment(provider.envAllowlist || []);
    const providerSecrets = (provider.envAllowlist || [])
      .map((key) => providerEnv[key.trim()])
      .filter((value) => typeof value === 'string' && value.length > 0);
    const result = await runProcess(provider.command, provider.args || [], {
      cwd: project.repoPath,
      env: providerEnv,
      inheritEnv: false,
      input: JSON.stringify(payload),
      allowFailure: true,
      timeoutMs: provider.timeoutMs || 180_000
    });
    let parsed = null;
    try { parsed = redactKnownSecrets(JSON.parse(result.stdout), providerSecrets); } catch { /* handled below */ }
    const safeStderr = redactKnownSecrets(result.stderr, providerSecrets);
    const findings = Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 20) : [{ severity: 'high', code: 'SEMANTIC_REVIEWER_INVALID_OUTPUT', message: safeStderr.slice(0, 1000) }];
    const passed = result.code === 0 && parsed?.passed === true && findings.every((item) => item.severity !== 'critical');
    const artifact = parsed
      ? `${JSON.stringify(parsed, null, 2)}\n--- stderr ---\n${safeStderr}`
      : `semantic reviewer returned invalid JSON\n--- stderr ---\n${safeStderr}`;
    const evidence = await this.evidenceService.record({ projectId: project.id, missionId, type: 'semantic-review', summary: { passed, head, findings }, sourceIdentity: { head }, artifact });
    await this.store.transaction('semantic_review_completed', (state) => {
      const target = state.missions[missionId];
      target.semanticReview.status = passed ? 'passed' : 'failed';
      target.semanticReview.findings = findings;
      target.semanticReview.evidenceIds.push(evidence.id);
      target.semanticReview.commitSha = head;
      target.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'semantic_review_completed', missionId, at: nowIso(), passed, evidenceId: evidence.id, head });
    }, { missionId, passed, head });
    return { passed, head, findings, evidenceId: evidence.id };
  }

  async remediationPlan({ missionId, findings = null, maxTasks = 8 }) {
    const { mission } = await this.missionService.status({ missionId });
    const source = findings || [...(mission.review.findings || []), ...(mission.semanticReview.findings || [])];
    const bounded = source.filter((item) => ['medium', 'high', 'critical'].includes(item.severity || 'high')).slice(0, Math.max(1, Math.min(maxTasks, 8)));
    const plan = {
      id: randomId('remediation'),
      createdAt: nowIso(),
      findings: bounded,
      tasks: bounded.map((finding, index) => ({
        id: `R${index + 1}`,
        contract: `Resolve ${finding.code || 'review finding'} without expanding mission scope`,
        sourceFinding: finding,
        status: 'proposed'
      }))
    };
    await this.store.transaction('remediation_plan_created', (state) => {
      const target = state.missions[missionId];
      target.remediationPlans ||= [];
      target.remediationPlans.push(plan);
      target.updatedAt = nowIso();
      state.runtime.timeline.push({ type: 'remediation_plan_created', missionId, remediationPlanId: plan.id, at: nowIso() });
    }, { missionId, remediationPlanId: plan.id, taskCount: plan.tasks.length });
    return plan;
  }
}
