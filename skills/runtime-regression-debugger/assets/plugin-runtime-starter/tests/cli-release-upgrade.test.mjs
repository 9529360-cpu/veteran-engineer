import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runProcess } from '../src/git.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'bin', 'veteran-engineer.mjs');

test('CLI routes --release through upgrade release selector validation', async () => {
  const home = await tempDir('veteran-cli-release-selector-');
  try {
    const result = await runProcess(process.execPath, [cli, 'upgrade', '--release', 'not-a-release', '--home', home, '--distribution-root', root], { cwd: root, allowFailure: true });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /RELEASE_SELECTOR_INVALID/);
  } finally {
    await cleanup(home);
  }
});
