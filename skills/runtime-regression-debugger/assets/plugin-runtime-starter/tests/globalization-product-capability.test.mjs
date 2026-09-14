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
const reference = path.join(skillRoot, 'references', 'globalization-product-engineering.md');

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

test('globalization routes to the focused cross-client owner and keeps machine/time/input boundaries', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const direct = runRouter([
    '--signals',
    'globalization,internationalization,localization,rtl,bidi,ime,timezone,locale-formatting,unicode-input',
    '--max', '10',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/globalization-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/frontend-product-patterns.md',
    'references/temporal-debugging-state-transitions.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runRouter([
    '--signals',
    'i18n,internationalisation,l10n,localisation,right-to-left,bidirectional-text,bidi-text,input-method-editor,ime-composition,time-zone,timezone-handling,locale-aware-formatting,number-formatting,currency-formatting,unicode-text-input',
    '--max', '10',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runRouter(['--signals', 'translation,locale,time,date,formatting', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['translation', 'locale', 'time', 'date', 'formatting']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Translated labels must not become authority/);
  assert.match(specialist, /fallback locale must be a real supported catalog\/runtime target/i);
  assert.match(specialist, /offset such as `\+02:00` is not a durable timezone rule/);
  assert.match(specialist, /A visually mirrored layout does not prove semantic order/);
  assert.match(specialist, /IME composition is not finalized text/);
  assert.match(specialist, /A UI can show the right translation while submitting the wrong enum/);
});
