import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const v2 = fs.readFileSync(path.join(root, '.github', 'workflows', 'runtime-release-v2.yml'), 'utf8');
const packageWorkflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'package-plugin-artifact.yml'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'disable-legacy-runtime-release.yml'),
  'utf8',
);

test('Runtime Release V2 has no tag publication trigger or branch', () => {
  assert.equal(v2.includes('\n    tags:\n'), false);
  assert.equal(v2.includes('GITHUB_REF" == refs/tags/*'), false);
  assert.equal(v2.includes('reason=tag'), false);
  assert.ok(v2.includes('branches:\n      - main'));
  assert.ok(v2.includes('.github/release-intent.json'));
  assert.equal(v2.split('scripts/release-monotonicity.mjs').length - 1 >= 4, true);
});

test('Runtime Release V2 serializes publication with a bounded lossless queue', () => {
  assert.ok(v2.includes('group: veteran-runtime-release-publication'));
  assert.ok(v2.includes('cancel-in-progress: false'));
  assert.ok(v2.includes('queue: max'));
  assert.ok(v2.includes('Revalidate stable release monotonicity immediately before publication'));
});

test('Runtime Release V2 rejects draft and public asset ghosts', () => {
  assert.ok(v2.includes('Require exact draft asset inventory'));
  assert.ok(v2.includes('Draft release asset inventory differs from reproducible candidate'));
  assert.ok(v2.includes("actual_assets=\"$(jq -r '.assets[].name'"));
  assert.ok(v2.includes('test "$expected_assets" = "$actual_assets"'));
});

test('Workspace readiness trusts the fresh V2 workflow identity', () => {
  assert.ok(packageWorkflow.includes('367487813: "Runtime Release V2"'));
  assert.equal(packageWorkflow.includes('358757508: "Release"'), false);
  assert.ok(packageWorkflow.includes('.github/workflows/runtime-release-v2.yml'));
  assert.ok(packageWorkflow.includes('scripts/release-monotonicity.mjs'));
});

test('legacy workflow disable migration is narrowly scoped', () => {
  assert.ok(migration.includes('actions: write'));
  assert.ok(migration.includes('V2_ID="367487813"'));
  assert.ok(migration.includes('LEGACY_ID="358757508"'));
  assert.ok(migration.includes('/disable'));
  assert.ok(migration.includes('disabled_manually'));
  assert.equal(migration.includes('actions/checkout'), false);
  assert.equal(migration.includes('contents: write'), false);
});
