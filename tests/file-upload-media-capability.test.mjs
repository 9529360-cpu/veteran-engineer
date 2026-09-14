import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const reference = path.join(skillRoot, 'references', 'file-upload-media-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runRouter(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('file/upload/media routes to the lifecycle owner and retains transfer/processing correctness', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const direct = runRouter([
    '--signals',
    'file-upload,resumable-upload,multipart-upload,attachment-flow,object-delivery,media-processing,signed-object-url,upload-quarantine,upload-lifecycle,remote-file-import',
    '--max', '13',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/file-upload-media-product-engineering.md',
    'references/security-multitenancy-patterns.md',
    'references/data-movement-cdc-search-storage.md',
    'references/async-edge-job-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md',
    'references/dependency-outcome-degradation.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runRouter([
    '--signals',
    'direct-upload,presigned-upload,resume-upload,chunked-upload,file-attachment,download-delivery,media-transcoding,thumbnail-processing,presigned-download,virus-scan-upload,orphan-upload-cleanup,import-from-url',
    '--max', '13',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runRouter(['--signals', 'file,upload,download,storage,media,url,attachment', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['file', 'upload', 'download', 'storage', 'media', 'url', 'attachment']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /“Object exists” is not “file is ready”/);
  assert.match(specialist, /timeout after finalization or attachment may be an unknown outcome/);
  assert.match(specialist, /A preview\/download path must not bypass quarantine/);
  assert.match(specialist, /stale work for version N must not publish over N\+1/);
  assert.match(specialist, /Shared\/deduplicated bytes need reference ownership/);
  assert.match(specialist, /The useful oracle is not HTTP 200 or bucket presence/);
});
