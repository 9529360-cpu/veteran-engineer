import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseVersions } from '../scripts/release-contract.mjs';

const base = {
  packageVersion: '0.4.0',
  lockVersion: '0.4.0',
  lockRootVersion: '0.4.0',
  pluginVersion: '0.4.0',
  runtimeVersion: '0.4.0'
};

test('release version contract accepts one aligned version and exact v-tag', () => {
  assert.equal(validateReleaseVersions({ ...base, tag: 'v0.4.0' }), '0.4.0');
});

test('release version contract rejects drift across authorities', () => {
  for (const field of ['lockVersion', 'lockRootVersion', 'pluginVersion', 'runtimeVersion']) {
    assert.throws(() => validateReleaseVersions({ ...base, [field]: '0.3.0' }));
  }
});

test('release version contract rejects a tag that does not match package version', () => {
  assert.throws(() => validateReleaseVersions({ ...base, tag: 'v0.4.1' }));
});

test('release version contract rejects a release intent for another version', () => {
  assert.equal(validateReleaseVersions({ ...base, intentVersion: '0.4.0' }), '0.4.0');
  assert.throws(() => validateReleaseVersions({ ...base, intentVersion: '0.4.1' }));
});
