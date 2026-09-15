import { toolInputJsonSchema } from './tool-catalog.mjs';
import { TOOL_WORKFLOW_RELATIONS } from './tool-workflow-relations.mjs';
import { TOOL_WORKFLOW_BINDINGS } from './tool-workflow-bindings.mjs';

export const TOOL_WORKFLOW_SUGGESTIONS_META_KEY = 'io.veteran-engineer/workflow-suggestions';
export const TOOL_WORKFLOW_SUGGESTIONS_SCHEMA = 'veteran-tool-workflow-suggestions-v1';

function decodePointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerSegments(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').map(decodePointerSegment);
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

function bindingValue(binding, args, result) {
  const root = binding.source === 'arguments' ? args : result;
  const resolved = resolvePointer(root, binding.pointer);
  if (!resolved.found || resolved.value === null || resolved.value === undefined) return { found: false, value: undefined };
  return resolved;
}

function suggestionFor(sourceTool, index, args, result) {
  const edge = TOOL_WORKFLOW_RELATIONS[sourceTool].relations[index];
  const bindingEdge = TOOL_WORKFLOW_BINDINGS[sourceTool].relations[index];
  if (edge.tool !== bindingEdge.tool || edge.kind !== bindingEdge.kind) {
    throw new Error(`Workflow suggestion relation drift for ${sourceTool} at index ${index}`);
  }

  const targetSchema = toolInputJsonSchema(edge.tool);
  const partialArguments = {};
  for (const binding of bindingEdge.bindings) {
    const resolved = bindingValue(binding, args, result);
    if (resolved.found) partialArguments[binding.target] = resolved.value;
  }
  const missingRequired = (targetSchema.required || []).filter((name) => !Object.hasOwn(partialArguments, name));

  return Object.freeze({
    tool: edge.tool,
    kind: edge.kind,
    when: edge.when,
    arguments: Object.freeze(partialArguments),
    missingRequired: Object.freeze(missingRequired),
    argumentsComplete: missingRequired.length === 0
  });
}

export function toolWorkflowSuggestions(sourceTool, args = {}, result = {}) {
  const workflow = TOOL_WORKFLOW_RELATIONS[sourceTool];
  const bindings = TOOL_WORKFLOW_BINDINGS[sourceTool];
  if (!workflow || !bindings) throw new Error(`Unknown public tool workflow suggestion source: ${sourceTool}`);
  return Object.freeze({
    schema: TOOL_WORKFLOW_SUGGESTIONS_SCHEMA,
    sourceTool,
    invocationPolicy: 'Suggestions are partial call arguments only. Apply the relation condition before use, supply every missing required input, create a fresh requestId for mutating calls, and never treat a suggestion as authorization to invoke a tool.',
    suggestions: Object.freeze(workflow.relations.map((_edge, index) => suggestionFor(sourceTool, index, args || {}, result)))
  });
}

export function toolWorkflowSuggestionsMeta(sourceTool, args = {}, result = {}) {
  return Object.freeze({ [TOOL_WORKFLOW_SUGGESTIONS_META_KEY]: toolWorkflowSuggestions(sourceTool, args, result) });
}
