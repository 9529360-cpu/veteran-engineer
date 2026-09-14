import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './util.mjs';

function invalidOperatorConfig(pathValue, expected, value) {
  const error = new Error(`Invalid operator config at ${pathValue}: expected ${expected}`);
  error.code = 'OPERATOR_CONFIG_INVALID';
  error.details = {
    path: pathValue,
    expected,
    actualType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  };
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertBooleanField(scope, key, pathValue) {
  if (scope[key] !== undefined && typeof scope[key] !== 'boolean') {
    throw invalidOperatorConfig(`${pathValue}.${key}`, 'boolean', scope[key]);
  }
}

function assertStringArrayField(scope, key, pathValue) {
  if (scope[key] === undefined) return;
  if (!Array.isArray(scope[key]) || scope[key].some((value) => typeof value !== 'string' || !value.trim())) {
    throw invalidOperatorConfig(`${pathValue}.${key}`, 'array of non-empty strings', scope[key]);
  }
}

function validateRuntimeFeedbackPolicy(raw, pathValue) {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw invalidOperatorConfig(pathValue, 'object', raw);
  assertBooleanField(raw, 'autoRepair', pathValue);
  assertBooleanField(raw, 'liveSession', pathValue);
  if (raw.maxRepairAttempts !== undefined && (!Number.isInteger(raw.maxRepairAttempts) || raw.maxRepairAttempts < 0 || raw.maxRepairAttempts > 3)) {
    throw invalidOperatorConfig(`${pathValue}.maxRepairAttempts`, 'integer from 0 through 3', raw.maxRepairAttempts);
  }
  if (raw.liveSessionIdleMs !== undefined && (!Number.isInteger(raw.liveSessionIdleMs) || raw.liveSessionIdleMs < 1_000 || raw.liveSessionIdleMs > 30 * 60_000)) {
    throw invalidOperatorConfig(`${pathValue}.liveSessionIdleMs`, 'integer from 1000 through 1800000', raw.liveSessionIdleMs);
  }
  return raw;
}

function validatePolicyScope(value, pathValue) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw invalidOperatorConfig(pathValue, 'object', value);

  assertBooleanField(value, 'requireSemanticReview', pathValue);
  assertBooleanField(value, 'requireValidation', pathValue);
  assertStringArrayField(value, 'validationCapabilities', pathValue);
  assertStringArrayField(value, 'requiredValidationCapabilities', pathValue);
  assertStringArrayField(value, 'runtimeFeedbackCapabilities', pathValue);
  validateRuntimeFeedbackPolicy(value.runtimeFeedbackPolicy, `${pathValue}.runtimeFeedbackPolicy`);

  const workerPolicy = value.workerPolicy;
  if (workerPolicy !== undefined && workerPolicy !== null) {
    if (!isRecord(workerPolicy)) throw invalidOperatorConfig(`${pathValue}.workerPolicy`, 'object', workerPolicy);
    for (const key of ['enabled', 'allowUnconfinedCustomWorkers', 'allowRawValidation']) {
      assertBooleanField(workerPolicy, key, `${pathValue}.workerPolicy`);
    }
    assertStringArrayField(workerPolicy, 'capabilities', `${pathValue}.workerPolicy`);
    if (workerPolicy.maxWorkers !== undefined && (!Number.isInteger(workerPolicy.maxWorkers) || workerPolicy.maxWorkers < 1)) {
      throw invalidOperatorConfig(`${pathValue}.workerPolicy.maxWorkers`, 'positive integer', workerPolicy.maxWorkers);
    }
  }
  return value;
}

function validateOperatorConfig(input = {}) {
  if (input === undefined || input === null) input = {};
  if (!isRecord(input)) throw invalidOperatorConfig('root', 'object', input);

  const defaults = validatePolicyScope(input.defaults, 'defaults');
  const rawProjects = input.projects === undefined || input.projects === null ? {} : input.projects;
  if (!isRecord(rawProjects)) throw invalidOperatorConfig('projects', 'object', rawProjects);

  const projects = {};
  for (const [key, value] of Object.entries(rawProjects)) {
    projects[key] = validatePolicyScope(value, `projects.${key}`);
  }
  return { defaults, projects };
}

export async function loadOperatorConfig({ stateRoot, configPath = process.env.VETERAN_ENGINEER_CONFIG } = {}) {
  const target = configPath ? path.resolve(configPath) : path.join(path.resolve(stateRoot), 'operator.json');
  if (!(await pathExists(target))) return { path: target, config: { defaults: {}, projects: {} } };
  const parsed = JSON.parse(await fs.readFile(target, 'utf8'));
  return { path: target, config: validateOperatorConfig(parsed) };
}

export function projectPolicy(operatorConfig, repoPath, remoteUrl = null) {
  const { defaults, projects } = validateOperatorConfig(operatorConfig || {});
  const specific = projects[repoPath] || projects[repoPath.replaceAll('\\', '/')] || (remoteUrl ? projects[remoteUrl] : null) || {};
  return {
    validationCapabilities: specific.validationCapabilities || defaults.validationCapabilities || [],
    runtimeFeedbackCapabilities: specific.runtimeFeedbackCapabilities || defaults.runtimeFeedbackCapabilities || [],
    runtimeFeedbackPolicy: {
      autoRepair: false,
      maxRepairAttempts: 1,
      ...(defaults.runtimeFeedbackPolicy || {}),
      ...(specific.runtimeFeedbackPolicy || {})
    },
    workerPolicy: {
      enabled: false,
      maxWorkers: 2,
      capabilities: [],
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
