import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { runProcess } from '../src/git.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'increment-state.mjs');

test('cross-process state lock serializes concurrent JSON mutations without lost updates', async () => {
  const root = await tempDir('veteran-lock-');
  try {
    const store = await new StateStore({ root }).init();
    await Promise.all(Array.from({ length: 8 }, () => runProcess(process.execPath, [fixture, root], { timeoutMs: 20_000 })));
    const state = await store.read();
    assert.equal(state.runtime.counter, 8);
    const audit = await store.verifyAudit();
    assert.equal(audit.ok, true);
    assert.ok(audit.entries >= 9);
  } finally {
    await cleanup(root);
  }
});
