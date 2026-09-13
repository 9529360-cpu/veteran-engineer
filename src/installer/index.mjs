import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import codexAdapter from './adapters/codex.mjs';
import hermesAdapter from './adapters/hermes.mjs';
import genericAdapter from './adapters/generic.mjs';
import { loadExternalAdapters, validateHostAdapter } from './adapter-sdk.mjs';
import { copyDistribution, defaultInstallerPaths, distributionDigest, readJson, runCommand, writeJsonAtomic } from './util.mjs';
import { ensureDir, nowIso, pathExists } from '../util.mjs';
import { RUNTIME_VERSION, HOST_ADAPTER_API_VERSION } from '../constants.mjs';
import { inspectMcpSdkIntegrity } from '../mcp-sdk-integrity.mjs';
import { resolveSurfaceProfile } from '../surface-capabilities.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DISTRIBUTION_ROOT = path.resolve(moduleDir, '..', '..');

function initialInstallerState(paths) {
  return {
    schemaVersion: 1,
    product: 'veteran-engineer',
    installedVersion: null,
    distributionDigest: null,
    runtimeRoot: paths.runtimeRoot,
    runtimeStateRoot: paths.runtimeStateRoot,
    hosts: {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export class VeteranInstaller {
  constructor({ distributionRoot = DEFAULT_DISTRIBUTION_ROOT, home, runtimeRoot, runtimeStateRoot, installerRoot, env = process.env, trustedAdapterDirs = [], exec = runCommand } = {}) {
    const defaults = defaultInstallerPaths(home);
    this.distributionRoot = path.resolve(distributionRoot);
    this.home = defaults.home;
    this.runtimeRoot = path.resolve(runtimeRoot || defaults.runtimeRoot);
    this.runtimeStateRoot = path.resolve(runtimeStateRoot || defaults.runtimeStateRoot);
    this.installerRoot = path.resolve(installerRoot || defaults.installerRoot);
    this.installerStatePath = path.join(this.installerRoot, 'installer.json');
    this.env = { ...env };
    this.trustedAdapterDirs = trustedAdapterDirs.map((item) => path.resolve(item));
    this.exec = exec;
  }

  async #loadState() {
    const state = await readJson(this.installerStatePath, null);
    return state || initialInstallerState(this);
  }

  async #saveState(state) {
    state.updatedAt = nowIso();
    await writeJsonAtomic(this.installerStatePath, state);
  }

  async #registry() {
    const adapters = [codexAdapter, hermesAdapter, genericAdapter].map((item) => validateHostAdapter(item));
    const external = await loadExternalAdapters(this.trustedAdapterDirs);
    const registry = new Map();
    for (const adapter of [...adapters, ...external]) {
      if (registry.has(adapter.id)) {
        const error = new Error(`Duplicate host adapter id: ${adapter.id}`);
        error.code = 'HOST_ADAPTER_DUPLICATE';
        throw error;
      }
      registry.set(adapter.id, adapter);
    }
    return registry;
  }

  async listHosts() {
    const registry = await this.#registry();
    return [...registry.values()].map((adapter) => ({ id: adapter.id, displayName: adapter.displayName, apiVersion: adapter.apiVersion, surface: resolveSurfaceProfile(adapter.surfaceProfile || 'local-stdio'), capabilities: adapter.capabilities || {} }));
  }

  async #context(adapter, options = {}, state = null) {
    const current = state || await this.#loadState();
    return {
      version: RUNTIME_VERSION,
      adapterApiVersion: HOST_ADAPTER_API_VERSION,
      home: this.home,
      runtimeRoot: this.runtimeRoot,
      runtimeStateRoot: this.runtimeStateRoot,
      installerRoot: this.installerRoot,
      distributionRoot: this.distributionRoot,
      env: this.env,
      options,
      previousBinding: current.hosts?.[adapter.id] || null,
      exec: this.exec
    };
  }

  async synchronizeDistribution() {
    if (!(await pathExists(path.join(this.distributionRoot, 'package.json')))) {
      const error = new Error(`Distribution root is invalid: ${this.distributionRoot}`);
      error.code = 'DISTRIBUTION_INVALID';
      throw error;
    }
    const sourceDigest = await distributionDigest(this.distributionRoot);
    const copied = await copyDistribution(this.distributionRoot, this.runtimeRoot);
    const targetDigest = await distributionDigest(this.runtimeRoot);
    if (sourceDigest !== targetDigest) {
      const error = new Error('Distribution digest mismatch after synchronization');
      error.code = 'DISTRIBUTION_DIGEST_MISMATCH';
      error.details = { sourceDigest, targetDigest };
      throw error;
    }
    await ensureDir(this.runtimeStateRoot);
    return { ...copied, digest: targetDigest };
  }

  async install(hostId, options = {}) {
    const registry = await this.#registry();
    const adapter = registry.get(hostId);
    if (!adapter) throw Object.assign(new Error(`Unknown host adapter: ${hostId}`), { code: 'HOST_ADAPTER_NOT_FOUND' });
    const state = await this.#loadState();
    const sync = await this.synchronizeDistribution();
    const context = await this.#context(adapter, options, state);
    const result = await adapter.install(context);
    const installedAt = state.hosts?.[hostId]?.installedAt || nowIso();
    state.installedVersion = RUNTIME_VERSION;
    state.distributionDigest = sync.digest;
    state.runtimeRoot = this.runtimeRoot;
    state.runtimeStateRoot = this.runtimeStateRoot;
    state.hosts ||= {};
    state.hosts[hostId] = {
      id: hostId,
      displayName: adapter.displayName,
      apiVersion: adapter.apiVersion,
      installedAt,
      updatedAt: nowIso(),
      binding: result
    };
    await this.#saveState(state);
    return { host: hostId, version: RUNTIME_VERSION, distribution: sync, binding: result };
  }

  async status(hostId = null, options = {}) {
    const registry = await this.#registry();
    const state = await this.#loadState();
    const ids = hostId ? [hostId] : [...new Set([...Object.keys(state.hosts || {}), ...registry.keys()])];
    const hosts = {};
    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) {
        hosts[id] = { installed: false, error: 'adapter-unavailable', recorded: state.hosts?.[id] || null };
        continue;
      }
      try {
        hosts[id] = await adapter.status(await this.#context(adapter, options, state));
      } catch (error) {
        hosts[id] = { installed: false, error: error.code || 'STATUS_FAILED', message: error.message };
      }
    }
    let runtimeDigest = null;
    let runtimePresent = false;
    if (await pathExists(this.runtimeRoot)) {
      runtimePresent = true;
      runtimeDigest = await distributionDigest(this.runtimeRoot).catch(() => null);
    }
    return {
      product: 'veteran-engineer',
      expectedVersion: RUNTIME_VERSION,
      recordedVersion: state.installedVersion,
      runtimeRoot: this.runtimeRoot,
      runtimeStateRoot: this.runtimeStateRoot,
      runtimePresent,
      recordedDigest: state.distributionDigest,
      runtimeDigest,
      distributionDrift: Boolean(state.distributionDigest && runtimeDigest && state.distributionDigest !== runtimeDigest),
      hosts
    };
  }

  async #runtimeDoctor() {
    const checks = [];
    const server = path.join(this.runtimeRoot, 'mcp', 'server.mjs');
    const handshake = path.join(this.runtimeRoot, 'scripts', 'mcp-handshake.mjs');
    const requiredFiles = [path.join(this.runtimeRoot, 'package.json'), server, handshake, path.join(this.runtimeRoot, '.codex-plugin', 'plugin.json'), path.join(this.runtimeRoot, '.mcp.json')];
    for (const file of requiredFiles) checks.push({ name: `file:${path.relative(this.runtimeRoot, file)}`, ok: await pathExists(file) });
    let legacy = null;
    if (checks.every((item) => item.ok)) {
      const result = await this.exec(process.execPath, [handshake, '--server', server, '--mode', 'legacy', '--expect-tools', '34', '--state-root', this.runtimeStateRoot], { env: this.env, allowFailure: true, timeoutMs: 30_000 });
      if (result.code === 0) {
        try { legacy = JSON.parse(result.stdout.trim()); } catch { /* reported below */ }
      }
      checks.push({ name: 'mcp-legacy-handshake', ok: result.code === 0 && legacy?.toolCount === 34, exitCode: result.code, report: legacy, stderr: result.stderr.slice(0, 2000) });
    }

    const sdkIntegrity = await inspectMcpSdkIntegrity(this.runtimeRoot);
    const sdkAvailable = sdkIntegrity.status === 'verified';
    let modern = null;
    let autoFallback = null;
    if (sdkAvailable) {
      const pinned = await this.exec(process.execPath, [handshake, '--server', server, '--mode', 'modern-pinned', '--require-sdk', '--require-server-sdk', '--stateful', '--expect-tools', '34', '--state-root', this.runtimeStateRoot], { env: this.env, allowFailure: true, timeoutMs: 45_000 });
      if (pinned.code === 0) try { modern = JSON.parse(pinned.stdout.trim()); } catch { /* reported below */ }
      checks.push({ name: 'mcp-modern-2026-pinned', ok: pinned.code === 0 && modern?.era === 'modern' && modern?.toolCount === 34 && modern?.stateful?.tool === 'project_open', exitCode: pinned.code, report: modern, stderr: pinned.stderr.slice(0, 3000) });

      const auto = await this.exec(process.execPath, [handshake, '--server', server, '--mode', 'auto', '--require-sdk', '--force-fallback', '--expect-tools', '34', '--state-root', this.runtimeStateRoot], { env: this.env, allowFailure: true, timeoutMs: 45_000 });
      if (auto.code === 0) try { autoFallback = JSON.parse(auto.stdout.trim()); } catch { /* reported below */ }
      checks.push({ name: 'mcp-modern-client-auto-fallback', ok: auto.code === 0 && autoFallback?.era === 'legacy' && autoFallback?.runtime?.mcp?.implementation === 'standalone-fallback', exitCode: auto.code, report: autoFallback, stderr: auto.stderr.slice(0, 3000) });
    } else if (sdkIntegrity.status === 'unavailable') {
      checks.push({ name: 'mcp-official-sdk-graph', ok: true, optional: true, available: false, report: sdkIntegrity, message: 'Official SDK packages are not installed; standalone legacy fallback remains available.' });
    } else {
      checks.push({ name: 'mcp-official-sdk-integrity', ok: false, report: sdkIntegrity, message: 'Official SDK graph or lockfile is incomplete, unpinned, or unverifiable.' });
    }
    return { ok: checks.filter((item) => !item.optional).every((item) => item.ok), sdkAvailable, sdkGraph: sdkIntegrity.graph, sdkLockfile: sdkIntegrity.lockfile, activeMcp: legacy?.runtime?.mcp || null, legacy, modern, autoFallback, checks };
  }

  async doctor(hostId = null, options = {}) {
    const registry = await this.#registry();
    const state = await this.#loadState();
    const ids = hostId ? [hostId] : Object.keys(state.hosts || {});
    const runtime = await this.#runtimeDoctor();
    const hosts = {};
    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) {
        hosts[id] = { ok: false, checks: [{ name: 'adapter-available', ok: false }] };
        continue;
      }
      try { hosts[id] = await adapter.doctor(await this.#context(adapter, options, state)); }
      catch (error) { hosts[id] = { ok: false, error: error.code || 'DOCTOR_FAILED', message: error.message, checks: [] }; }
    }
    return { ok: runtime.ok && Object.values(hosts).every((item) => item.ok), runtime, hosts, version: state.installedVersion || RUNTIME_VERSION };
  }

  async repair(hostId = null, options = {}) {
    const state = await this.#loadState();
    const ids = hostId ? [hostId] : Object.keys(state.hosts || {});
    if (ids.length === 0) throw Object.assign(new Error('No installed host bindings to repair'), { code: 'NO_INSTALLED_HOSTS' });
    const sync = await this.synchronizeDistribution();
    const registry = await this.#registry();
    const results = {};
    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) { results[id] = { ok: false, error: 'adapter-unavailable' }; continue; }
      try {
        const context = await this.#context(adapter, options, state);
        context.previousBinding = state.hosts?.[id] || { id };
        const binding = await adapter.install(context);
        state.hosts[id] = { ...(state.hosts[id] || {}), id, displayName: adapter.displayName, apiVersion: adapter.apiVersion, binding, updatedAt: nowIso(), installedAt: state.hosts[id]?.installedAt || nowIso() };
        results[id] = { ok: true, binding };
      } catch (error) {
        results[id] = { ok: false, error: error.code || 'REPAIR_FAILED', message: error.message };
      }
    }
    state.installedVersion = RUNTIME_VERSION;
    state.distributionDigest = sync.digest;
    state.runtimeRoot = this.runtimeRoot;
    state.runtimeStateRoot = this.runtimeStateRoot;
    await this.#saveState(state);
    return { ok: Object.values(results).every((item) => item.ok), distribution: sync, hosts: results };
  }

  async upgrade(options = {}) {
    return this.repair(null, options);
  }

  async uninstall(hostId, { purge = false, ...options } = {}) {
    const registry = await this.#registry();
    const adapter = registry.get(hostId);
    if (!adapter) throw Object.assign(new Error(`Unknown host adapter: ${hostId}`), { code: 'HOST_ADAPTER_NOT_FOUND' });
    const state = await this.#loadState();
    const previousBinding = state.hosts?.[hostId] || null;
    if (!previousBinding) return { host: hostId, removed: false, reason: 'not-recorded' };
    const otherHosts = Object.keys(state.hosts || {}).filter((id) => id !== hostId);
    if (purge && otherHosts.length > 0) {
      const error = new Error(`Cannot purge shared runtime while hosts remain installed: ${otherHosts.join(', ')}`);
      error.code = 'RUNTIME_STILL_REFERENCED';
      throw error;
    }
    const context = await this.#context(adapter, options, state);
    context.previousBinding = previousBinding;
    const result = await adapter.uninstall(context);
    delete state.hosts[hostId];
    const remainingHosts = Object.keys(state.hosts);
    let purged = false;
    if (purge) {
      if (remainingHosts.length > 0) {
        const error = new Error(`Cannot purge shared runtime while hosts remain installed: ${remainingHosts.join(', ')}`);
        error.code = 'RUNTIME_STILL_REFERENCED';
        throw error;
      }
      await fs.rm(this.runtimeRoot, { recursive: true, force: true });
      purged = true;
      state.installedVersion = null;
      state.distributionDigest = null;
    }
    await this.#saveState(state);
    return { host: hostId, removed: true, binding: result, remainingHosts, purged };
  }
}
