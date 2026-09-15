import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bootstrapVeteran } from '../scripts/release-bootstrap.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bootstrapPath = path.join(root, 'scripts', 'release-bootstrap.mjs');
const required = {
  '@modelcontextprotocol/client': '2.0.0',
  '@modelcontextprotocol/core': '2.0.0',
  '@modelcontextprotocol/server': '2.0.0',
  zod: '4.2.0'
};

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function runtimeBundle({ version = '0.4.0', traversal = false } = {}) {
  const files = new Map([
    ['package.json', `${JSON.stringify({ name: 'veteran-engineer', version, optionalDependencies: required })}\n`],
    ['package-lock.json', `${JSON.stringify({ name: 'veteran-engineer', version, lockfileVersion: 3, packages: { '': { name: 'veteran-engineer', version, optionalDependencies: required } } })}\n`],
    ['.codex-plugin/plugin.json', `${JSON.stringify({ name: 'veteran-engineer', version })}\n`],
    ['src/constants.mjs', `export const RUNTIME_VERSION = '${version}';\n`],
    ['bin/veteran-engineer.mjs', '#!/usr/bin/env node\n'],
    ['README.md', 'fixture\n']
  ]);
  if (traversal) files.set('../escape', 'escape\n');
  const entries = [...files.entries()].map(([name, text]) => {
    const bytes = Buffer.from(text);
    return { path: name, mode: name === 'bin/veteran-engineer.mjs' ? 0o755 : 0o644, bytes: bytes.length, sha256: sha256(bytes), contentBase64: bytes.toString('base64') };
  });
  const bundle = { schemaVersion: 1, product: 'veteran-engineer', version, fileCount: entries.length, contentBytes: entries.reduce((sum, item) => sum + item.bytes, 0), files: entries };
  return Buffer.from(`${JSON.stringify(bundle)}\n`);
}

function response(body, options = {}) {
  return new Response(body, { status: options.status || 200, headers: options.headers || {} });
}

async function releaseFixture({ corruptRuntimeDigest = false, traversal = false } = {}) {
  const selfBytes = await fs.readFile(bootstrapPath);
  const runtimeBytes = runtimeBundle({ traversal });
  const bootstrapChecksum = Buffer.from(`${sha256(selfBytes)}  veteran-engineer-bootstrap.mjs\n`);
  const runtimeChecksum = Buffer.from(`${sha256(runtimeBytes)}  veteran-engineer-runtime.json\n`);
  const tag = 'v0.4.0';
  const commit = 'a'.repeat(40);
  const manifest = {
    schemaVersion: 1,
    product: 'veteran-engineer',
    version: '0.4.0',
    tag,
    commit,
    stateSchemaVersion: 3,
    assets: [
      { profile: 'bootstrap', filename: 'veteran-engineer-bootstrap.mjs', checksumFile: 'veteran-engineer-bootstrap.sha256', sha256: sha256(selfBytes), bytes: selfBytes.length },
      { profile: 'runtime', filename: 'veteran-engineer-runtime.json', checksumFile: 'veteran-engineer-runtime.sha256', sha256: sha256(runtimeBytes), bytes: runtimeBytes.length }
    ]
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const urls = {
    manifest: 'https://download.test/manifest',
    bootstrap: 'https://download.test/bootstrap',
    bootstrapChecksum: 'https://download.test/bootstrap-checksum',
    runtime: 'https://download.test/runtime',
    runtimeChecksum: 'https://download.test/runtime-checksum'
  };
  const release = {
    id: 44,
    tag_name: tag,
    target_commitish: commit,
    draft: false,
    prerelease: false,
    assets: [
      { name: 'veteran-engineer-release-manifest.json', size: manifestBytes.length, digest: `sha256:${sha256(manifestBytes)}`, browser_download_url: urls.manifest },
      { name: 'veteran-engineer-bootstrap.mjs', size: selfBytes.length, digest: `sha256:${sha256(selfBytes)}`, browser_download_url: urls.bootstrap },
      { name: 'veteran-engineer-bootstrap.sha256', size: bootstrapChecksum.length, digest: `sha256:${sha256(bootstrapChecksum)}`, browser_download_url: urls.bootstrapChecksum },
      { name: 'veteran-engineer-runtime.json', size: runtimeBytes.length, digest: `sha256:${corruptRuntimeDigest ? 'f'.repeat(64) : sha256(runtimeBytes)}`, browser_download_url: urls.runtime },
      { name: 'veteran-engineer-runtime.sha256', size: runtimeChecksum.length, digest: `sha256:${sha256(runtimeChecksum)}`, browser_download_url: urls.runtimeChecksum }
    ]
  };
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    if (String(url).endsWith('/repos/test/veteran/releases/latest')) return response(JSON.stringify(release), { headers: { 'content-type': 'application/json' } });
    if (url === urls.manifest) return response(manifestBytes);
    if (url === urls.bootstrapChecksum) return response(bootstrapChecksum);
    if (url === urls.runtime) return response(runtimeBytes);
    if (url === urls.runtimeChecksum) return response(runtimeChecksum);
    if (url === urls.bootstrap) return response(selfBytes);
    return response('missing', { status: 404 });
  };
  return { selfBytes, fetchImpl, fetchCount: () => fetchCount };
}

