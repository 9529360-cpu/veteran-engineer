import { fileURLToPath, pathToFileURL } from 'node:url';
import { createVeteranApp } from './app.mjs';
import { RUNTIME_NAME, RUNTIME_VERSION } from './constants.mjs';
import { MCP_TRANSPORT_MODES } from './mcp-protocol-capability.mjs';
import { TOOL_DEFINITIONS, TOOL_NAMES, toolInputZodSchema } from './tool-catalog.mjs';
import { toolOutputStructuredContent, toolOutputZodSchema } from './tool-output-contracts.mjs';
import { toolAnnotations } from './tool-annotations.mjs';
import { toolWorkflowMeta } from './tool-workflow-relations.mjs';
import { toolWorkflowBindingsMeta } from './tool-workflow-bindings.mjs';
import { assertCurrentWorkflowBindingTypeSafety } from './tool-workflow-binding-type-safety.mjs';
import { toolWorkflowSuggestionsMeta, toolWorkflowErrorSuggestionsMeta } from './tool-workflow-suggestions.mjs';
import { assertMcpSdkIntegrity, inspectMcpSdkIntegrity } from './mcp-sdk-integrity.mjs';
import { assertLocalPathAllowed } from './workspace-policy.mjs';

const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
assertCurrentWorkflowBindingTypeSafety();

function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
}

export function remoteMcpErrorPayload(error) {
  return {
    code: error?.code || 'ERROR',
    message: error?.message || String(error),
    details: error?.details
  };
}

function toolMeta(name) {
  return { ...toolWorkflowMeta(name), ...toolWorkflowBindingsMeta(name) };
}

function toolErrorResult(name, args, error) {
  const payload = remoteMcpErrorPayload(error);
  return {
    isError: true,
    content: [{ type: 'text', text: jsonSafe(payload) }],
    ...(TOOL_NAMES.includes(name) ? { _meta: toolWorkflowErrorSuggestionsMeta(name, args || {}, payload.code) } : {})
  };
}

export async function assertRemoteMcpSdkReady() {
  const integrity = await inspectMcpSdkIntegrity(runtimeRoot);
  if (integrity.status !== 'verified') assertMcpSdkIntegrity(integrity);
  return integrity;
}

export async function authorizeRemoteToolInput(name, args, config) {
  if (name !== 'project_open') return args || {};
  const next = { ...(args || {}) };
  if (typeof next.repoPath === 'string' && next.repoPath.trim()) {
    next.repoPath = await assertLocalPathAllowed(next.repoPath, config.allowedLocalRoots, { label: 'project repository path' });
  }
  if (typeof next.repoUrl === 'string' && next.repoUrl.trim()) {
    let url = null;
    try { url = new URL(next.repoUrl); } catch {}
    if (url?.protocol === 'file:') {
      const allowed = await assertLocalPathAllowed(fileURLToPath(url), config.allowedLocalRoots, { label: 'file repository URL' });
      next.repoUrl = pathToFileURL(allowed).href;
    }
  }
  return next;
}

export async function createRemoteVeteranApp({ config, stateRoot = null, app = null } = {}) {
  if (app) return app;
  if (!config) throw new TypeError('config is required');
  return createVeteranApp({
    stateRoot: stateRoot || config.stateRoot,
    protocolMode: MCP_TRANSPORT_MODES.OFFICIAL_SDK,
    surfaceProfile: 'secure-tunnel'
  });
}

export async function createRemoteMcpServerFactory({ config, app }) {
  if (!config) throw new TypeError('config is required');
  if (!app) throw new TypeError('app is required');
  const [{ McpServer }, zod] = await Promise.all([
    import('@modelcontextprotocol/server'),
    import('zod')
  ]);
  const z = zod.z || zod.default || zod;
  return () => {
    const server = new McpServer({ name: RUNTIME_NAME, version: RUNTIME_VERSION });
    for (const tool of TOOL_DEFINITIONS) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: toolInputZodSchema(z, tool.name),
        outputSchema: toolOutputZodSchema(z, tool.name),
        annotations: toolAnnotations(tool.name),
        _meta: toolMeta(tool.name)
      }, async (args) => {
        try {
          const authorizedArgs = await authorizeRemoteToolInput(tool.name, args || {}, config);
          const result = await app.callTool(tool.name, authorizedArgs);
          const extraContent = await app.toolContent(tool.name, authorizedArgs, result);
          return {
            content: [{ type: 'text', text: jsonSafe(result) }, ...extraContent],
            structuredContent: toolOutputStructuredContent(tool.name, result),
            _meta: toolWorkflowSuggestionsMeta(tool.name, authorizedArgs, result)
          };
        } catch (error) {
          return toolErrorResult(tool.name, args || {}, error);
        }
      });
    }
    return server;
  };
}
