import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const workspacePackage = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'package-plugin-artifact.yml'),
  'utf8',
);

test('runtime release trust root cannot self-publish', () => {
  for (const trustRoot of [
    '.github/workflows/release.yml',
    'scripts/release-contract.mjs',
    'scripts/release-candidate.mjs',
    'scripts/release-monotonicity.mjs',
  ]) {
    assert.ok(release.includes(trustRoot), `missing runtime release trust root: ${trustRoot}`);
  }
  assert.ok(release.includes('release-trust-root-validation-only'));
  assert.ok(release.includes('Runtime release trust root changed; land it first'));
});

test('stable runtime release must be monotonic before publish authority', () => {
  assert.ok(release.includes('Require monotonic public stable release'));
  assert.ok(release.includes('node scripts/release-monotonicity.mjs'));
  assert.ok(
    release.indexOf('Require monotonic public stable release') <
      release.indexOf('publish:\n    name: Publish release'),
  );
  assert.ok(release.includes('needs.authorize-release-source.result == \'success\''));
});

test('monotonicity gate changes trigger Release validation and quarantine Workspace publication', () => {
  assert.ok(release.includes('- "scripts/release-monotonicity.mjs"'));
  assert.ok(workspacePackage.includes('scripts/release-monotonicity.mjs'));
});
