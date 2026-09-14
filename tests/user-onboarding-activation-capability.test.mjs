import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const stewardship = path.join(skillRoot, 'references', 'proactive-product-stewardship.md');
const reference = path.join(skillRoot, 'references', 'user-onboarding-activation-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

test('product stewardship reaches a focused first-value onboarding owner', async (t) => {
  if (!(await exists(stewardship))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(reference), true, 'user onboarding specialist must exist');

  const stewardshipText = await fs.readFile(stewardship, 'utf8');
  assert.match(stewardshipText, /user-onboarding-activation-product-engineering\.md/);
  assert.match(stewardshipText, /activation as an authoritative product outcome/i);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Activation is the product outcome/);
  assert.match(specialist, /Do not create a second checklist truth/);
  assert.match(specialist, /Existing users and migration/);
  assert.match(specialist, /Reconcile from authoritative product state/);
  assert.match(specialist, /Lifecycle cleanup/);
});
