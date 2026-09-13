import path from 'node:path';
import { git, resolveRepository, sourceIdentity } from './git.mjs';
import { nowIso, randomId, sha256 } from './util.mjs';
import { projectPolicy } from './operator-config.mjs';

export class ProjectService {
  constructor({ store, operatorConfig = { defaults: {}, projects: {} } }) {
    this.store = store;
    this.operatorConfig = operatorConfig;
  }

  async open({ repoPath, name }) {
    const repo = await resolveRepository(repoPath);
    const identity = await sourceIdentity(repo);
    const remote = await git(repo, ['config', '--get', 'remote.origin.url'], { allowFailure: true });
    const projectKey = sha256(repo).slice(0, 24);
    const policy = projectPolicy(this.operatorConfig, repo);
    return this.store.transaction('project_opened', (state) => {
      let project = Object.values(state.projects).find((item) => item.projectKey === projectKey);
      if (!project) {
        project = {
          id: randomId('project'),
          projectKey,
          name: name || path.basename(repo),
          repoPath: repo,
          remoteUrl: remote.stdout.trim() || null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          sourceIdentity: identity,
          validationCapabilities: policy.validationCapabilities,
          workerPolicy: policy.workerPolicy,
          plannerProvider: policy.plannerProvider,
          reviewerProvider: policy.reviewerProvider,
          requireSemanticReview: policy.requireSemanticReview,
          requireValidation: policy.requireValidation,
          requiredValidationCapabilities: policy.requiredValidationCapabilities
        };
        state.projects[project.id] = project;
      } else {
        project.updatedAt = nowIso();
        project.sourceIdentity = identity;
        project.remoteUrl = remote.stdout.trim() || project.remoteUrl;
        project.validationCapabilities = policy.validationCapabilities;
        project.workerPolicy = policy.workerPolicy;
        project.plannerProvider = policy.plannerProvider;
        project.reviewerProvider = policy.reviewerProvider;
        project.requireSemanticReview = policy.requireSemanticReview;
        project.requireValidation = policy.requireValidation;
        project.requiredValidationCapabilities = policy.requiredValidationCapabilities;
      }
      return project;
    }, { repo, head: identity.head, dirty: identity.dirty });
  }

  async snapshot({ projectId }) {
    const state = await this.store.read();
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error(`Unknown project: ${projectId}`), { code: 'PROJECT_NOT_FOUND' });
    const identity = await sourceIdentity(project.repoPath);
    const result = await this.store.transaction('project_snapshotted', (working) => {
      const target = working.projects[projectId];
      target.sourceIdentity = identity;
      target.updatedAt = nowIso();
      return target;
    }, { projectId, head: identity.head, dirty: identity.dirty });
    return result;
  }

  async get(projectId) {
    const state = await this.store.read();
    const project = state.projects[projectId];
    if (!project) throw Object.assign(new Error(`Unknown project: ${projectId}`), { code: 'PROJECT_NOT_FOUND' });
    return project;
  }
}
