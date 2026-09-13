import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVeteranApp } from './app.mjs';
import { RUNTIME_NAME, RUNTIME_VERSION, LEGACY_PROTOCOL_VERSION } from './constants.mjs';
import { MCP_TRANSPORT_MODES } from './mcp-protocol-capability.mjs';
import { TOOL_DEFINITIONS, toolInputJsonSchema, toolRequiresRequestId } from './tool-catalog.mjs';
import { inspectMcpSdkIntegrity, assertMcpSdkIntegrity } from './mcp-sdk-integrity.mjs';

const runtimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function stateRootFromEnv() {
  return path.resolve(process.env.VETERAN_ENGINEER_STATE_DIR || path.join(os.homedir(), '.veteran-engineer', 'state'));
}

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

function sdkInputSchema(z, name) {
  return toolRequiresRequestId(name)
    ? z.object({ requestId: z.string().min(1) }).passthrough()
    : z.object({}).passthrough();
}

async function createOfficialSdkServerFactory({ stateRoot, configPath }) {
  const [{ McpServer }, { serveStdio }, zod] = await Promise.all([
    import('@modelcontextprotocol/server'),
    import('@modelcontextprotocol/server/stdio'),
    import('zod')
  ]);
  const z = zod.z || zod.default || zod;
  const app = await createVeteranApp({ stateRoot, protocolMode: MCP_TRANSPORT_MODES.OFFICIAL_SDK, configPath });
  const factory = ({ era } = {}) => {
    app.setProtocolMode(MCP_TRANSPORT_MODES.OFFICIAL_SDK);
    const server = new McpServer({ name: RUNTIME_NAME, version: RUNTIME_VERSION });
    for (const tool of TOOL_DEFINITIONS) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: sdkInputSchema(z, tool.name)
      }, async (args) => {
        try {
          const result = await app.callTool(tool.name, args || {});
          return { content: [{ type: 'text', text: jsonSafe(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: jsonSafe(errorPayload(error)) }] };
        }
      });
    }
    return server;
  };
  return { app, serve: () => serveStdio(factory, { legacy: 'serve', onerror: (error) => console.error(`[${RUNTIME_NAME}] MCP SDK error: ${error.message}`) }) };
}

async function startFallback({ stateRoot, configPath }) {
  const app = await createVeteranApp({ stateRoot, protocolMode: MCP_TRANSPORT_MODES.STANDALONE_FALLBACK, configPath });
  process.stdin.setEncoding('utf8');
  let buffer = '';
  const send = (message) => process.stdout.write(`${jsonSafe(message)}\n`);
  const success = (id, result) => send({ jsonrpc: '2.0', id, result });
  const failure = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { failure(null, -32700, 'Parse error'); continue; }
      if (!Object.hasOwn(message, 'id')) continue;
      try {
        if (message.method === 'initialize') {
          success(message.id, {
            protocolVersion: LEGACY_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: RUNTIME_NAME, version: RUNTIME_VERSION },
            instructions: 'Veteran Engineer standalone fallback: legacy MCP 2025 only.'
          });
        } else if (message.method === 'tools/list') {
          success(message.id, { tools: TOOL_DEFINITIONS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: toolInputJsonSchema(tool.name) })) });
        } else if (message.method === 'tools/call') {
          const name = message.params?.name;
          const args = message.params?.arguments || {};
          try {
            const result = await app.callTool(name, args);
            success(message.id, { content: [{ type: 'text', text: jsonSafe(result) }] });
          } catch (error) {
            success(message.id, { isError: true, content: [{ type: 'text', text: jsonSafe(errorPayload(error)) }] });
          }
        } else if (message.method === 'ping') {
          success(message.id, {});
        } else {
          failure(message.id, -32601, 'Method not found');
        }
      } catch (error) {
        failure(message.id, -32603, 'Internal error', errorPayload(error));
      }
    }
  });
  return { app, mode: MCP_TRANSPORT_MODES.STANDALONE_FALLBACK };
}

export async function startMcpServer({ stateRoot = stateRootFromEnv(), configPath = process.env.VETERAN_ENGINEER_CONFIG, requireSdk = process.env.VETERAN_MCP_REQUIRE_SDK === '1', forceFallback = process.env.VETERAN_MCP_FORCE_FALLBACK === '1' } = {}) {
  if (!forceFallback) {
    const integrity = await inspectMcpSdkIntegrity(runtimeRoot);
    if (integrity.status === 'verified') {
      const official = await createOfficialSdkServerFactory({ stateRoot, configPath });
      official.serve();
      return { app: official.app, mode: MCP_TRANSPORT_MODES.OFFICIAL_SDK };
    }
    if (integrity.status === 'invalid') assertMcpSdkIntegrity(integrity);
  }
  if (requireSdk) throw Object.assign(new Error('Official MCP SDK required but unavailable'), { code: 'MCP_SDK_REQUIRED' });
  return startFallback({ stateRoot, configPath });
}
