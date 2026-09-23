import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { runCommand } from '../src/installer/util.mjs';
import { pathExists } from '../src/util.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');

async function writeExecutable(file, source) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source, { mode: 0o755 });
  await fs.chmod(file, 0o755);
}

async function fakeHostEnvironment(home) {
  const bin = path.join(home, 'fake-bin');
  const hostCli = path.join(bin, 'fake-host-cli.cjs');
  await writeExecutable(hostCli, `const fs=require('fs'),p=require('path');const host=process.argv[2],home=process.env.HOME,state=p.join(home,'.fake-'+host),a=process.argv.slice(3);if(host==='codex'){if(a[0]!=='plugin')process.exit(2);if(a[1]==='add'){fs.writeFileSync(state,a[2]);console.log(JSON.stringify({installed:true,selector:a[2]}));}else if(a[1]==='list'){const ok=fs.existsSync(state);console.log(JSON.stringify(ok?[{name:'veteran-engineer',marketplace:'personal',installed:true}]:[]));}else if(a[1]==='remove'){try{fs.unlinkSync(state)}catch{};console.log(JSON.stringify({removed:true}));}else process.exit(2);}else if(host==='hermes'){if(a[0]!=='mcp')process.exit(2);if(a[1]==='list'){if(fs.existsSync(state))console.log('veteran-engineer');}else if(a[1]==='add'){fs.writeFileSync(state,'installed');console.log('added');}else if(a[1]==='remove'){try{fs.unlinkSync(state)}catch{};console.log('removed');}else if(a[1]==='test'){process.exit(fs.existsSync(state)?0:1);}else process.exit(2);}else process.exit(2);\n`);
  if (process.platform === 'win32') {
    await writeExecutable(path.join(bin, 'codex.cmd'), `@node "%~dp0\\fake-host-cli.cjs" codex %*\r\n`);
    await writeExecutable(path.join(bin, 'hermes.cmd'), `@node "%~dp0\\fake-host-cli.cjs" hermes %*\r\n`);
  } else {
    await writeExecutable(path.join(bin, 'codex'), `#!/bin/sh\nexec node "$(dirname "$0")/fake-host-cli.cjs" codex "$@"\n`);
    await writeExecutable(path.join(bin, 'hermes'), `#!/bin/sh\nexec node "$(dirname "$0")/fake-host-cli.cjs" hermes "$@"\n`);
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
  const installed = { codex: false, hermes: false };
  const exec = async (command, args = [], options = {}) => {
    const executableName = path.basename(command).toLowerCase();
    if (!executableName.startsWith('codex') && !executableName.startsWith('hermes')) return runCommand(command, args, options);
    const host = executableName.startsWith('codex') ? 'codex' : 'hermes';
    if (host === 'codex') {
      if (args[1] === 'add') installed.codex = true;
      if (args[1] === 'remove') installed.codex = false;
      const stdout = args[1] === 'list'
        ? JSON.stringify(installed.codex ? [{ name: 'veteran-engineer', marketplace: 'personal', installed: true }] : [])
        : JSON.stringify({ ok: true });
      return { code: 0, signal: null, stdout, stderr: '' };
    }
    if (args[1] === 'add') installed.hermes = true;
    if (args[1] === 'remove') installed.hermes = false;
    return { code: args[1] === 'test' && !installed.hermes ? 1 : 0, signal: null, stdout: args[1] === 'list' && installed.hermes ? 'veteran-engineer\n' : '', stderr: '' };
  };
  return { env, exec };
}

test('generic host lifecycle installs, doctors, and purges shared runtime', async () => {
  const home = await tempDir('veteran-installer-generic-');
  try {
    const installer = new VeteranInstaller({ distributionRoot, home, env: { ...process.env, HOME: home, USERPROFILE: home } });
    const installed = await installer.install('generic', { surfaceProfile: 'secure-tunnel' });
    assert.equal(installed.binding.installed, true);
    const descriptor = JSON.parse(await fs.readFile(installed.binding.descriptorPath, 'utf8'));
    assert.equal(descriptor.mcpServers['veteran-engineer'].env.VETERAN_ENGINEER_SURFACE_PROFILE, 'secure-tunnel');
    const status = await installer.status('generic');
    assert.equal(status.hosts.generic.installed, true);
    assert.equal(status.hosts.generic.surfaceProfile, 'secure-tunnel');
    assert.equal(status.distributionDrift, false);
    const dependencySentinel = path.join(installer.runtimeRoot, 'node_modules', '.veteran-test-sentinel');
    await fs.mkdir(path.dirname(dependencySentinel), { recursive: true });
    await fs.writeFile(dependencySentinel, 'preserve');
    const repaired = await installer.repair('generic');
    assert.equal(repaired.ok, true);
    assert.equal(await fs.readFile(dependencySentinel, 'utf8'), 'preserve', 'repair must preserve installed SDK/dependency tree');
    const doctor = await installer.doctor('generic');
    assert.equal(doctor.ok, true, JSON.stringify(doctor, null, 2));
    assert.equal(doctor.runtime.legacy.toolCount, 36);
    assert.equal(doctor.runtime.activeMcp.implementation, 'standalone-fallback');
    const removed = await installer.uninstall('generic', { purge: true });
    assert.equal(removed.purged, true);
    assert.equal(await pathExists(installer.runtimeRoot), false);
  } finally {
    await cleanup(home);
  }
});

test('Codex and Hermes adapters bind the same shared runtime without host-specific core forks', async () => {
  const home = await tempDir('veteran-installer-hosts-');
  try {
    const { env, exec } = await fakeHostEnvironment(home);
    const installer = new VeteranInstaller({ distributionRoot, home, env, exec });
    const codex = await installer.install('codex');
    assert.equal(codex.binding.installed, true);
    const hermes = await installer.install('hermes', { hermesHome: path.join(home, '.hermes-test') });
    assert.equal(hermes.binding.installed, true);
    const hosts = await installer.listHosts();
    assert.equal(hosts.find((item) => item.id === 'codex').surface.id, 'local-stdio');
    assert.equal(hosts.find((item) => item.id === 'codex').surface.contract, 'veteran-surface-capabilities-v1');
    const status = await installer.status(null, { hermesHome: path.join(home, '.hermes-test') });
    assert.equal(status.hosts.codex.installed, true);
    assert.equal(status.hosts.hermes.installed, true);
    assert.equal(status.runtimeRoot, path.join(home, 'plugins', 'veteran-engineer'));
    const doctor = await installer.doctor(null, { hermesHome: path.join(home, '.hermes-test') });
    assert.equal(doctor.ok, true, JSON.stringify(doctor, null, 2));
    assert.equal(doctor.hosts.codex.ok, true);
    assert.equal(doctor.hosts.hermes.ok, true);
  } finally {
    await cleanup(home);
  }
});

test('Codex uninstall reuses recorded marketplace identity when marketplace metadata disappears', async () => {
  const home = await tempDir('veteran-installer-codex-marketplace-');
  const marketplaceFile = path.join(home, '.agents', 'plugins', 'marketplace.json');
  try {
    const { env, exec: hostExec } = await fakeHostEnvironment(home);
    const calls = [];
    const exec = async (command, args = [], options = {}) => {
      calls.push({ command, args: [...args] });
      return hostExec(command, args, options);
    };
    await fs.mkdir(path.dirname(marketplaceFile), { recursive: true });
    await fs.writeFile(marketplaceFile, `${JSON.stringify({ name: 'team-market', interface: { displayName: 'Team' }, plugins: [] }, null, 2)}\n`);

    const installer = new VeteranInstaller({ distributionRoot, home, env, exec });
    const installed = await installer.install('codex');
    assert.equal(installed.binding.marketplaceName, 'team-market');
    assert.equal(installed.binding.selector, 'veteran-engineer@team-market');

    const state = JSON.parse(await fs.readFile(installer.installerStatePath, 'utf8'));
    assert.equal(state.hosts.codex.binding.marketplaceName, 'team-market');
    delete state.hosts.codex.binding.marketplaceName;
    await fs.writeFile(installer.installerStatePath, `${JSON.stringify(state, null, 2)}\n`);
    await fs.rm(marketplaceFile, { force: true });

    const beforeUninstall = calls.length;
    const removed = await installer.uninstall('codex');
    assert.equal(removed.removed, true);
    const removeCall = calls.slice(beforeUninstall).find((call) => path.basename(call.command).toLowerCase().startsWith('codex') && call.args[0] === 'plugin' && call.args[1] === 'remove');
    assert.ok(removeCall, 'Codex uninstall must invoke plugin remove when the CLI is available');
    assert.equal(removeCall.args[2], 'veteran-engineer@team-market', 'legacy binding selector must preserve the installed marketplace identity');
  } finally {
    await cleanup(home);
  }
});

test('purge is rejected before any host is unbound when another host still references runtime', async () => {
  const home = await tempDir('veteran-installer-purge-');
  try {
    const { env, exec } = await fakeHostEnvironment(home);
    const hermesHome = path.join(home, '.hermes-test');
    const installer = new VeteranInstaller({ distributionRoot, home, env, exec });
    await installer.install('codex');
    await installer.install('hermes', { hermesHome });
    await assert.rejects(installer.uninstall('codex', { purge: true }), (error) => error.code === 'RUNTIME_STILL_REFERENCED');
    const statusAfterRejectedPurge = await installer.status('codex');
    assert.equal(statusAfterRejectedPurge.hosts.codex.installed, true, 'rejected purge must not partially uninstall Codex');
    const codexRemoved = await installer.uninstall('codex');
    assert.equal(codexRemoved.purged, false);
    const hermesRemoved = await installer.uninstall('hermes', { purge: true, hermesHome });
    assert.equal(hermesRemoved.purged, true);
  } finally {
    await cleanup(home);
  }
});

test('external host adapters load only from explicitly trusted directory and enforce filename/id/API contract', async () => {
  const home = await tempDir('veteran-installer-ext-');
  const trusted = path.join(home, 'trusted');
  try {
    await fs.mkdir(trusted, { recursive: true });
    await fs.writeFile(path.join(trusted, 'acme.mjs'), `export default {apiVersion:1,id:'acme',displayName:'Acme Host',async install(){return {installed:true}},async status(){return {installed:true}},async doctor(){return {ok:true,checks:[]}},async uninstall(){return {removed:true}}};\n`);
    const installer = new VeteranInstaller({ distributionRoot, home, trustedAdapterDirs: [trusted] });
    const hosts = await installer.listHosts();
    assert.ok(hosts.some((item) => item.id === 'acme'));
    await fs.writeFile(path.join(trusted, 'wrong-name.mjs'), `export default {apiVersion:1,id:'different',displayName:'Different',async install(){},async status(){},async doctor(){},async uninstall(){}};\n`);
    await assert.rejects(installer.listHosts(), (error) => error.code === 'HOST_ADAPTER_FILENAME_MISMATCH');
  } finally {
    await cleanup(home);
  }
});
