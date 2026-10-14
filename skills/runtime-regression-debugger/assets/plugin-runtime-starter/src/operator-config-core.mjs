import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './util.mjs';
import { DEFAULT_VALIDATION_MAX_PARALLEL, MAX_VALIDATION_MAX_PARALLEL } from './validation-scheduler.mjs';

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

function validateProcessProviderField(scope, key, pathValue) {
  if (scope[key] === undefined || scope[key] === null) return;
  const provider = scope[key];
  const providerPath = `${pathValue}.${key}`;
  if (!isRecord(provider)) throw invalidOperatorConfig(providerPath, 'provider object', provider);
  const hasExecutionFields = ['args', 'envAllowlist', 'timeoutMs'].some((field) => provider[field] !== undefined);
  if (provider.command === undefined && !hasExecutionFields) return;
  if (typeof provider.command !== 'string' || !provider.command.trim()) {
    throw invalidOperatorConfig(`${providerPath}.command`, 'non-empty string', provider.command);
  }
  if (provider.args !== undefined && (!Array.isArray(provider.args) || provider.args.some((value) => typeof value !== 'string'))) {
    throw invalidOperatorConfig(`${providerPath}.args`, 'array of strings', provider.args);
  }
  assertStringArrayField(provider, 'envAllowlist', providerPath);
  if (provider.timeoutMs !== undefined && (!Number.isInteger(provider.timeoutMs) || provider.timeoutMs < 1)) {
    throw invalidOperatorConfig(`${providerPath}.timeoutMs`, 'positive integer', provider.timeoutMs);
  }
}

function assertValidationCapabilitiesField(scope, key, pathValue) {
  if (scope[key] === undefined) return;
  const capabilities = scope[key];
  if (!Array.isArray(capabilities)) {
    throw invalidOperatorConfig(`${pathValue}.${key}`, 'array of validation capability objects', capabilities);
  }
  const seenNames = new Set();
  for (let index = 0; index < capabilities.length; index += 1) {
    const capability = capabilities[index];
    if (!isRecord(capability)) {
      throw invalidOperatorConfig(`${pathValue}.${key}[${index}]`, 'validation capability object', capability);
    }
    if (typeof capability.name !== 'string' || !capability.name.trim()) {
      throw invalidOperatorConfig(`${pathValue}.${key}[${index}].name`, 'non-empty string', capability.name);
    }
    const normalizedName = capability.name.trim();
    if (seenNames.has(normalizedName)) {
      throw invalidOperatorConfig(`${pathValue}.${key}[${index}].name`, 'unique non-empty string', capability.name);
    }
    seenNames.add(normalizedName);
  }
}

function normalizedStringArray(values = []) {
  return [...new Set(values.map((value) => value.trim()))];
}

