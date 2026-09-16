import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_NAMES, toolInputJsonSchema } from '../src/tool-catalog.mjs';
import { TOOL_IDENTITY_SOURCES, TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import { toolWorkflowSuggestions } from '../src/tool-workflow-suggestions.mjs';

function requiredResultIdentityKeys(toolName) {
  const required = new Set(toolInputJsonSchema(toolName).required || []);
  return Object.entries(TOOL_IDENTITY_SOURCES[toolName] || {})
    .filter(([identity, descriptor]) => required.has(identity) && descriptor.source === 'structuredContent')
    .map(([identity]) => identity);
}

function requiredArgumentIdentityKeys(toolName) {
  const required = new Set(toolInputJsonSchema(toolName).required || []);
  return Object.entries(TOOL_IDENTITY_SOURCES[toolName] || {})
    .filter(([identity, descriptor]) => required.has(identity) && descriptor.source === 'arguments')
    .map(([identity]) => identity);
}

function optionalResultIdentityKeys(toolName) {
  const required = new Set(toolInputJsonSchema(toolName).required || []);
  return Object.entries(TOOL_IDENTITY_SOURCES[toolName] || {})
    .filter(([identity, descriptor]) => !required.has(identity) && descriptor.source === 'structuredContent')
    .map(([identity]) => identity);
}

function identityValue(toolName, identity) {
  return `${identity}-${toolName}`;
}

function completeRequiredIdentityArgs(toolName, extra = {}) {
  const args = Object.fromEntries(
    requiredArgumentIdentityKeys(toolName).map((identity) => [identity, identityValue(toolName, identity)])
  );
  return { ...args, ...extra };
}

test('required invocation identities backstop result-derived workflow scope only on source errors', () => {
  let inspected = 0;
  for (const toolName of TOOL_NAMES) {
    const fallbackIdentities = requiredResultIdentityKeys(toolName);
    if (fallbackIdentities.length === 0) continue;
    const args = completeRequiredIdentityArgs(toolName, Object.fromEntries(
      fallbackIdentities.map((identity) => [identity, identityValue(toolName, identity)])
    ));
    const projection = toolWorkflowSuggestions(toolName, args, {}, {
      sourceOutcome: 'error',
      sourceErrorCode: 'TEST_ERROR'
    });

    projection.suggestions.forEach((suggestion, index) => {
      const bindingEdge = TOOL_WORKFLOW_BINDINGS[toolName].relations[index];
      for (const identity of fallbackIdentities) {
        const identitySource = TOOL_IDENTITY_SOURCES[toolName][identity];
        const binding = bindingEdge.bindings.find((item) => (
          item.target === identity
          && item.source === identitySource.source
          && item.pointer === identitySource.pointer
        ));
        if (!binding) continue;
        assert.equal(
          suggestion.arguments[identity],
          args[identity],
          `${toolName} error -> ${suggestion.tool} must retain ${identity} from the required invocation scope`
        );
        assert.equal(suggestion.readiness.resultRequired.includes(identity), false);
        assert.equal(suggestion.readiness.conditionalRequired.includes(identity), false);
        inspected += 1;
      }
    });
  }
  assert.ok(inspected > 0, 'expected at least one result-derived identity to retain required invocation scope on error');
});

test('error recovery never promotes optional invocation fields into result-derived identity authority', () => {
  let inspected = 0;
  for (const toolName of TOOL_NAMES) {
    const optionalIdentities = optionalResultIdentityKeys(toolName);
    if (optionalIdentities.length === 0) continue;
    const args = completeRequiredIdentityArgs(toolName, Object.fromEntries(
      optionalIdentities.map((identity) => [identity, `spoofed-${identity}-${toolName}`])
    ));
    const projection = toolWorkflowSuggestions(toolName, args, {}, {
      sourceOutcome: 'error',
      sourceErrorCode: 'TEST_ERROR'
    });

    projection.suggestions.forEach((suggestion, index) => {
      const bindingEdge = TOOL_WORKFLOW_BINDINGS[toolName].relations[index];
      for (const identity of optionalIdentities) {
        const identitySource = TOOL_IDENTITY_SOURCES[toolName][identity];
        const binding = bindingEdge.bindings.find((item) => (
          item.target === identity
          && item.source === identitySource.source
          && item.pointer === identitySource.pointer
        ));
        if (!binding) continue;
        assert.equal(
          Object.hasOwn(suggestion.arguments, identity),
          false,
          `${toolName} error -> ${suggestion.tool} must not invent ${identity} authority from a non-required invocation field`
        );
        inspected += 1;
      }
    });
  }
  assert.ok(inspected > 0, 'expected at least one optional result-derived identity binding to remain unavailable on error');
});
