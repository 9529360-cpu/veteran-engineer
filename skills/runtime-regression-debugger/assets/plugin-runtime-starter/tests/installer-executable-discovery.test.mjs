import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { findExecutable } from '../src/installer/util.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('installer executable discovery skips non-executable POSIX shadow files', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-find-executable-');
  try {
    const shadowDir = path.join(root, 'shadow');
    const realDir = path.join(root, 'real');
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.mkdir(realDir, { recursive: true });
    const shadow = path.join(shadowDir, 'codex');
    const executable = path.join(realDir, 'codex');
    await fs.writeFile(shadow, '#!/bin/sh\nexit 9\n', { mode: 0o644 });
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await fs.chmod(shadow, 0o644);
    await fs.chmod(executable, 0o755);

    const resolved = await findExecutable('codex', { PATH: `${shadowDir}${path.delimiter}${realDir}` });
    assert.equal(resolved, executable, 'a non-executable PATH shadow must not hide a later executable CLI');
    assert.equal(await findExecutable(shadow, { PATH: '' }), null, 'an explicit non-executable path must not be reported as runnable');
    assert.equal(await findExecutable(executable, { PATH: '' }), executable);
  } finally {
    await cleanup(root);
  }
});
