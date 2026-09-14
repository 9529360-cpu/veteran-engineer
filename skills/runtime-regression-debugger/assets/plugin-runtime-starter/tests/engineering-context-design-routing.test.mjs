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
const frontend = path.join(skillRoot, 'references', 'frontend-product-patterns.md');

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
    const result = spawnSync(executable, [router, '--signals', signals, '--max', '7', '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats UI and product design as first-class frontend capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const direct = runRouter('ui,ux,product-design,wireframe,design-system,visual-design');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  assert.equal(payload.truncated, false);
  assert.deepEqual(payload.signals, ['ui', 'ux', 'product-design', 'wireframe', 'design-system', 'visual-design']);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/frontend-product-patterns.md'));
  assert.ok(paths.includes('references/full-stack-product-engineering.md'));

  const aliases = runRouter('interface-design,ux-design,design-tokens,responsive-ui');
  assert.ok(aliases, 'Python is required to validate the Skill context router aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, ['ui', 'ux', 'design-system', 'responsive-design']);
  assert.ok(aliasPayload.references.some((entry) => entry.path === 'references/frontend-product-patterns.md'));
});

test('frontend owner preserves the core forms and data-entry correctness boundaries', async (t) => {
  if (!(await exists(frontend))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const text = await fs.readFile(frontend, 'utf8');
  assert.match(text, /## Forms and data entry/);
  assert.match(text, /Keep editable draft, authoritative validation, and durably persisted state distinct/);
  assert.match(text, /Debounce controls request frequency; it does not establish write ordering or durability/);
  assert.match(text, /Disabling a submit button can reduce accidental double clicks\. It does not make a non-idempotent server mutation safe/);
  assert.match(text, /After an ambiguous timeout, reconcile before blindly repeating an irreversible action/);
  assert.match(text, /Disabled, read-only, or hidden presentation is never an authorization boundary/);
  assert.match(text, /IME composition, autofill, password managers, pasted content, and mobile keyboard behavior/);
  assert.match(text, /old clients and durable drafts/);
});
