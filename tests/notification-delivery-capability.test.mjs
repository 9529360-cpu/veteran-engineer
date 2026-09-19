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
const reference = path.join(skillRoot, 'references', 'notification-delivery-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('notification signals route to the focused delivery owner and relevant companion mechanisms', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const routed = runPython([
    '--signals',
    'notification-delivery,push-notification,notification-preferences,notification-scheduling,notification-template,delivery-receipts,webhook-delivery,notification-fanout',
    '--max', '16',
    '--json'
  ]);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/notification-delivery-product-engineering.md',
    'references/async-edge-job-patterns.md',
    'references/mobile-product-engineering.md',
    'references/privacy-data-lifecycle-engineering.md',
    'references/temporal-debugging-state-transitions.md',
    'references/globalization-product-engineering.md',
    'references/dependency-outcome-degradation.md',
    'references/security-multitenancy-patterns.md',
    'references/performance-scale-patterns.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython([
    '--signals',
    'notifications,transactional-email,text-message-notification,mobile-push,inapp-notification,notification-settings,notification-schedule,notification-templates,notification-deduplication,delivery-status,outbound-webhook,notification-broadcast',
    '--max', '16',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runPython(['--signals', 'email,sms,push,message,webhook,template,broadcast', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  const ambiguousPayload = JSON.parse(ambiguous.stdout);
  assert.deepEqual(ambiguousPayload.unmatched_signals, ['email', 'sms', 'push', 'message', 'template', 'broadcast']);
  assert.ok(ambiguousPayload.signals.includes('webhook-delivery'));

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /one durable logical notification intent/);
  assert.match(specialist, /After timeout or unknown provider outcome, reconcile the existing attempt/);
  assert.match(specialist, /Software rollback cannot unsend/);
});
