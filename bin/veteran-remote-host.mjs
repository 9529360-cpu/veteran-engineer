#!/usr/bin/env node
import { readRemoteHostConfig, initRemoteHostConfig, rotateRemoteHostToken, defaultRemoteHostConfigPath } from '../src/remote-host-config.mjs';
import { startRemoteHost } from '../src/remote-host-server.mjs';
import { startRemoteHostTunnelStdio } from '../src/remote-host-tunnel.mjs';
import {
  controlRemoteHostService,
  defaultRemoteHostServiceRoot,
  installRemoteHostService,
  remoteHostServiceStatus,
  superviseRemoteHostService,
  uninstallRemoteHostService
} from '../src/remote-host-service.mjs';
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
    serviceRoot: defaultRemoteHostServiceRoot(),
    stateRoot: null,
    workspaces: [],
    allowedOrigins: [],
    allowedHosts: [],
    allowedExecutables: [],
    enableMachineActions: false,
    bind: null,
    port: null,
    force: false,
    json: false,
    noStart: false,
    purgeLogs: false
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') out.configPath = valueAfter(argv, i++, arg);
    else if (arg === '--service-root') out.serviceRoot = valueAfter(argv, i++, arg);
    else if (arg === '--state-root') out.stateRoot = valueAfter(argv, i++, arg);
    else if (arg === '--workspace') out.workspaces.push(valueAfter(argv, i++, arg));
    else if (arg === '--origin') out.allowedOrigins.push(valueAfter(argv, i++, arg));
    else if (arg === '--allowed-host') out.allowedHosts.push(valueAfter(argv, i++, arg));
    else if (arg === '--enable-machine-actions') out.enableMachineActions = true;
    else if (arg === '--allow-executable') out.allowedExecutables.push(valueAfter(argv, i++, arg));
    else if (arg === '--bind') out.bind = valueAfter(argv, i++, arg);
    else if (arg === '--port') out.port = Number(valueAfter(argv, i++, arg));
    else if (arg === '--force') out.force = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--no-start') out.noStart = true;
    else if (arg === '--purge-logs') out.purgeLogs = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return `Veteran Remote Host ${RUNTIME_VERSION}\n\nUsage:\n  veteran-remote-host init --workspace <path> [--workspace <path> ...] [options]\n  veteran-remote-host start [options]\n  veteran-remote-host tunnel-stdio [--config <path>] [--state-root <path>]\n  veteran-remote-host status [--json] [--config <path>]\n  veteran-remote-host rotate-token [--json] [--config <path>]\n  veteran-remote-host install-service [--no-start] [--force] [service options]\n  veteran-remote-host repair-service [service options]\n  veteran-remote-host service-status [--json] [service options]\n  veteran-remote-host service-start [service options]\n  veteran-remote-host service-stop [service options]\n  veteran-remote-host service-pause [service options]\n  veteran-remote-host service-resume [service options]\n  veteran-remote-host uninstall-service [--purge-logs] [service options]\n  veteran-remote-host supervise [service options]\n\nOptions:\n  --config <path>         Remote Host config path\n  --service-root <path>   Service-owned state/log directory\n  --state-root <path>     Veteran durable state directory\n  --workspace <path>      Allowed local workspace root; repeatable\n  --bind <address>        Listen address (default 127.0.0.1)\n  --port <port>           Listen port (default 8765, 0 for ephemeral test/dev)\n  --origin <origin>       Allowed browser Origin; repeatable\n  --allowed-host <host>   Allowed HTTP Host header hostname; repeatable\n  --enable-machine-actions Enable workspace-bounded file/process tools for this host\n  --allow-executable <cmd> Additional executable name for machine process.start; repeatable\n  --force                 Replace config during init or repair service registration\n  --no-start              Install/register the Windows service without starting it now\n  --purge-logs            Remove service logs during uninstall\n  --json                  Emit machine-readable output where applicable\n\nSecure MCP Tunnel mode:\n  tunnel-stdio exposes the same allowlisted Veteran MCP surface over local stdio only. It does not open a network listener and does not use the Remote Host pairing token on stdin/stdout; remote authentication and tunnel association remain the responsibility of the approved outer tunnel.\n\nWindows service mode uses an explicit current-user Task Scheduler registration whose launcher, control state, PID state, and bounded logs live under Veteran-owned directories. The supervisor restarts the Remote Host child with bounded backoff and supports start/stop/pause/resume without moving Mission state ownership.\n\nSecurity default: loopback-only for HTTP Remote Host. Prefer an approved Secure MCP Tunnel for ChatGPT Web/private-machine connectivity instead of binding the HTTP server directly to the public internet.\n`;
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
    allowedHosts: config.allowedHosts,
    machineActions: config.machineActions
  };
}

