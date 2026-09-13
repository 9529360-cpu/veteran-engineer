import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathExists } from '../util.mjs';
import { HOST_ADAPTER_API_VERSION } from '../constants.mjs';
import { resolveSurfaceProfile } from '../surface-capabilities.mjs';

const ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

export function validateHostAdapter(adapter, source = '<built-in>') {
  if (!adapter || typeof adapter !== 'object') throw new Error(`Invalid host adapter from ${source}`);
  if (adapter.apiVersion !== HOST_ADAPTER_API_VERSION) {
    const error = new Error(`Host adapter ${adapter.id || source} API version ${adapter.apiVersion} is incompatible with ${HOST_ADAPTER_API_VERSION}`);
    error.code = 'HOST_ADAPTER_API_INCOMPATIBLE';
    throw error;
  }
  if (!ID_RE.test(adapter.id || '')) throw new Error(`Invalid host adapter id from ${source}: ${adapter.id}`);
  if (!adapter.displayName || typeof adapter.displayName !== 'string') throw new Error(`Host adapter ${adapter.id} missing displayName`);
  resolveSurfaceProfile(adapter.surfaceProfile || 'local-stdio');
  for (const method of ['install', 'status', 'doctor', 'uninstall']) {
    if (typeof adapter[method] !== 'function') throw new Error(`Host adapter ${adapter.id} missing ${method}()`);
  }
  return adapter;
}

export async function loadExternalAdapters(trustedDirs = []) {
  const adapters = [];
  for (const rawDir of trustedDirs) {
    const dir = path.resolve(rawDir);
    if (!(await pathExists(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
      const module = await import(pathToFileURL(path.join(dir, entry.name)).href);
      const adapter = validateHostAdapter(module.default || module.adapter, path.join(dir, entry.name));
      if (path.basename(entry.name, '.mjs') !== adapter.id) {
        const error = new Error(`External adapter filename must match id: ${entry.name} vs ${adapter.id}`);
        error.code = 'HOST_ADAPTER_FILENAME_MISMATCH';
        throw error;
      }
      adapters.push(adapter);
    }
  }
  return adapters;
}
