import { experienceReviewActionsForStatus } from './experience-lifecycle.mjs';
import { toolInputJsonSchema } from './tool-catalog.mjs';
import { toolOutputJsonSchema } from './tool-output-contracts.mjs';

const EXPERIENCE_REVIEW_TARGET = 'experience_review';
const ACTION_TARGET = 'action';
const EXPERIENCE_ID_TARGET = 'experienceId';

function decodePointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerSegments(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').map(decodePointerSegment);
}

function expandVariants(schema) {
  if (Array.isArray(schema?.anyOf) && schema.anyOf.length) return schema.anyOf.flatMap(expandVariants);
  return [schema];
}

function schemasAtPointer(schema, pointer) {
  const segments = pointerSegments(pointer);
  if (!segments) return [];
  let candidates = expandVariants(schema);
  for (const segment of segments) {
    const next = [];
    for (const candidate of candidates) {
      for (const variant of expandVariants(candidate)) {
        const child = variant?.type === 'object' ? variant.properties?.[segment] : undefined;
        if (child) next.push(...expandVariants(child));
      }
    }
    if (next.length === 0) return [];
    candidates = next;
  }
  return candidates;
}

function schemaHasPointer(schema, pointer) {
  return schemasAtPointer(schema, pointer).length > 0;
}

function arrayItemSchemasAtPointer(schema, collectionPointer) {
  return schemasAtPointer(schema, collectionPointer)
    .filter((candidate) => candidate?.type === 'array' && candidate.items)
    .flatMap((candidate) => expandVariants(candidate.items));
}

function itemPointerExists(schema, collectionPointer, itemPointer) {
  const itemSchemas = arrayItemSchemasAtPointer(schema, collectionPointer);
  if (!itemSchemas.length) return false;
  if (itemPointer === '') return true;
  return itemSchemas.some((itemSchema) => schemaHasPointer(itemSchema, itemPointer));
}

function resolvePointer(root, pointer) {
  const segments = pointerSegments(pointer);
  if (!segments) return { found: false, value: undefined };
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined || (typeof current !== 'object' && typeof current !== 'function')) {
      return { found: false, value: undefined };
    }
    if (!Object.hasOwn(current, segment)) return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = `${typeof value}:${JSON.stringify(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function group(selectionValue, status) {
  return Object.freeze({
    when: Object.freeze({ target: EXPERIENCE_ID_TARGET, equals: selectionValue }),
    sourceState: status,
    candidates: Object.freeze([...experienceReviewActionsForStatus(status)])
  });
}

function auditActionSelection(result) {
  const groups = [];
  if (Array.isArray(result)) {
    for (const item of result) {
      if (!item || item.id === null || item.id === undefined || item.status === null || item.status === undefined) continue;
      const candidateGroup = group(item.id, item.status);
      if (candidateGroup.candidates.length) groups.push(candidateGroup);
    }
  }
  return Object.freeze({
    target: ACTION_TARGET,
    cardinality: 'one',
    requiredForRelation: true,
    dependsOn: Object.freeze({ target: EXPERIENCE_ID_TARGET }),
    candidates: Object.freeze([]),
    candidateGroups: Object.freeze(groups),
    reason: 'After selecting experienceId, explicitly select one lifecycle action published for that experience current status. Actions are projected from the shared Experience lifecycle authority and are never auto-bound.'
  });
}

function compactActionSelection(result) {
  const kept = Array.isArray(result?.kept) ? result.kept : [];
  const groups = uniqueValues(kept)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => group(value, 'candidate'));
  return Object.freeze({
    target: ACTION_TARGET,
    cardinality: 'one',
    requiredForRelation: true,
    dependsOn: Object.freeze({ target: EXPERIENCE_ID_TARGET }),
    candidates: Object.freeze([]),
    candidateGroups: Object.freeze(groups),
    reason: 'After selecting a retained candidate experienceId, explicitly select one lifecycle action published for candidate state. Actions are projected from the shared Experience lifecycle authority and are never auto-bound.'
  });
}

export function dependentWorkflowSelections(sourceTool, edge, result) {
  if (edge.tool !== EXPERIENCE_REVIEW_TARGET || edge.kind !== 'next') return Object.freeze([]);
  if (sourceTool === 'experience_audit') return Object.freeze([auditActionSelection(result)]);
  if (sourceTool === 'experience_compact') return Object.freeze([compactActionSelection(result)]);
  return Object.freeze([]);
}

function assertReviewActionTarget() {
  const target = toolInputJsonSchema(EXPERIENCE_REVIEW_TARGET).properties?.[ACTION_TARGET];
  if (!target || target.type !== 'string' || !Array.isArray(target.enum)) {
    throw new Error('Dependent workflow action discovery requires experience_review.action to remain a string enum');
  }
  const enumValues = new Set(target.enum);
  for (const status of ['candidate', 'active', 'challenged', 'retired']) {
    for (const action of experienceReviewActionsForStatus(status)) {
      if (!enumValues.has(action)) throw new Error(`Experience lifecycle action missing from experience_review.action enum: ${action}`);
    }
  }
}

function assertAuditSourceContract() {
  const natural = toolOutputJsonSchema('experience_audit');
  const legacy = toolOutputJsonSchema('experience_audit', { legacyEnvelope: true });
  for (const [schema, collectionPointer] of [[natural, ''], [legacy, '/result']]) {
    if (!itemPointerExists(schema, collectionPointer, '/id')) {
      throw new Error(`Experience audit dependent selection id pointer missing: ${collectionPointer}/id`);
    }
    if (!itemPointerExists(schema, collectionPointer, '/status')) {
      throw new Error(`Experience audit dependent selection status pointer missing: ${collectionPointer}/status`);
    }
  }
}

function assertCompactSourceContract() {
  const natural = toolOutputJsonSchema('experience_compact');
  const legacy = toolOutputJsonSchema('experience_compact', { legacyEnvelope: true });
  for (const [schema, collectionPointer] of [[natural, '/kept'], [legacy, '/result/kept']]) {
    if (!itemPointerExists(schema, collectionPointer, '')) {
      throw new Error(`Experience compact dependent selection pointer missing: ${collectionPointer}`);
    }
  }
  if (experienceReviewActionsForStatus('candidate').length === 0) {
    throw new Error('Experience candidate lifecycle state must expose at least one review action');
  }
}

assertReviewActionTarget();
assertAuditSourceContract();
assertCompactSourceContract();