function emit(result, json, human) {
  if (json || !human) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${human(result)}\n`);
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
      machineActions: {
        enabled: args.enableMachineActions,
        ...(args.allowedExecutables.length ? { allowedExecutables: args.allowedExecutables } : {})
      },
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
    else process.stdout.write(`Veteran Remote Host ${RUNTIME_VERSION}\nDevice: ${config.deviceName} (${config.deviceId})\nBind: ${config.bind}:${config.port}\nWorkspaces:\n${config.allowedLocalRoots.map((root) => `  - ${root}`).join('\n')}\nMachine actions: ${config.machineActions?.enabled ? 'enabled' : 'disabled'}\nExecutables: ${(config.machineActions?.allowedExecutables || []).join(', ') || '-'}\n`);
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
  if (args.command === 'install-service' || args.command === 'repair-service') {
    const result = await installRemoteHostService({
      configPath: args.configPath,
      serviceRoot: args.serviceRoot,
      force: args.command === 'repair-service' || args.force,
      startNow: !args.noStart
    });
    emit({ ok: true, ...result }, args.json, (value) => `Veteran Remote Host service ${value.repaired ? 'repaired' : 'installed'}: ${value.service.taskName}\nDesired state: ${value.desiredState}\nStarted now: ${value.started ? 'yes' : 'no'}\nLogs: ${value.service.logPath}`);
    return;
  }
  if (args.command === 'service-status') {
    const result = await remoteHostServiceStatus({ serviceRoot: args.serviceRoot });
    emit({ ok: true, ...result }, args.json, (value) => value.installed
      ? `Veteran Remote Host service\nRegistration: ${value.registration}\nDesired: ${value.desiredState}\nRuntime: ${value.runtimeState}\nSupervisor PID: ${value.supervisor?.pid || '-'}\nChild PID: ${value.child?.pid || '-'}\nLogs: ${value.logPath}`
      : `Veteran Remote Host service is not installed.\nService root: ${value.serviceRoot}`);
    return;
  }
  if (['service-start', 'service-stop', 'service-pause', 'service-resume'].includes(args.command)) {
    const action = args.command.slice('service-'.length);
    const result = await controlRemoteHostService(action, { serviceRoot: args.serviceRoot });
    emit({ ok: true, ...result }, args.json, (value) => `Veteran Remote Host service action=${value.action} desiredState=${value.desiredState}`);
    return;
  }
  if (args.command === 'uninstall-service') {
    const result = await uninstallRemoteHostService({
      serviceRoot: args.serviceRoot,
      purgeLogs: args.purgeLogs
    });
    emit({ ok: true, ...result }, args.json, (value) => value.removed
      ? `Veteran Remote Host service uninstalled. Logs ${value.logsPreserved ? `preserved at ${value.logPath}` : 'removed'}.`
      : `Veteran Remote Host service was not installed. Service root: ${value.serviceRoot}`);
    return;
  }
  if (args.command === 'supervise') {
    const controller = new AbortController();
    let stopping = false;
    const stop = (signal) => {
      if (stopping) return;
      stopping = true;
      process.stderr.write(`[veteran-remote-host] ${signal}: stopping supervisor\n`);
      controller.abort();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
    await superviseRemoteHostService({
      serviceRoot: args.serviceRoot,
      signal: controller.signal
    });
    return;
  }
  if (args.command === 'tunnel-stdio') {
    const running = await startRemoteHostTunnelStdio({
      configPath: args.configPath,
      ...(args.stateRoot ? { stateRoot: args.stateRoot } : {})
    });
    process.stderr.write(`[veteran-remote-host] device=${running.config.deviceId} transport=stdio surface=secure-tunnel\n`);
    process.stderr.write(`[veteran-remote-host] workspaces=${running.config.allowedLocalRoots.join(',')}\n`);
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
