import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanup } from './helpers.mjs';

const supervisorPath = fileURLToPath(new URL('../src/worker-supervisor.mjs', import.meta.url));

function waitForClose(child, timeoutMs = 4_000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supervisor did not exit')), timeoutMs))
  ]);
}

test('container supervisor never treats operator TMPDIR as an owned disposable runtime profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-engineer-operator-owned-'));
  const tmp = path.join(root, 'tmp');
  const sentinel = path.join(root, 'operator-owned.txt');
  let child = null;
  try {
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(sentinel, 'keep\n');
    child = fork(supervisorPath, [], { silent: true, windowsHide: true });
    child.send({
      type: 'start',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd: root,
      env: {
        PATH: process.env.PATH || '',
        TMP: tmp,
        TEMP: tmp,
        TMPDIR: tmp
      },
      container: { engine: 'veteran-missing-container-engine', name: 'temp-ownership-probe' }
    });
    await waitForClose(child);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep\n');
    assert.equal((await fs.stat(root)).isDirectory(), true);
  } finally {
    try { child?.kill('SIGKILL'); } catch {}
    await cleanup(root);
  }
});
