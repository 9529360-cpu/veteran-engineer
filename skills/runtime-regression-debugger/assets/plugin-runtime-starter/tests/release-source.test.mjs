import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { GitHubReleaseSource } from '../src/installer/release-source.mjs';
import { writeRuntimeBundle, RUNTIME_DISTRIBUTION_ROOTS } from '../src/installer/runtime-bundle.mjs';
import { tempDir, cleanup } from './helpers.mjs';

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

async function fixture(root, version) {
  for (const rel of RUNTIME_DISTRIBUTION_ROOTS) {
    const target = path.join(root, rel);
    if (['.mcp.json', 'NEXT_CHAT_HANDOFF.md', 'README.md', 'package-lock.json', 'package.json'].includes(rel)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, rel === 'package.json' ? `${JSON.stringify({ name: 'veteran-engineer', version })}\n` : `${rel}\n`);
    } else await fs.mkdir(target, { recursive: true });
  }
  await fs.writeFile(path.join(root, '.codex-plugin', 'plugin.json'), `${JSON.stringify({ name: 'veteran-engineer', version })}\n`);
  await fs.writeFile(path.join(root, 'src', 'constants.mjs'), `export const RUNTIME_VERSION = '${version}';\n`);
  await fs.mkdir(path.join(root, 'skills', 'runtime-regression-debugger'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills', 'runtime-regression-debugger', 'SKILL.md'), 'skill\n');
}

function response(value, init = {}) {
  return new Response(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value), { status: 200, ...init });
}

async function releaseFixture({ draft = false, prerelease = false, omitRuntimeDigest = false } = {}) {
  const source = await tempDir('veteran-release-source-files-');
  const installerRoot = await tempDir('veteran-release-source-installer-');
  const version = '1.2.3';
  const tag = `v${version}`;
  const commit = 'a'.repeat(40);
  await fixture(source, version);
  const runtimePath = path.join(source, '..', `runtime-${crypto.randomUUID()}.json`);
  const built = await writeRuntimeBundle({ root: source, output: runtimePath, version });
  const runtimeBytes = await fs.readFile(runtimePath);
  const checksumBytes = Buffer.from(`${built.sha256}  veteran-engineer-runtime.json\n`);
  const manifest = {
    schemaVersion: 1,
    product: 'veteran-engineer',
    version,
    tag,
    commit,
    stateSchemaVersion: 3,
    assets: [{ profile: 'runtime', filename: 'veteran-engineer-runtime.json', checksumFile: 'veteran-engineer-runtime.sha256', sha256: built.sha256, bytes: runtimeBytes.length }]
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const urls = {
    manifest: 'https://download.test/manifest',
    runtime: 'https://download.test/runtime',
    checksum: 'https://download.test/checksum'
  };
  const release = {
    id: 42,
    tag_name: tag,
    target_commitish: commit,
    draft,
    prerelease,
    assets: [
      { name: 'veteran-engineer-release-manifest.json', digest: `sha256:${digest(manifestBytes)}`, browser_download_url: urls.manifest },
      { name: 'veteran-engineer-runtime.json', digest: omitRuntimeDigest ? null : `sha256:${digest(runtimeBytes)}`, browser_download_url: urls.runtime },
      { name: 'veteran-engineer-runtime.sha256', digest: `sha256:${digest(checksumBytes)}`, browser_download_url: urls.checksum }
    ]
  };
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/repos/test/veteran/releases/latest')) return response(release, { headers: { 'content-type': 'application/json' } });
    if (url === urls.manifest) return response(manifestBytes);
    if (url === urls.runtime) return response(runtimeBytes);
    if (url === urls.checksum) return response(checksumBytes);
    return new Response('missing', { status: 404 });
  };
  return { source, installerRoot, runtimePath, fetchImpl, version, tag, commit };
}

test('release source stages only a stable exact-commit release with verified manifest/runtime digests', async () => {
  const f = await releaseFixture();
  try {
    const source = new GitHubReleaseSource({ repository: 'test/veteran', apiBase: 'https://api.test', fetchImpl: f.fetchImpl, installerRoot: f.installerRoot });
    const staged = await source.stage('latest');
    assert.equal(staged.version, f.version);
    assert.equal(staged.tag, f.tag);
    assert.equal(staged.commit, f.commit);
    assert.equal(JSON.parse(await fs.readFile(path.join(staged.root, 'package.json'), 'utf8')).version, f.version);
    const stageParent = path.dirname(staged.root);
    await staged.cleanup();
    await assert.rejects(fs.access(stageParent));
  } finally {
    await Promise.all([cleanup(f.source), cleanup(f.installerRoot), fs.rm(f.runtimePath, { force: true })]);
  }
});

test('release source fails closed on unstable releases and missing GitHub asset digests', async () => {
  const draft = await releaseFixture({ draft: true });
  const missing = await releaseFixture({ omitRuntimeDigest: true });
  try {
    await assert.rejects(new GitHubReleaseSource({ repository: 'test/veteran', apiBase: 'https://api.test', fetchImpl: draft.fetchImpl, installerRoot: draft.installerRoot }).stage('latest'), (error) => error.code === 'RELEASE_NOT_STABLE');
    await assert.rejects(new GitHubReleaseSource({ repository: 'test/veteran', apiBase: 'https://api.test', fetchImpl: missing.fetchImpl, installerRoot: missing.installerRoot }).stage('latest'), (error) => error.code === 'RELEASE_ASSET_DIGEST_MISSING');
  } finally {
    await Promise.all([
      cleanup(draft.source), cleanup(draft.installerRoot), fs.rm(draft.runtimePath, { force: true }),
      cleanup(missing.source), cleanup(missing.installerRoot), fs.rm(missing.runtimePath, { force: true })
    ]);
  }
});
