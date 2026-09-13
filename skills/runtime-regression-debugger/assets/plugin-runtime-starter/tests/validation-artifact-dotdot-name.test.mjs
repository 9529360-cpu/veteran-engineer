import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { collectValidationArtifacts, normalizeValidationArtifacts } from '../src/validation-artifact-collector.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('validation artifact collector accepts contained names beginning with two dots', async () => {
  const root = await tempDir('veteran-artifact-dotdot-');
  try {
    await fs.writeFile(path.join(root, '..metadata.json'), '{"ok":true}\n');
    await fs.mkdir(path.join(root, '..screenshots'), { recursive: true });
    await fs.writeFile(path.join(root, '..screenshots', 'frame.txt'), 'frame\n');

    const declarations = normalizeValidationArtifacts([
      { path: '..metadata.json', required: true, kind: 'metadata' },
      { path: '..screenshots', required: true, kind: 'screenshot' }
    ]);
    const collected = await collectValidationArtifacts(root, declarations);

    assert.equal(collected.summary.complete, true);
    assert.equal(collected.summary.requiredMissing, false);
    assert.equal(collected.summary.files, 2);
    assert.deepEqual(collected.attachments.map((item) => item.name), [
      '..metadata.json',
      '..screenshots/frame.txt'
    ]);
    assert.equal(collected.attachments[0].content.toString('utf8'), '{"ok":true}\n');
    assert.equal(collected.attachments[1].content.toString('utf8'), 'frame\n');
  } finally {
    await cleanup(root);
  }
});

test('validation artifact normalization still rejects real parent traversal', () => {
  assert.throws(
    () => normalizeValidationArtifacts(['../outside.txt']),
    (error) => error?.code === 'VALIDATION_ARTIFACT_PATH_ESCAPE'
  );
});
