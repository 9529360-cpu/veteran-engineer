import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeStudioUsage, runNativeStudioCli } from '../src/native-studio-cli.mjs';

function capture() {
  let value = '';
  return { stdout: { write(chunk) { value += chunk; } }, read: () => value };
}

test('studio usage advertises integrated free site and visual-pack workflows', () => {
  const usage = nativeStudioUsage();
  assert.match(usage, /veteran-engineer studio site/);
  assert.match(usage, /visual-pack/);
  assert.match(usage, /No Figma, Canva, Wix/);
});

test('studio CLI builds a visual pack from a local JSON spec', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-cli-'));
  const specPath = path.join(root, 'visual.json');
  const out = path.join(root, 'out');
  await fs.writeFile(specPath, JSON.stringify({ name: 'Launch', title: 'Ship without subscriptions', formats: ['square'] }), 'utf8');
  const io = capture();
  const result = await runNativeStudioCli(['visual-pack', specPath, '--out', out, '--json'], { stdout: io.stdout });
  assert.equal(result.formats[0], 'square');
  assert.match(io.read(), /veteran-native-studio-visual-pack-v1/);
  await fs.access(path.join(out, 'launch-square.svg'));
});
