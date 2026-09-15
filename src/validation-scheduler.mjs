import { normalizeTaskCapabilityContract, runtimeResourcesConflict } from './capability-plane.mjs';

export const DEFAULT_VALIDATION_MAX_PARALLEL = 4;
export const MAX_VALIDATION_MAX_PARALLEL = 16;

function validationTier(capability) {
  if (capability?.browser || capability?.observability) return 2;
  if (capability?.service) return 1;
  return 0;
}

function inferredServiceResources(capability) {
  const readinessUrl = capability?.service?.readiness?.url;
  if (!readinessUrl) return [];
  try {
    const url = new URL(String(readinessUrl));
    const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
    if (!port) return [];
    const host = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname;
    return [{ key: `validation-port:${host}:${port}`, scope: 'global', mode: 'exclusive' }];
  } catch {
    return [];
  }
}

function validationDescriptor(capability, index) {
  const name = String(capability.name || '').trim();
  const contract = normalizeTaskCapabilityContract({
    coordinationKeys: capability.coordinationKeys,
    runtimeResources: capability.runtimeResources
  }, `validation:${name || index}`);
  return {
    name,
    index,
    tier: validationTier(capability),
    runtimeResources: [...contract.runtimeResources, ...inferredServiceResources(capability)]
  };
}

function validationContext(projectId, missionId, descriptor) {
  return { projectId, missionId, taskId: `validation:${descriptor.name}` };
}

function descriptorsConflict(left, right, projectId, missionId) {
  return runtimeResourcesConflict(
    left.runtimeResources,
    right.runtimeResources,
    validationContext(projectId, missionId, left),
    validationContext(projectId, missionId, right)
  );
}

function conflictDegree(candidate, remaining, projectId, missionId) {
  return remaining.reduce((count, other) => (
    other === candidate || !descriptorsConflict(candidate, other, projectId, missionId)
      ? count
      : count + 1
  ), 0);
}

function normalizeMaxParallel(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_VALIDATION_MAX_PARALLEL;
  return Math.min(value, MAX_VALIDATION_MAX_PARALLEL);
}

export function planValidationBatches({ required = [], catalog = [], maxParallel = DEFAULT_VALIDATION_MAX_PARALLEL, projectId = 'project', missionId = 'mission' } = {}) {
  const byName = new Map((catalog || []).map((capability) => [String(capability?.name || '').trim(), capability]));
  const missing = required.filter((name) => !byName.has(name));
  if (missing.length) {
    throw Object.assign(new Error(`Required validation capabilities are not configured: ${missing.join(', ')}`), {
      code: 'VALIDATION_CAPABILITY_NOT_FOUND',
      details: { missing }
    });
  }

  const descriptors = required.map((name, index) => validationDescriptor(byName.get(name), index));
  const limit = normalizeMaxParallel(maxParallel);
  const batches = [];
  const tiers = [...new Set(descriptors.map((item) => item.tier))].sort((a, b) => a - b);

  for (const tier of tiers) {
    let remaining = descriptors.filter((item) => item.tier === tier);
    while (remaining.length) {
      const ranked = [...remaining].sort((left, right) => {
        const conflictDelta = conflictDegree(left, remaining, projectId, missionId)
          - conflictDegree(right, remaining, projectId, missionId);
        return conflictDelta || left.index - right.index || left.name.localeCompare(right.name);
      });
      const selected = [];
      for (const candidate of ranked) {
        if (selected.length >= limit) break;
        if (selected.every((other) => !descriptorsConflict(candidate, other, projectId, missionId))) selected.push(candidate);
      }
      if (!selected.length) selected.push(ranked[0]);
      selected.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));
      batches.push({ tier, capabilities: selected.map((item) => item.name) });
      const selectedNames = new Set(selected.map((item) => item.name));
      remaining = remaining.filter((item) => !selectedNames.has(item.name));
    }
  }

  return { maxParallel: limit, batches };
}
