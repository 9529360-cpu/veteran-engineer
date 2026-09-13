import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess, git } from './git.mjs';
import { nowIso, randomId } from './util.mjs';

function normalizeCapability(raw) {
  if (!raw || typeof raw !== 'object' || !raw.name || !Array.isArray(raw.command) || raw.command.length === 0) return null;
  return {
    name: String(raw.name),
    description: String(raw.description || ''),
    command: raw.command.map(String),
    cwd: raw.cwd ? String(raw.cwd) : '.',
    timeoutMs: Math.max(1000, Number(raw.timeoutMs || 120_000))
  };
}

export class ValidationService {
  constructor({ store, projectService, missionService, worktreeManager, evidenceService }) {
    this.store = store;
    this.projectService = projectService;
    this.missionService = missionService;
    this.worktreeManager = worktreeManager;
    this.evidenceService = evidenceService;
  }

  async capabilities({ projectId }) {
    const project = await this.projectService.get(projectId);
    return (project.validationCapabilities || []).map(normalizeCapability).filter(Boolean);
  }

  async run({ projectId, missionId = null, candidateId = null, capability, rawCommand = null, confirmRawValidation = false }) {
    const project = await this.projectService.get(projectId);
    const caps = await this.capabilities({ projectId });
    let selected = caps.find((item) => item.name === capability) || null;
    if (rawCommand) {
      if (!project.workerPolicy?.allowRawValidation || confirmRawValidation !== true) {
        const error = new Error('Raw validation requires operator allowRawValidation plus explicit confirmRawValidation=true');
        error.code = 'RAW_VALIDATION_NOT_ALLOWED';
        throw error;
      }
      if (!Array.isArray(rawCommand) || rawCommand.length === 0) throw new Error('rawCommand must be a non-empty argv array');
      selected = { name: 'raw', description: 'Explicit raw validation', command: rawCommand.map(String), cwd: '.', timeoutMs: 120_000 };
    }
    if (!selected) throw Object.assign(new Error(`Unknown validation capability: ${capability}`), { code: 'VALIDATION_CAPABILITY_NOT_FOUND' });

    let commitSha;
    let mission = null;
    if (candidateId) {
      const state = await this.store.read();
      const candidate = state.runtime.candidates?.[candidateId];
      if (!candidate || candidate.projectId !== projectId) throw Object.assign(new Error(`Unknown candidate ${candidateId}`), { code: 'CANDIDATE_NOT_FOUND' });
      commitSha = candidate.commitSha;
      mission = state.missions[candidate.missionId];
    } else if (missionId) {
      ({ mission } = await this.missionService.status({ missionId }));
      const missionWt = await this.worktreeManager.ensureMissionWorktree(project, mission);
      commitSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    } else {
      commitSha = project.sourceIdentity.head;
    }

    const validationId = randomId('validation');
    const wt = path.join(this.store.worktreesDir, `validation-${validationId}`);
    await git(project.repoPath, ['worktree', 'add', '--detach', wt, commitSha]);
    let result;
    try {
      const cwd = path.resolve(wt, selected.cwd);
      const realCwd = await fs.realpath(cwd).catch(() => cwd);
      if (!realCwd.startsWith(`${path.resolve(wt)}${path.sep}`) && realCwd !== path.resolve(wt)) {
        throw Object.assign(new Error('Validation cwd escapes detached worktree'), { code: 'VALIDATION_CWD_ESCAPE' });
      }
      const [command, ...args] = selected.command;
      result = await runProcess(command, args, { cwd, timeoutMs: selected.timeoutMs, allowFailure: true });
    } finally {
      await git(project.repoPath, ['worktree', 'remove', '--force', wt], { allowFailure: true });
      await fs.rm(wt, { recursive: true, force: true });
    }
    const passed = result.code === 0;
    const evidence = await this.evidenceService.record({
      projectId,
      missionId: mission?.id || missionId,
      type: 'validation',
      summary: { capability: selected.name, passed, exitCode: result.code, commitSha },
      sourceIdentity: { head: commitSha },
      artifact: `${result.stdout}\n--- stderr ---\n${result.stderr}`,
      metadata: { candidateId }
    });
    if (missionId) {
      await this.store.transaction('mission_validation_recorded', (state) => {
        const target = state.missions[missionId];
        target.validation.status = passed ? 'passed' : 'failed';
        target.validation.evidenceIds.push(evidence.id);
        target.validation.commitSha = commitSha;
        target.updatedAt = nowIso();
        state.runtime.timeline.push({ type: 'validation_completed', missionId, at: nowIso(), passed, evidenceId: evidence.id, commitSha });
      }, { missionId, passed, capability: selected.name, commitSha });
    }
    return { passed, capability: selected.name, commitSha, evidenceId: evidence.id, exitCode: result.code };
  }
}
