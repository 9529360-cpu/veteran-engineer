import { TOOL_NAMES, toolInputJsonSchema } from './tool-catalog.mjs';
import { toolOutputJsonSchema } from './tool-output-contracts.mjs';
import { TOOL_WORKFLOW_RELATIONS } from './tool-workflow-relations.mjs';

export const TOOL_WORKFLOW_BINDINGS_META_KEY = 'io.veteran-engineer/workflow-bindings';
export const TOOL_WORKFLOW_BINDINGS_SCHEMA = 'veteran-tool-workflow-bindings-v1';

const SOURCE_KINDS = new Set(['arguments', 'structuredContent']);
const IDENTITY_KEYS = new Set(['projectId', 'missionId', 'taskId', 'candidateId', 'evidenceId', 'experienceId']);

function identitySource(source, pointer) {
  return Object.freeze({ source, pointer });
}

const DECLARED_IDENTITY_SOURCES = Object.freeze({
  project_open: { projectId: identitySource('structuredContent', '/id') },
  project_snapshot: { projectId: identitySource('structuredContent', '/id') },
  mission_plan: {
    projectId: identitySource('structuredContent', '/mission/projectId'),
    missionId: identitySource('structuredContent', '/mission/id')
  },
  mission_execute: { missionId: identitySource('structuredContent', '/missionId') },
  mission_status: {
    projectId: identitySource('structuredContent', '/mission/projectId'),
    missionId: identitySource('structuredContent', '/mission/id'),
    candidateId: identitySource('structuredContent', '/mission/activeCandidateId')
  },
  mission_advance: { missionId: identitySource('arguments', '/missionId') },
  mission_readiness: { missionId: identitySource('structuredContent', '/missionId') },
  mission_timeline: { missionId: identitySource('arguments', '/missionId') },
  mission_cancel: { missionId: identitySource('structuredContent', '/id') },
  mission_resume: { missionId: identitySource('structuredContent', '/id') },
  task_result_commit: {
    missionId: identitySource('structuredContent', '/missionId'),
    taskId: identitySource('structuredContent', '/taskId')
  },
  worker_cancel: {
    missionId: identitySource('structuredContent', '/missionId'),
    taskId: identitySource('structuredContent', '/taskId')
  },
  worker_resume: {
    missionId: identitySource('structuredContent', '/missionId'),
    taskId: identitySource('structuredContent', '/taskId')
  },
  worker_retry: {
    missionId: identitySource('arguments', '/missionId'),
    taskId: identitySource('arguments', '/taskId')
  },
  evidence_query: {
    projectId: identitySource('arguments', '/projectId'),
    missionId: identitySource('arguments', '/missionId'),
    taskId: identitySource('arguments', '/taskId')
  },
  validation_capabilities: { projectId: identitySource('arguments', '/projectId') },
  validation_run: {
    projectId: identitySource('arguments', '/projectId'),
    missionId: identitySource('arguments', '/missionId'),
    candidateId: identitySource('arguments', '/candidateId'),
    evidenceId: identitySource('structuredContent', '/evidenceId')
  },
  review_run: {
    missionId: identitySource('arguments', '/missionId'),
    candidateId: identitySource('arguments', '/candidateId'),
    evidenceId: identitySource('structuredContent', '/evidenceId')
  },
  semantic_review_run: {
    missionId: identitySource('arguments', '/missionId'),
    candidateId: identitySource('arguments', '/candidateId'),
    evidenceId: identitySource('structuredContent', '/evidenceId')
  },
  remediation_plan: { missionId: identitySource('structuredContent', '/missionId') },
  candidate_preflight: {
    missionId: identitySource('structuredContent', '/missionId'),
    candidateId: identitySource('structuredContent', '/candidateId')
  },
  candidate_refresh: {
    missionId: identitySource('arguments', '/missionId'),
    candidateId: identitySource('structuredContent', '/candidate/id'),
    evidenceId: identitySource('structuredContent', '/evidenceId')
  },
  candidate_status: { missionId: identitySource('structuredContent', '/missionId') },
  experience_query: { projectId: identitySource('arguments', '/projectId') },
  experience_commit: {
    projectId: identitySource('structuredContent', '/projectId'),
    experienceId: identitySource('structuredContent', '/id')
  },
  experience_review: {
    projectId: identitySource('structuredContent', '/projectId'),
    experienceId: identitySource('arguments', '/experienceId')
  },
  experience_challenge: {
    projectId: identitySource('structuredContent', '/projectId'),
    experienceId: identitySource('arguments', '/experienceId')
  },
  experience_audit: { projectId: identitySource('arguments', '/projectId') },
  experience_compact: { projectId: identitySource('arguments', '/projectId') },
  runtime_maintenance: { projectId: identitySource('arguments', '/projectId') },
  handoff_export: { missionId: identitySource('arguments', '/missionId') }
});

export const TOOL_IDENTITY_SOURCES = Object.freeze(Object.fromEntries(
  TOOL_NAMES.map((name) => [name, Object.freeze({ ...(DECLARED_IDENTITY_SOURCES[name] || {}) })])
));

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

function schemaHasPointer(schema, pointer) {
  const segments = pointerSegments(pointer);
  if (!segments) return false;
  let candidates = expandVariants(schema);
  for (const segment of segments) {
    const next = [];
    for (const candidate of candidates) {
      for (const variant of expandVariants(candidate)) {
        const child = variant?.type === 'object' ? variant.properties?.[segment] : undefined;
        if (child) next.push(...expandVariants(child));
      }
    }
    if (next.length === 0) return false;
    candidates = next;
  }
  return candidates.length > 0;
}

