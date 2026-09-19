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

const REMOTE_RUNTIME_WIDE_PROJECT_TOOLS = new Set(['runtime_cleanup']);
const REMOTE_OPTIONAL_GLOBAL_PROJECT_TOOLS = new Set(['evidence_query', 'experience_audit', 'runtime_maintenance']);

function remoteScopeError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function requireStoredRecord(record, kind, id) {
  if (record) return record;
  throw remoteScopeError('REMOTE_PROJECT_SCOPE_UNRESOLVED', `Remote Host could not resolve ${kind} scope`, { kind, id: String(id || '') });
}

async function assertRemoteProjectAllowed(projectId, state, config) {
  const project = requireStoredRecord(state.projects?.[projectId], 'project', projectId);
  if (project.sourceKind === 'managed-remote' || project.managedCheckout === true) return project;
  if (typeof project.repoPath !== 'string' || !project.repoPath.trim()) {
    throw remoteScopeError('REMOTE_PROJECT_SCOPE_UNRESOLVED', 'Remote Host project has no local repository path', { projectId });
  }
  await assertLocalPathAllowed(project.repoPath, config.allowedLocalRoots, { label: 'project repository path' });
  return project;
}

async function authorizeStoredRemoteScope(name, args, config, app) {
  if (!app?.store?.read) throw remoteScopeError('REMOTE_PROJECT_SCOPE_UNAVAILABLE', 'Remote Host state scope is unavailable');
  const state = await app.store.read();
  const projectIds = new Set();
  const addProjectId = (projectId) => {
    if (typeof projectId === 'string' && projectId) projectIds.add(projectId);
  };

  addProjectId(args?.projectId);

  if (typeof args?.missionId === 'string' && args.missionId) {
    const mission = requireStoredRecord(state.missions?.[args.missionId], 'mission', args.missionId);
    addProjectId(mission.projectId);
  }
  if (typeof args?.candidateId === 'string' && args.candidateId) {
    const candidate = requireStoredRecord(state.runtime?.candidates?.[args.candidateId], 'candidate', args.candidateId);
    addProjectId(candidate.projectId);
  }
  if (typeof args?.experienceId === 'string' && args.experienceId) {
    const experience = requireStoredRecord(state.experiences?.[args.experienceId], 'experience', args.experienceId);
    addProjectId(experience.projectId);
  }

  const evidenceIds = [];
  if (name === 'evidence_query' && Array.isArray(args?.ids)) evidenceIds.push(...args.ids);
  if (Array.isArray(args?.evidenceIds)) evidenceIds.push(...args.evidenceIds);
  for (const evidenceId of evidenceIds) {
    const evidence = requireStoredRecord(state.evidence?.[evidenceId], 'evidence', evidenceId);
    addProjectId(evidence.projectId);
  }

  const requiresAllProjects = REMOTE_RUNTIME_WIDE_PROJECT_TOOLS.has(name)
    || (REMOTE_OPTIONAL_GLOBAL_PROJECT_TOOLS.has(name) && projectIds.size === 0);
  if (requiresAllProjects) {
    for (const projectId of Object.keys(state.projects || {})) addProjectId(projectId);
  }

  for (const projectId of projectIds) await assertRemoteProjectAllowed(projectId, state, config);
  return args || {};
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

export async function authorizeRemoteToolInput(name, args, config, app = null) {
  if (name !== 'project_open') return authorizeStoredRemoteScope(name, args || {}, config, app);
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
          const authorizedArgs = await authorizeRemoteToolInput(tool.name, args || {}, config, app);
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