function normalizedValidationCapabilities(values = []) {
  return values.map((capability) => ({ ...capability, name: capability.name.trim() }));
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

function validateValidationPolicy(raw, pathValue) {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw invalidOperatorConfig(pathValue, 'object', raw);
  if (raw.maxParallel !== undefined && (!Number.isInteger(raw.maxParallel) || raw.maxParallel < 1 || raw.maxParallel > MAX_VALIDATION_MAX_PARALLEL)) {
    throw invalidOperatorConfig(`${pathValue}.maxParallel`, `integer from 1 through ${MAX_VALIDATION_MAX_PARALLEL}`, raw.maxParallel);
  }
  return raw;
}

function validatePolicyScope(value, pathValue) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw invalidOperatorConfig(pathValue, 'object', value);

  assertBooleanField(value, 'requireSemanticReview', pathValue);
  assertBooleanField(value, 'requireValidation', pathValue);
  assertValidationCapabilitiesField(value, 'validationCapabilities', pathValue);
  assertStringArrayField(value, 'requiredValidationCapabilities', pathValue);
  assertStringArrayField(value, 'runtimeFeedbackCapabilities', pathValue);
  validateRuntimeFeedbackPolicy(value.runtimeFeedbackPolicy, `${pathValue}.runtimeFeedbackPolicy`);
  validateValidationPolicy(value.validationPolicy, `${pathValue}.validationPolicy`);
  validateProcessProviderField(value, 'plannerProvider', pathValue);
  validateProcessProviderField(value, 'reviewerProvider', pathValue);

  const workerPolicy = value.workerPolicy;
  if (workerPolicy !== undefined && workerPolicy !== null) {
    if (!isRecord(workerPolicy)) throw invalidOperatorConfig(`${pathValue}.workerPolicy`, 'object', workerPolicy);
    for (const key of ['enabled', 'allowUnconfinedCustomWorkers', 'allowRawValidation']) {
      assertBooleanField(workerPolicy, key, `${pathValue}.workerPolicy`);
    }
    assertStringArrayField(workerPolicy, 'capabilities', `${pathValue}.workerPolicy`);
    if (workerPolicy.maxWorkers !== undefined && workerPolicy.maxWorkers !== null && (!Number.isInteger(workerPolicy.maxWorkers) || workerPolicy.maxWorkers < 1)) {
      throw invalidOperatorConfig(`${pathValue}.workerPolicy.maxWorkers`, 'positive integer or null (auto)', workerPolicy.maxWorkers);
    }
    if (workerPolicy.memoryMiBPerWorker !== undefined && (!Number.isInteger(workerPolicy.memoryMiBPerWorker) || workerPolicy.memoryMiBPerWorker < 64)) {
      throw invalidOperatorConfig(`${pathValue}.workerPolicy.memoryMiBPerWorker`, 'integer >=64', workerPolicy.memoryMiBPerWorker);
    }
    if (workerPolicy.adaptiveSelection !== undefined) {
      const selection = workerPolicy.adaptiveSelection;
      if (!isRecord(selection)) throw invalidOperatorConfig(`${pathValue}.workerPolicy.adaptiveSelection`, 'object', selection);
      assertBooleanField(selection, 'enabled', `${pathValue}.workerPolicy.adaptiveSelection`);
      if (selection.candidates !== undefined) {
        if (!Array.isArray(selection.candidates) || selection.candidates.length > 128
          || selection.candidates.some((name) => typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(name)
            || ['__proto__', 'constructor', 'prototype'].includes(name))
          || new Set(selection.candidates).size !== selection.candidates.length) {
          throw invalidOperatorConfig(`${pathValue}.workerPolicy.adaptiveSelection.candidates`, 'unique array of up to 128 named authorized Worker keys', selection.candidates);
        }
      }
    }
    if (workerPolicy.nativeAgent !== undefined) {
      const native = workerPolicy.nativeAgent;
      if (!isRecord(native)) throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent`, 'object', native);
      for (const name of ['model', 'baseURL']) {
        if (typeof native[name] !== 'string' || !native[name].trim()) {
          throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.${name}`, 'non-empty string', native[name]);
        }
      }
      if (native.apiKeyEnv !== undefined && (typeof native.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(native.apiKeyEnv))) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.apiKeyEnv`, 'environment-variable name', native.apiKeyEnv);
      }
      if (native.maxTurns !== undefined && (!Number.isInteger(native.maxTurns) || native.maxTurns < 1 || native.maxTurns > 256)) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.maxTurns`, 'integer 1-256', native.maxTurns);
      }
      if (native.plannerMaxTurns !== undefined && (!Number.isInteger(native.plannerMaxTurns) || native.plannerMaxTurns < 1 || native.plannerMaxTurns > 256)) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.plannerMaxTurns`, 'integer 1-256', native.plannerMaxTurns);
      }
      if (native.modelTimeoutMs !== undefined && (!Number.isInteger(native.modelTimeoutMs) || native.modelTimeoutMs < 1 || native.modelTimeoutMs > 600_000)) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.modelTimeoutMs`, 'integer 1-600000', native.modelTimeoutMs);
      }
      if (native.advisorCapacity !== undefined && (!Number.isInteger(native.advisorCapacity) || native.advisorCapacity < 0)) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.advisorCapacity`, 'non-negative integer', native.advisorCapacity);
      }
      if (native.timeoutMs !== undefined && (!Number.isInteger(native.timeoutMs) || native.timeoutMs < 1 || native.timeoutMs > 2_147_483_647)) {
        throw invalidOperatorConfig(`${pathValue}.workerPolicy.nativeAgent.timeoutMs`, 'positive integer', native.timeoutMs);
      }
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
  const validationCapabilities = normalizedValidationCapabilities(specific.validationCapabilities || defaults.validationCapabilities || []);
  const runtimeFeedbackCapabilities = normalizedStringArray(specific.runtimeFeedbackCapabilities || defaults.runtimeFeedbackCapabilities || []);
  const requiredValidationCapabilities = normalizedStringArray(specific.requiredValidationCapabilities || defaults.requiredValidationCapabilities || []);
  const workerPolicy = {
    enabled: false,
    maxWorkers: null,
    memoryMiBPerWorker: 512,
    capabilities: [],
    allowUnconfinedCustomWorkers: false,
    allowRawValidation: false,
    ...(defaults.workerPolicy || {}),
    ...(specific.workerPolicy || {})
  };
  workerPolicy.capabilities = normalizedStringArray(workerPolicy.capabilities || []);
  workerPolicy.adaptiveSelection = {
    enabled: false,
    ...(defaults.workerPolicy?.adaptiveSelection || {}),
    ...(specific.workerPolicy?.adaptiveSelection || {})
  };
  return {
    validationCapabilities,
    validationPolicy: {
      maxParallel: DEFAULT_VALIDATION_MAX_PARALLEL,
      ...(defaults.validationPolicy || {}),
      ...(specific.validationPolicy || {})
    },
    runtimeFeedbackCapabilities,
    runtimeFeedbackPolicy: {
      autoRepair: false,
      maxRepairAttempts: 1,
      ...(defaults.runtimeFeedbackPolicy || {}),
      ...(specific.runtimeFeedbackPolicy || {})
    },
    workerPolicy,
    plannerProvider: specific.plannerProvider || defaults.plannerProvider || null,
    reviewerProvider: specific.reviewerProvider || defaults.reviewerProvider || null,
    requireSemanticReview: specific.requireSemanticReview ?? defaults.requireSemanticReview ?? false,
    requireValidation: specific.requireValidation ?? defaults.requireValidation ?? false,
    requiredValidationCapabilities
  };
}
