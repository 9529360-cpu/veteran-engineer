import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncRuntimeStarterMirror, verifyRuntimeStarterMirror } from '../scripts/runtime-starter-mirror.mjs';

test('runtime starter mirror sync repairs content and file-set drift from one source owner', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-runtime-mirror-'));
  const root = path.join(temp, 'root');
  const starterRoot = path.join(temp, 'starter');
  const mirrorRoots = ['README.md', 'src'];
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(starterRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'README.md'), 'current readme\n');
    await fs.writeFile(path.join(root, 'src', 'a.txt'), 'current source\n');
    await fs.writeFile(path.join(starterRoot, 'README.md'), 'stale readme\n');
    await fs.writeFile(path.join(starterRoot, 'src', 'a.txt'), 'stale source\n');
    await fs.writeFile(path.join(starterRoot, 'src', 'obsolete.txt'), 'remove me\n');

    await assert.rejects(
      verifyRuntimeStarterMirror({ root, starterRoot, mirrorRoots }),
      /Runtime starter .*drifted/
    );

    const synced = await syncRuntimeStarterMirror({ root, starterRoot, mirrorRoots });
    assert.deepEqual(synced, { enforced: true, files: 2 });
    assert.equal(await fs.readFile(path.join(starterRoot, 'README.md'), 'utf8'), 'current readme\n');
    assert.equal(await fs.readFile(path.join(starterRoot, 'src', 'a.txt'), 'utf8'), 'current source\n');
    await assert.rejects(fs.access(path.join(starterRoot, 'src', 'obsolete.txt')));
    assert.deepEqual(
      await verifyRuntimeStarterMirror({ root, starterRoot, mirrorRoots }),
      { enforced: true, files: 2 }
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
