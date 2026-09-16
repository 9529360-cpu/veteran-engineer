import crypto from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
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
import { readRemoteHostConfig, tokenDigest } from './remote-host-config.mjs';
import { assertLocalPathAllowed } from './workspace-policy.mjs';

const MAX_REMOTE_REQUEST_BYTES = 8 * 1024 * 1024;
assertCurrentWorkflowBindingTypeSafety();

function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
}

function errorPayload(error) {
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
  const payload = errorPayload(error);
  return {
    isError: true,
    content: [{ type: 'text', text: jsonSafe(payload) }],
    ...(TOOL_NAMES.includes(name) ? { _meta: toolWorkflowErrorSuggestionsMeta(name, args || {}, payload.code) } : {})
  };
}

function hostnameFromHostHeader(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    return close > 1 ? text.slice(1, close).toLowerCase() : null;
  }
  return text.split(':')[0].toLowerCase();
}

function requestHostAllowed(req, config) {
  const hostname = hostnameFromHostHeader(req.headers.host);
  if (!hostname) return false;
  return config.allowedHosts.map((item) => String(item).toLowerCase()).includes(hostname);
}

function requestOriginAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return config.allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || null;
}

function authenticated(req, config) {
  const token = bearerToken(req);
  if (!token) return false;
  const expected = Buffer.from(config.tokenSha256, 'hex');
  const actual = Buffer.from(tokenDigest(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function authorizeRemoteToolInput(name, args, config) {
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

async function readRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REMOTE_REQUEST_BYTES) {
      const error = new Error(`Remote MCP request exceeded ${MAX_REMOTE_REQUEST_BYTES} bytes`);
      error.code = 'REMOTE_REQUEST_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toFetchRequest(req) {
  const host = req.headers.host || '127.0.0.1';
  const url = new URL(req.url || '/', `http://${host}`);
  const body = await readRequestBody(req);
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    ...(body === undefined ? {} : { body })
  });
}

async function writeFetchResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText || res.statusMessage;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const readable = Readable.fromWeb(response.body);
  readable.on('error', (error) => res.destroy(error));
  readable.pipe(res);
}

function writeJson(res, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function createRemoteMcpHandler({ config, app }) {
  const [{ createMcpHandler, McpServer }, zod] = await Promise.all([
    import('@modelcontextprotocol/server'),
    import('zod')
  ]);
  const z = zod.z || zod.default || zod;
  return createMcpHandler(() => {
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
          return {
            content: [{ type: 'text', text: jsonSafe(result) }],
            structuredContent: toolOutputStructuredContent(tool.name, result),
            _meta: toolWorkflowSuggestionsMeta(tool.name, authorizedArgs, result)
          };
        } catch (error) {
          return toolErrorResult(tool.name, args || {}, error);
        }
      });
    }
    return server;
  });
}

export async function startRemoteHost({
  configPath,
  config: suppliedConfig = null,
  bind = null,
  port = null,
  stateRoot = null,
  app: suppliedApp = null
} = {}) {
  const config = suppliedConfig || await readRemoteHostConfig(configPath);
  const integrity = await inspectMcpSdkIntegrity(new URL('..', import.meta.url).pathname);
  if (integrity.status !== 'verified') assertMcpSdkIntegrity(integrity);
  const resolvedBind = bind || config.bind;
  const resolvedPort = port === null || port === undefined ? config.port : Number(port);
  const app = suppliedApp || await createVeteranApp({
    stateRoot: stateRoot || config.stateRoot,
    protocolMode: MCP_TRANSPORT_MODES.OFFICIAL_SDK,
    surfaceProfile: 'secure-tunnel'
  });
  const handler = await createRemoteMcpHandler({ config, app });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname;
      if (pathname === '/health') {
        writeJson(res, 200, { ok: true, product: RUNTIME_NAME, version: RUNTIME_VERSION });
        return;
      }
      if (!requestHostAllowed(req, config)) {
        writeJson(res, 421, { error: 'REMOTE_HOST_HEADER_REJECTED' });
        return;
      }
      if (!requestOriginAllowed(req, config)) {
        writeJson(res, 403, { error: 'REMOTE_ORIGIN_REJECTED' });
        return;
      }
      if (pathname === '/status') {
        if (!authenticated(req, config)) {
          writeJson(res, 401, { error: 'REMOTE_AUTH_REQUIRED' }, { 'www-authenticate': 'Bearer' });
          return;
        }
        const address = server.address();
        writeJson(res, 200, {
          ok: true,
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          bind: resolvedBind,
          port: typeof address === 'object' && address ? address.port : resolvedPort,
          allowedLocalRoots: config.allowedLocalRoots,
          surfaceProfile: 'secure-tunnel'
        });
        return;
      }
      if (pathname !== '/mcp') {
        writeJson(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      if (!authenticated(req, config)) {
        writeJson(res, 401, { error: 'REMOTE_AUTH_REQUIRED' }, { 'www-authenticate': 'Bearer' });
        return;
      }
      const request = await toFetchRequest(req);
      const response = await handler.fetch(request);
      await writeFetchResponse(res, response);
    } catch (error) {
      if (!res.headersSent) writeJson(res, error?.code === 'REMOTE_REQUEST_TOO_LARGE' ? 413 : 500, errorPayload(error));
      else res.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(resolvedPort, resolvedBind);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : resolvedPort;
  let closed = false;
  return {
    app,
    config,
    server,
    endpoint: `http://${resolvedBind.includes(':') ? `[${resolvedBind}]` : resolvedBind}:${actualPort}/mcp`,
    healthEndpoint: `http://${resolvedBind.includes(':') ? `[${resolvedBind}]` : resolvedBind}:${actualPort}/health`,
    async close() {
      if (closed) return;
      closed = true;
      await handler.close?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
