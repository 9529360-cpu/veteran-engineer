import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const planner = path.join(
  root,
  'skills',
  'runtime-regression-debugger',
  'scripts',
  'validation_planner.py'
);

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [planner, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('validation planner keeps known risk routes ready and preserves aliases', async (t) => {
  if (!(await exists(planner))) {
    t.skip('source Skill validation planner is not present in this isolated runtime fixture');
    return;
  }

  const result = runPython(['--risks', 'api,db,race', '--json']);
  assert.ok(result, 'python is required by the Skill validation planner regression');
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.coverage_complete, true);
  assert.deepEqual(payload.unmatched_risks, []);
  assert.deepEqual(payload.blockers, []);
  assert.deepEqual(payload.risks, ['api', 'database', 'concurrency']);
  assert.ok(payload.required_evidence.includes('API/schema contract tests'));
  assert.ok(payload.required_evidence.includes('integration test with real database semantics'));
  assert.ok(payload.required_evidence.includes('deterministic ordering/race test'));
});

test('validation planner returns a nonzero incomplete plan instead of hiding unmatched risks', async (t) => {
  if (!(await exists(planner))) {
    t.skip('source Skill validation planner is not present in this isolated runtime fixture');
    return;
  }

  const result = runPython(['--risks', 'api,cache-consistency', '--json']);
  assert.ok(result, 'python is required by the Skill validation planner regression');
  assert.equal(result.status, 1, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'needs-repository-specific-proof');
  assert.equal(payload.coverage_complete, false);
  assert.deepEqual(payload.unmatched_risks, ['cache-consistency']);
  assert.ok(payload.required_evidence.includes('API/schema contract tests'), 'known risk coverage must remain useful');
  assert.equal(payload.blockers.length, 1);
  assert.deepEqual(payload.blockers[0], {
    risk: 'cache-consistency',
    reason: 'no deterministic baseline route',
    required_action: 'add repository-specific evidence and adversarial coverage before claiming the validation plan is complete'
  });
  assert.match(payload.note, /intentionally not guessed into the nearest built-in route/);
});

test('validation planner plain output exposes incomplete coverage and status to human callers', async (t) => {
  if (!(await exists(planner))) {
    t.skip('source Skill validation planner is not present in this isolated runtime fixture');
    return;
  }

  const result = runPython(['--risks', 'custom-recovery-boundary']);
  assert.ok(result, 'python is required by the Skill validation planner regression');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /unmatched: custom-recovery-boundary/);
  assert.match(result.stdout, /status: needs-repository-specific-proof/);
});
