#!/usr/bin/env node
import { VeteranInstaller } from '../src/installer/index.mjs';
import { RUNTIME_VERSION } from '../src/constants.mjs';

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) {
    const error = new Error(`${option} requires a value`);
    error.code = 'CLI_ARGUMENT_VALUE_REQUIRED';
    throw error;
  }
  return value;
}

function parse(argv) {
  const out = { command: argv[0] || 'help', host: null, json: false, purge: false, trustedAdapterDirs: [], options: {} };
  let i = 1;
  if (argv[i] && !argv[i].startsWith('-')) out.host = argv[i++];
  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') out.host = optionValue(argv, i++, arg);
    else if (arg === '--json') out.json = true;
    else if (arg === '--purge') out.purge = true;
    else if (arg === '--home') out.home = optionValue(argv, i++, arg);
    else if (arg === '--runtime-root') out.runtimeRoot = optionValue(argv, i++, arg);
    else if (arg === '--state-root') out.runtimeStateRoot = optionValue(argv, i++, arg);
    else if (arg === '--installer-root') out.installerRoot = optionValue(argv, i++, arg);
    else if (arg === '--distribution-root') out.distributionRoot = optionValue(argv, i++, arg);
    else if (arg === '--descriptor') out.options.descriptorPath = optionValue(argv, i++, arg);
    else if (arg === '--surface-profile') out.options.surfaceProfile = optionValue(argv, i++, arg);
    else if (arg === '--hermes-home') out.options.hermesHome = optionValue(argv, i++, arg);
    else if (arg === '--release') out.options.release = optionValue(argv, i++, arg);
    else if (arg === '--trusted-adapter-dir') out.trustedAdapterDirs.push(optionValue(argv, i++, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return `Veteran Engineer ${process.env.npm_package_version || RUNTIME_VERSION}\n\nUsage:\n  veteran-engineer install <codex|hermes|generic> [options]\n  veteran-engineer status [host] [--json]\n  veteran-engineer doctor [host] [--json]\n  veteran-engineer repair [host] [options]\n  veteran-engineer upgrade [--release latest|vX.Y.Z] [options]\n  veteran-engineer uninstall <host> [--purge]\n  veteran-engineer hosts [--json]\n\nSurface profiles: local-stdio, remote-mcp, secure-tunnel. Use --surface-profile with generic descriptors.\nShared runtime defaults to ~/plugins/veteran-engineer. Durable state defaults to ~/.veteran-engineer/state.\n`;
}

function doctorText(report) {
  const lines = [];
  lines.push(`Veteran Engineer ${report.version}`);
  lines.push(`Runtime: ${report.runtime.ok ? 'PASS' : 'FAIL'}`);
  const mcp = report.runtime.activeMcp;
  if (mcp) {
    lines.push(`MCP transport: ${mcp.transport}`);
    lines.push(`MCP implementation: ${mcp.implementation}`);
    lines.push(`MCP eras: ${mcp.eras.join(', ')}`);
    lines.push(`MCP protocols: ${mcp.protocols.join(', ')}`);
  }
  lines.push(`MCP SDK graph: ${report.runtime.sdkGraph?.status || 'unavailable'}`);
  lines.push(`MCP SDK lockfile: ${report.runtime.sdkLockfile?.status || 'unavailable'}`);
  const pinned = report.runtime.checks.find((item) => item.name === 'mcp-modern-2026-pinned');
  if (pinned) lines.push(`Pinned 2026-07-28 SDK handshake: ${pinned.ok ? 'PASS' : 'FAIL'}`);
  else if (report.runtime.sdkGraph?.status === 'invalid' || report.runtime.sdkLockfile?.status === 'invalid') lines.push('Pinned 2026-07-28 SDK handshake: NOT RUN (SDK integrity failure)');
  else lines.push('Pinned 2026-07-28 SDK handshake: NOT RUN (official SDK packages unavailable)');
  const fallback = report.runtime.checks.find((item) => item.name === 'mcp-modern-client-auto-fallback');
  if (fallback) lines.push(`Modern client -> legacy fallback negotiation: ${fallback.ok ? 'PASS' : 'FAIL'}`);
  for (const [id, host] of Object.entries(report.hosts || {})) lines.push(`Host ${id}: ${host.ok ? 'PASS' : 'FAIL'}`);
  return `${lines.join('\n')}\n`;
}

function statusText(report) {
  const lines = [
    `Veteran Engineer expected ${report.expectedVersion}`,
    `Runtime root: ${report.runtimeRoot}`,
    `Runtime present: ${report.runtimePresent ? 'yes' : 'no'}`,
    `Distribution drift: ${report.distributionDrift ? 'yes' : 'no'}`
  ];
  for (const [id, host] of Object.entries(report.hosts || {})) lines.push(`Host ${id}: ${host.installed ? 'installed' : 'not installed'}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (['help', '-h', '--help'].includes(args.command)) {
    process.stdout.write(usage());
    return;
  }
  const installer = new VeteranInstaller({
    distributionRoot: args.distributionRoot,
    home: args.home,
    runtimeRoot: args.runtimeRoot,
    runtimeStateRoot: args.runtimeStateRoot,
    installerRoot: args.installerRoot,
    trustedAdapterDirs: args.trustedAdapterDirs
  });
  let result;
  if (args.command === 'hosts') result = await installer.listHosts();
  else if (args.command === 'install') {
    if (!args.host) throw new Error('install requires a host');
    result = await installer.install(args.host, args.options);
  } else if (args.command === 'status') result = await installer.status(args.host, args.options);
  else if (args.command === 'doctor') result = await installer.doctor(args.host, args.options);
  else if (args.command === 'repair') result = await installer.repair(args.host, args.options);
  else if (args.command === 'upgrade') result = await installer.upgrade(args.options);
  else if (args.command === 'uninstall') {
    if (!args.host) throw new Error('uninstall requires a host');
    result = await installer.uninstall(args.host, { ...args.options, purge: args.purge });
  } else throw new Error(`Unknown command: ${args.command}`);

  if (args.json || ['install', 'repair', 'upgrade', 'uninstall', 'hosts'].includes(args.command)) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (args.command === 'doctor') process.stdout.write(doctorText(result));
  else if (args.command === 'status') process.stdout.write(statusText(result));
  if (result?.ok === false) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
