import { resolveWorkerConfig } from './worker-adapter.mjs';

const STRUCTURAL_CAPABILITIES = new Set([
  'worker-execution',
  'container-worker',
  'network-isolated',
  'read-only-rootfs',
  'codex-worker',
  'workspace-write-sandbox',
  'unconfined-worker',
  'local-worker'
]);

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function requiresDerivedProof(name) {
  return STRUCTURAL_CAPABILITIES.has(name)
    || name.startsWith('worker-type:')
    || name.startsWith('container-engine:');
}

export function workerCapabilityProfile(project, task) {
  const policy = project.workerPolicy || {};
  const declared = unique(policy.capabilities || []);
  const enabled = policy.enabled === true;
  let config = null;
  let configError = null;
  try {
    config = resolveWorkerConfig(project, task?.worker || 'default');
  } catch (error) {
    configError = { code: error?.code || 'WORKER_CONFIG_INVALID', message: String(error?.message || error).slice(0, 500) };
  }
  const type = config?.type || null;
  const derived = [];
  if (enabled && config) {
    derived.push('worker-execution', `worker-type:${type || 'custom'}`);
    if (type === 'container') {
      const engine = String(config.engine || 'docker');
      derived.push('container-worker', `container-engine:${engine}`, 'network-isolated', 'read-only-rootfs');
    } else if (type === 'codex') {
      derived.push('codex-worker', 'workspace-write-sandbox');
    } else if (type === 'custom-unconfined') {
      derived.push('unconfined-worker');
    } else {
      derived.push('local-worker');
    }
  }
  return {
    enabled,
    configured: Boolean(config),
    requestedWorker: task?.worker || 'default',
    workerType: type,
    declaredCapabilities: declared,
    derivedCapabilities: unique(derived),
    availableCapabilities: unique([...declared, ...derived]),
    configError
  };
}

export function runtimeManagedExecutionReadiness(task, project) {
  const profile = workerCapabilityProfile(project, task);
  const blockers = [];
  if (!profile.enabled) blockers.push('worker-execution-disabled');
  if (profile.enabled && !profile.configured) blockers.push(profile.configError?.code || 'worker-not-configured');
  const available = new Set(profile.availableCapabilities);
  const derived = new Set(profile.derivedCapabilities);
  const missingExecution = (task.executionCapabilities || []).filter((name) =>
    requiresDerivedProof(name) ? !derived.has(name) : !available.has(name)
  );
  return {
    ready: blockers.length === 0 && missingExecution.length === 0,
    blockers,
    missingExecution,
    profile
  };
}
