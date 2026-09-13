import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './util.mjs';

export async function loadOperatorConfig({ stateRoot, configPath = process.env.VETERAN_ENGINEER_CONFIG } = {}) {
  const target = configPath ? path.resolve(configPath) : path.join(path.resolve(stateRoot), 'operator.json');
  if (!(await pathExists(target))) return { path: target, config: { defaults: {}, projects: {} } };
  const parsed = JSON.parse(await fs.readFile(target, 'utf8'));
  return { path: target, config: { defaults: parsed.defaults || {}, projects: parsed.projects || {} } };
}

export function projectPolicy(operatorConfig, repoPath, remoteUrl = null) {
  const defaults = operatorConfig?.defaults || {};
  const projects = operatorConfig?.projects || {};
  const specific = projects[repoPath] || projects[repoPath.replaceAll('\\', '/')] || (remoteUrl ? projects[remoteUrl] : null) || {};
  return {
    validationCapabilities: specific.validationCapabilities || defaults.validationCapabilities || [],
    workerPolicy: {
      enabled: false,
      maxWorkers: 2,
      allowUnconfinedCustomWorkers: false,
      allowRawValidation: false,
      ...(defaults.workerPolicy || {}),
      ...(specific.workerPolicy || {})
    },
    plannerProvider: specific.plannerProvider || defaults.plannerProvider || null,
    reviewerProvider: specific.reviewerProvider || defaults.reviewerProvider || null,
    requireSemanticReview: specific.requireSemanticReview ?? defaults.requireSemanticReview ?? false,
    requireValidation: specific.requireValidation ?? defaults.requireValidation ?? false,
    requiredValidationCapabilities: specific.requiredValidationCapabilities || defaults.requiredValidationCapabilities || []
  };
}