function sourceSchema(toolName, descriptor) {
  if (descriptor.source === 'arguments') return toolInputJsonSchema(toolName);
  if (descriptor.source === 'structuredContent') return toolOutputJsonSchema(toolName);
  return null;
}

function compileRelation(sourceTool, edge) {
  const targetSchema = toolInputJsonSchema(edge.tool);
  const targetProperties = targetSchema.properties || {};
  const bindings = [];
  for (const [identity, descriptor] of Object.entries(TOOL_IDENTITY_SOURCES[sourceTool])) {
    if (!Object.hasOwn(targetProperties, identity)) continue;
    bindings.push(Object.freeze({
      target: identity,
      source: descriptor.source,
      pointer: descriptor.pointer,
      mode: 'if-present-non-null'
    }));
  }
  const boundTargets = new Set(bindings.map((binding) => binding.target));
  const unboundRequired = (targetSchema.required || []).filter((name) => !boundTargets.has(name));
  return Object.freeze({
    tool: edge.tool,
    kind: edge.kind,
    bindings: Object.freeze(bindings),
    unboundRequired: Object.freeze(unboundRequired)
  });
}

export const TOOL_WORKFLOW_BINDINGS = Object.freeze(Object.fromEntries(
  TOOL_NAMES.map((name) => {
    const workflow = TOOL_WORKFLOW_RELATIONS[name];
    return [name, Object.freeze({
      schema: TOOL_WORKFLOW_BINDINGS_SCHEMA,
      sourceTool: name,
      copyPolicy: 'Copy a binding only when its source pointer resolves to a non-null value. Never synthesize requestId or non-identity business inputs.',
      relations: Object.freeze(workflow.relations.map((edge) => compileRelation(name, edge)))
    })];
  })
));

function assertBindingContract() {
  if (Object.keys(TOOL_IDENTITY_SOURCES).length !== TOOL_NAMES.length) {
    throw new Error(`Every public tool must have an identity-source contract; got ${Object.keys(TOOL_IDENTITY_SOURCES).length} for ${TOOL_NAMES.length} tools`);
  }
  if (Object.keys(TOOL_WORKFLOW_BINDINGS).length !== TOOL_NAMES.length) {
    throw new Error(`Every public tool must have a workflow-binding contract; got ${Object.keys(TOOL_WORKFLOW_BINDINGS).length} for ${TOOL_NAMES.length} tools`);
  }

  for (const name of TOOL_NAMES) {
    const identities = TOOL_IDENTITY_SOURCES[name];
    for (const [identity, descriptor] of Object.entries(identities)) {
      if (!IDENTITY_KEYS.has(identity)) throw new Error(`Unknown workflow identity key for ${name}: ${identity}`);
      if (!SOURCE_KINDS.has(descriptor.source)) throw new Error(`Unknown workflow binding source for ${name}.${identity}: ${descriptor.source}`);
      const schema = sourceSchema(name, descriptor);
      if (!schemaHasPointer(schema, descriptor.pointer)) {
        throw new Error(`Workflow identity source pointer does not exist for ${name}.${identity}: ${descriptor.source}${descriptor.pointer}`);
      }
      if (descriptor.source === 'structuredContent' && toolOutputJsonSchema(name).type !== 'object') {
        throw new Error(`Structured-content identity source must use an object output contract for ${name}.${identity}`);
      }
    }

    const workflow = TOOL_WORKFLOW_RELATIONS[name];
    const compiled = TOOL_WORKFLOW_BINDINGS[name];
    if (compiled.relations.length !== workflow.relations.length) {
      throw new Error(`Workflow binding relation count drift for ${name}`);
    }
    for (let index = 0; index < workflow.relations.length; index += 1) {
      const edge = workflow.relations[index];
      const bindingEdge = compiled.relations[index];
      if (bindingEdge.tool !== edge.tool || bindingEdge.kind !== edge.kind) {
        throw new Error(`Workflow binding relation drift for ${name} at index ${index}`);
      }
      const targetSchema = toolInputJsonSchema(edge.tool);
      const seenTargets = new Set();
      for (const binding of bindingEdge.bindings) {
        if (!Object.hasOwn(targetSchema.properties || {}, binding.target)) {
          throw new Error(`Workflow binding targets unknown input ${name} -> ${edge.tool}.${binding.target}`);
        }
        if (seenTargets.has(binding.target)) throw new Error(`Duplicate workflow binding target ${name} -> ${edge.tool}.${binding.target}`);
        seenTargets.add(binding.target);
      }
      const expectedUnbound = (targetSchema.required || []).filter((required) => !seenTargets.has(required));
      if (JSON.stringify(expectedUnbound) !== JSON.stringify(bindingEdge.unboundRequired)) {
        throw new Error(`Workflow unbound-required drift for ${name} -> ${edge.tool}`);
      }
    }
  }
}

assertBindingContract();

export function toolWorkflowBindingsMeta(name) {
  const bindings = TOOL_WORKFLOW_BINDINGS[name];
  if (!bindings) throw new Error(`Unknown public tool workflow-binding contract: ${name}`);
  return Object.freeze({ [TOOL_WORKFLOW_BINDINGS_META_KEY]: bindings });
}
