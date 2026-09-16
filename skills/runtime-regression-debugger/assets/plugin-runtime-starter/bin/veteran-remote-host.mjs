#!/usr/bin/env node
import { readRemoteHostConfig, initRemoteHostConfig, rotateRemoteHostToken, defaultRemoteHostConfigPath } from '../src/remote-host-config.mjs';
import { startRemoteHost } from '../src/remote-host-server.mjs';
import { RUNTIME_VERSION } from '../src/constants.mjs';

function valueAfter(argv, index, option) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || !value || value.startsWith('-')) {
    const error = new Error(`${option} requires a value`);
    error.code = 'CLI_ARGUMENT_VALUE_REQUIRED';
    throw error;
  }
  return value;
}

function parse(argv) {
  const out = {
    command: argv[0] || 'help',
    configPath: defaultRemoteHostConfigPath(),
    stateRoot: null,
    workspaces: [],
    allowedOrigins: [],
    allowedHosts: [],
    bind: null,
    port: null,
    force: false,
    json: false
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') out.configPath = valueAfter(argv, i++, arg);
    else if (arg === '--state-root') out.stateRoot = valueAfter(argv, i++, arg);
    else if (arg === '--workspace') out.workspaces.push(valueAfter(argv, i++, arg));
    else if (arg === '--origin') out.allowedOrigins.push(valueAfter(argv, i++, arg));
    else if (arg === '--allowed-host') out.allowedHosts.push(valueAfter(argv, i++, arg));
    else if (arg === '--bind') out.bind = valueAfter(argv, i++, arg);
    else if (arg === '--port') out.port = Number(valueAfter(argv, i++, arg));
    else if (arg === '--force') out.force = true;
    else if (arg === '--json') out.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return `Veteran Remote Host ${RUNTIME_VERSION}\n\nUsage:\n  veteran-remote-host init --workspace <path> [--workspace <path> ...] [options]\n  veteran-remote-host start [options]\n  veteran-remote-host status [--json] [--config <path>]\n  veteran-remote-host rotate-token [--json] [--config <path>]\n\nOptions:\n  --config <path>         Remote Host config path\n  --state-root <path>     Veteran durable state directory\n  --workspace <path>      Allowed local workspace root; repeatable\n  --bind <address>        Listen address (default 127.0.0.1)\n  --port <port>           Listen port (default 8765, 0 for ephemeral test/dev)\n  --origin <origin>       Allowed browser Origin; repeatable\n  --allowed-host <host>   Allowed HTTP Host header hostname; repeatable\n  --force                 Replace an existing config during init\n  --json                  Emit machine-readable output where applicable\n\nSecurity default: loopback-only. Put TLS / an approved tunnel in front of this process instead of binding it directly to the public internet.\n`;
}

function publicConfig(config) {
  return {
    schemaVersion: config.schemaVersion,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    createdAt: config.createdAt,
    tokenRotatedAt: config.tokenRotatedAt || null,
    stateRoot: config.stateRoot,
    bind: config.bind,
    port: config.port,
    allowedLocalRoots: config.allowedLocalRoots,
    allowedOrigins: config.allowedOrigins,
    allowedHosts: config.allowedHosts
  };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (['help', '-h', '--help'].includes(args.command)) {
    process.stdout.write(usage());
    return;
  }
  if (args.command === 'init') {
    if (args.workspaces.length === 0) {
      const error = new Error('init requires at least one --workspace path');
      error.code = 'REMOTE_WORKSPACE_REQUIRED';
      throw error;
    }
    const result = await initRemoteHostConfig({
      configPath: args.configPath,
      ...(args.stateRoot ? { stateRoot: args.stateRoot } : {}),
      workspaces: args.workspaces,
      ...(args.bind ? { bind: args.bind } : {}),
      ...(args.port !== null ? { port: args.port } : {}),
      allowedOrigins: args.allowedOrigins,
      allowedHosts: args.allowedHosts.length ? args.allowedHosts : null,
      force: args.force
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      configPath: result.configPath,
      device: publicConfig(result.config),
      pairingToken: result.pairingToken,
      pairingHint: result.pairingHint,
      warning: 'Save pairingToken now. Only its SHA-256 digest is stored on the host.'
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'status') {
    const config = await readRemoteHostConfig(args.configPath);
    const result = { ok: true, configPath: args.configPath, device: publicConfig(config) };
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`Veteran Remote Host ${RUNTIME_VERSION}\nDevice: ${config.deviceName} (${config.deviceId})\nBind: ${config.bind}:${config.port}\nWorkspaces:\n${config.allowedLocalRoots.map((root) => `  - ${root}`).join('\n')}\n`);
    return;
  }
  if (args.command === 'rotate-token') {
    const result = await rotateRemoteHostToken(args.configPath);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      deviceId: result.config.deviceId,
      pairingToken: result.pairingToken,
      pairingHint: result.pairingHint,
      warning: 'The prior token is invalid immediately. Save the new token now.'
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'start') {
    const running = await startRemoteHost({
      configPath: args.configPath,
      ...(args.bind ? { bind: args.bind } : {}),
      ...(args.port !== null ? { port: args.port } : {}),
      ...(args.stateRoot ? { stateRoot: args.stateRoot } : {})
    });
    process.stderr.write(`[veteran-remote-host] device=${running.config.deviceId} endpoint=${running.endpoint}\n`);
    process.stderr.write(`[veteran-remote-host] workspaces=${running.config.allowedLocalRoots.join(',')}\n`);
    let closing = false;
    const stop = async (signal) => {
      if (closing) return;
      closing = true;
      process.stderr.write(`[veteran-remote-host] ${signal}: shutting down\n`);
      try { await running.close(); } finally { process.exitCode = 0; }
    };
    process.once('SIGINT', () => { void stop('SIGINT'); });
    process.once('SIGTERM', () => { void stop('SIGTERM'); });
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
