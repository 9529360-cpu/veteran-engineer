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
const reference = path.join(skillRoot, 'references', 'accessibility-product-engineering.md');

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

test('accessibility routes to the focused cross-client owner and retains task-level correctness boundaries', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const direct = runRouter([
    '--signals',
    'accessibility,screen-reader,keyboard-navigation,focus-management,reduced-motion,high-contrast,assistive-technology,accessible-form,aria,mobile-accessibility,desktop-accessibility',
    '--max', '12',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/accessibility-product-engineering.md',
    'references/frontend-implementation-patterns.md',
    'references/mobile-product-engineering.md',
    'references/host-shell-platform-patterns.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runRouter([
    '--signals',
    'a11y,screenreader,keyboard-accessibility,focus-trap,prefers-reduced-motion,forced-colors,assistive-tech,form-accessibility,wai-aria,ios-accessibility,android-accessibility,electron-accessibility',
    '--max', '12',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runRouter(['--signals', 'keyboard,focus,contrast,motion,label,button', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['keyboard', 'focus', 'contrast', 'motion', 'label', 'button']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /A clickable custom element is not equivalent to a button/);
  assert.match(specialist, /Define focus order and ownership/);
  assert.match(specialist, /Do not announce every render or intermediate state/);
  assert.match(specialist, /Required meaning must not depend only on color/);
  assert.match(specialist, /A browser-level pass does not prove native-shell accessibility/);
  assert.match(specialist, /Zero automated violations or the presence of ARIA attributes is not a completion claim/);
});