async function prepareDependencies({ root: runtimeRoot }) {
  for (const [name, version] of Object.entries(required)) {
    const file = path.join(runtimeRoot, 'node_modules', ...name.split('/'), 'package.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ name, version })}\n`);
  }
}

function bootstrapOptions(home, fixture, overrides = {}) {
  return {
    host: 'generic',
    home,
    repository: 'test/veteran',
    apiBase: 'https://api.test',
    fetchImpl: fixture.fetchImpl,
    selfBytes: fixture.selfBytes,
    prepareDependenciesImpl: prepareDependencies,
    bindHostImpl: async ({ runtimeRoot }) => ({ installed: true, runtimeRoot }),
    ...overrides
  };
}

test('zero-clone bootstrap verifies release, prepares dependencies, atomically installs runtime, then binds host', async () => {
  const home = await tempDir('veteran-bootstrap-success-');
  const fixture = await releaseFixture();
  try {
    const result = await bootstrapVeteran(bootstrapOptions(home, fixture));
    const runtimeRoot = path.join(home, 'plugins', 'veteran-engineer');
    assert.equal(result.ok, true);
    assert.equal(result.version, '0.4.0');
    assert.equal(result.release.tag, 'v0.4.0');
    assert.equal(JSON.parse(await fs.readFile(path.join(runtimeRoot, 'package.json'), 'utf8')).version, '0.4.0');
    assert.equal(JSON.parse(await fs.readFile(path.join(runtimeRoot, 'node_modules', 'zod', 'package.json'), 'utf8')).version, '4.2.0');
    const parentEntries = await fs.readdir(path.dirname(runtimeRoot));
    assert.equal(parentEntries.some((name) => name.startsWith('veteran-engineer.bootstrap-stage-')), false);
  } finally {
    await cleanup(home);
  }
});

test('bootstrap rejects an existing runtime before any release network request', async () => {
  const home = await tempDir('veteran-bootstrap-existing-');
  const fixture = await releaseFixture();
  const runtimeRoot = path.join(home, 'plugins', 'veteran-engineer');
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    await assert.rejects(bootstrapVeteran(bootstrapOptions(home, fixture)), (error) => error.code === 'BOOTSTRAP_RUNTIME_EXISTS');
    assert.equal(fixture.fetchCount(), 0);
  } finally {
    await cleanup(home);
  }
});

test('bootstrap digest or dependency failure leaves no active runtime', async () => {
  const digestHome = await tempDir('veteran-bootstrap-digest-');
  const dependencyHome = await tempDir('veteran-bootstrap-dependency-');
  const corrupt = await releaseFixture({ corruptRuntimeDigest: true });
  const valid = await releaseFixture();
  try {
    await assert.rejects(bootstrapVeteran(bootstrapOptions(digestHome, corrupt)), (error) => error.code === 'BOOTSTRAP_ASSET_DIGEST_MISMATCH');
    await assert.rejects(fs.access(path.join(digestHome, 'plugins', 'veteran-engineer')));

    await assert.rejects(bootstrapVeteran(bootstrapOptions(dependencyHome, valid, {
      prepareDependenciesImpl: async () => { throw Object.assign(new Error('registry down'), { code: 'TEST_REGISTRY_DOWN' }); }
    })), /registry down/);
    await assert.rejects(fs.access(path.join(dependencyHome, 'plugins', 'veteran-engineer')));
  } finally {
    await Promise.all([cleanup(digestHome), cleanup(dependencyHome)]);
  }
});

test('bootstrap independently rejects runtime bundle path traversal before promotion', async () => {
  const home = await tempDir('veteran-bootstrap-traversal-');
  const fixture = await releaseFixture({ traversal: true });
  try {
    await assert.rejects(bootstrapVeteran(bootstrapOptions(home, fixture)), (error) => error.code === 'BOOTSTRAP_RUNTIME_PATH_INVALID');
    await assert.rejects(fs.access(path.join(home, 'plugins', 'veteran-engineer')));
    await assert.rejects(fs.access(path.join(home, 'plugins', 'escape')));
  } finally {
    await cleanup(home);
  }
});

test('host binding failure keeps the verified runtime for explicit repair instead of deleting beneath partial host state', async () => {
  const home = await tempDir('veteran-bootstrap-bind-failure-');
  const fixture = await releaseFixture();
  const runtimeRoot = path.join(home, 'plugins', 'veteran-engineer');
  try {
    await assert.rejects(bootstrapVeteran(bootstrapOptions(home, fixture, {
      bindHostImpl: async () => { throw Object.assign(new Error('host mutation failed'), { code: 'HOST_MUTATION_FAILED' }); }
    })), /host mutation failed/);
    assert.equal(JSON.parse(await fs.readFile(path.join(runtimeRoot, 'package.json'), 'utf8')).version, '0.4.0');
  } finally {
    await cleanup(home);
  }
});
