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
const reference = path.join(skillRoot, 'references', 'collaboration-realtime-product-engineering.md');

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

test('collaboration/realtime routes to its owner and retains convergence/recovery invariants', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const routed = runRouter([
    '--signals',
    'collaboration,realtime-collaboration,presence,shared-state,collaborative-editing,optimistic-reconciliation,offline-collaboration,realtime-permissions,reconnect-recovery,event-ordering,collaboration-backpressure',
    '--max', '14',
    '--json'
  ]);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/collaboration-realtime-product-engineering.md',
    'references/distributed-systems-consistency.md',
    'references/data-consistency-migration-patterns.md',
    'references/frontend-product-patterns.md',
    'references/security-multitenancy-patterns.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runRouter([
    '--signals',
    'collaborative-app,multi-user-collaboration,real-time-collaboration,presence-state,shared-document,co-editing,optimistic-ui-reconciliation,offline-editing,live-permissions,reconnect-resume,message-ordering,slow-consumer',
    '--max', '14',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  assert.deepEqual(JSON.parse(aliases.stdout).unmatched_signals, []);

  const ambiguous = runRouter(['--signals', 'realtime,live,sync,websocket,socket,conflict', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['realtime', 'live', 'sync', 'websocket', 'socket', 'conflict']);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /The broadcast layer must not become a second writer/);
  assert.match(specialist, /Operation identity is not transport identity/);
  assert.match(specialist, /Timeout after commit is an unknown outcome/);
  assert.match(specialist, /Do not infer total order from “last packet received”/);
  assert.match(specialist, /Presence that cannot expire is eventually false durable-looking state/);
  assert.match(specialist, /“Was allowed when queued” is not current permission/);
  assert.match(specialist, /Revocation messages .* are not the authorization boundary/);
  assert.match(specialist, /A green WebSocket or two browser windows updating live is not evidence of collaboration correctness/);
});
