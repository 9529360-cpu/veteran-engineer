import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersion,
  parseStableVersion,
  validateReleaseMonotonicity,
} from '../.github/scripts/release_monotonicity_gate.mjs';

test('stable release monotonicity accepts a strictly newer public version', () => {
  const result = validateReleaseMonotonicity({
    candidate: '0.5.0',
    releases: [
      { tag_name: 'v0.3.0', draft: false, prerelease: false },
      { tag_name: 'v0.4.0', draft: false, prerelease: false },
      { tag_name: 'v0.5.0-rc.1', draft: false, prerelease: true },
      { tag_name: 'v9.9.9', draft: true, prerelease: false },
    ],
    latestTag: 'v0.4.0',
  });

  assert.equal(result.candidate, 'v0.5.0');
  assert.equal(result.highestPublicStable, 'v0.4.0');
  assert.equal(result.monotonic, true);
});

test('stable release monotonicity rejects rollback or duplicate stable version', () => {
  for (const candidate of ['0.4.0', '0.3.9']) {
    assert.throws(
      () =>
        validateReleaseMonotonicity({
          candidate,
          releases: [{ tag_name: 'v0.4.0', draft: false, prerelease: false }],
          latestTag: 'v0.4.0',
        }),
      /must be newer than highest public stable v0\.4\.0/,
    );
  }
});

test('stable release pipeline rejects prerelease and build metadata', () => {
  for (const candidate of ['0.5.0-rc.1', '0.5.0+build.7', 'v0.5.0-rc.1']) {
    assert.throws(
      () =>
        validateReleaseMonotonicity({
          candidate,
          releases: [],
          latestTag: null,
        }),
      /requires plain x\.y\.z version/,
    );
  }
});

test('stable release monotonicity fails when GitHub latest pointer is already inconsistent', () => {
  assert.throws(
    () =>
      validateReleaseMonotonicity({
        candidate: '0.6.0',
        releases: [
          { tag_name: 'v0.4.0', draft: false, prerelease: false },
          { tag_name: 'v0.5.0', draft: false, prerelease: false },
        ],
        latestTag: 'v0.4.0',
      }),
    /latest=v0\.4\.0 highest=v0\.5\.0/,
  );
});

test('stable semver comparison is numeric rather than lexical', () => {
  assert.deepEqual(parseStableVersion('v1.10.0'), [1, 10, 0]);
  assert.equal(compareVersion([1, 10, 0], [1, 9, 9]), 1);
  assert.equal(compareVersion([2, 0, 0], [2, 0, 0]), 0);
  assert.equal(compareVersion([0, 9, 9], [1, 0, 0]), -1);
});
