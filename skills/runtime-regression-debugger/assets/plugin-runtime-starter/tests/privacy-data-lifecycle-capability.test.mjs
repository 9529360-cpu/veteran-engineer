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
const reference = path.join(skillRoot, 'references', 'privacy-data-lifecycle-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runRouter(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('privacy/data lifecycle routes to the focused owner and preserves convergence boundaries', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const direct = runRouter([
    '--signals',
    'privacy,data-privacy,data-minimization,consent-management,privacy-preference,data-retention,data-deletion,data-export,provider-data-egress,sensitive-logging',
    '--max', '12',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/privacy-data-lifecycle-engineering.md',
    'references/security-multitenancy-patterns.md',
    'references/data-consistency-migration-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md',
    'references/dependency-outcome-degradation.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runRouter([
    '--signals',
    'privacy-engineering,personal-data,pii-handling,purpose-limitation,consent-preference,cookie-consent,retention-policy,account-deletion,data-erasure,privacy-export,subject-data-export,third-party-data-sharing,pii-logging',
    '--max', '12',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runRouter(['--signals', 'data,delete,export,logging,tracking,cookie', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['data', 'delete', 'export', 'logging', 'tracking', 'cookie']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Authorization answers whether a principal may act on an object now/);
  assert.match(specialist, /Do not claim “deleted” when only the primary row is gone/);
  assert.match(specialist, /restored data must re-enter suppression\/deletion reconciliation/);
  assert.match(specialist, /TTL or “cleanup queued” is not proof of completion/);
  assert.match(specialist, /Observability must not become a shadow data lake/);
  assert.match(specialist, /A unit test proving `DELETE FROM users` ran is not lifecycle proof/);
});
