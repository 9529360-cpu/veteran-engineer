import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertPathsWithinScope } from '../src/git.mjs';
import { within } from '../src/util.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

test('within accepts contained names beginning with two dots but rejects real parent and sibling paths', async () => {
  const fixture = await createGitRepo();
  try {
    const root = fixture.repo;
    assert.equal(within(root, path.join(root, '..metadata.txt')), true);
    assert.equal(within(root, path.join(root, '..folder', 'nested.txt')), true);
    assert.equal(within(root, path.resolve(root, '..', 'outside.txt')), false);
    assert.equal(within(root, `${root}-sibling`), false);
  } finally {
    await cleanup(fixture.root);
  }
});

test('git write-scope validation accepts dotdot-named files and still rejects symlink escape', async () => {
  const fixture = await createGitRepo();
  try {
    const contained = path.join(fixture.repo, '..metadata.txt');
    await fs.writeFile(contained, 'contained\n');
    await assert.doesNotReject(() => assertPathsWithinScope(fixture.repo, ['..metadata.txt'], ['..metadata.txt']));

    const outside = path.join(fixture.root, 'outside.txt');
    const link = path.join(fixture.repo, 'escape-link.txt');
    await fs.writeFile(outside, 'outside\n');
    await fs.symlink(outside, link);
    await assert.rejects(
      () => assertPathsWithinScope(fixture.repo, ['escape-link.txt'], ['escape-link.txt']),
      (error) => error?.code === 'SYMLINK_SCOPE_VIOLATION'
    );
  } finally {
    await cleanup(fixture.root);
  }
});
