import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const reference = path.join(skillRoot, 'references', 'sdk-library-product-engineering.md');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runRouter(signals) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, '--signals', signals, '--max', '12', '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats SDK and library work as a first-class consumer product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'SDK/library reference must exist when routed');

  const direct = runRouter('sdk,library,client-library,public-library-api,semver,package-exports,generated-sdk,library-dependencies,package-publishing,library-deprecation');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/sdk-library-product-engineering.md',
    'references/cross-repo-contract-mesh.md',
    'references/api-backend-patterns.md',
    'references/semantic-diff-behavior-change.md',
    'references/dependency-supply-chain-patterns.md',
    'references/release-promotion-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md'
  ]) {
    assert.ok(paths.includes(expected), `expected route ${expected}`);
  }

  const aliases = runRouter('software-development-kit,client-sdk,developer-sdk,reusable-library,api-client-library,public-api-surface,semantic-versioning,package-entrypoints,package-exports-map,sdk-generation,generated-client-sdk,peer-dependencies,library-publishing,package-registry-release,library-deprecation-policy');
  assert.ok(aliases, 'Python is required to validate SDK/library aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'sdk', 'sdk', 'sdk', 'library', 'client-library', 'public-library-api', 'semver',
    'package-exports', 'package-exports', 'generated-sdk', 'generated-sdk',
    'library-dependencies', 'package-publishing', 'package-publishing', 'library-deprecation'
  ]);

  const ambiguous = runRouter('package,module,public-api,client');
  assert.ok(ambiguous, 'Python is required to validate ambiguous library terms');
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  const ambiguousPayload = JSON.parse(ambiguous.stdout);
  assert.deepEqual(ambiguousPayload.unmatched_signals, ['package', 'module', 'public-api', 'client']);
});
