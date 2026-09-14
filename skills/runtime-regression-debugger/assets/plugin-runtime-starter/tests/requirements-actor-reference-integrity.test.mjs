import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gate = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'requirements_gate.py');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

function validManifest() {
  return {
    problem: {
      statement: 'Workspace members can retry project creation after an unknown response outcome.',
      outcome: 'Retries preserve one authoritative project while admins can inspect recovery state.'
    },
    actors: [
      { id: 'workspace-member', scope: 'one workspace' },
      { id: 'workspace-admin', scope: 'one workspace administration boundary' }
    ],
    requirements: [
      {
        id: 'REQ-1',
        actor: 'workspace-member',
        starting_state: 'the member is allowed to create projects',
        action: 'submits project creation and retries after an unknown response outcome',
        postcondition: 'one authoritative project exists for the logical request'
      },
      {
        id: 'REQ-2',
        actor: 'workspace-admin',
        starting_state: 'an unknown create outcome exists in the workspace',
        action: 'reviews the recovery state',
        postcondition: 'the admin sees the authoritative reconciliation state'
      }
    ],
    acceptance_criteria: [
      {
        id: 'AC-1',
        requirement_id: 'REQ-1',
        given: 'the first create committed but its response was lost',
        when: 'the member retries with the same request identity',
        then: 'the existing project is returned without creating a duplicate',
        evidence: 'integration retry-after-commit test'
      },
      {
        id: 'AC-2',
        requirement_id: 'REQ-2',
        given: 'an unknown project creation outcome exists',
        when: 'the admin opens recovery status',
        then: 'the current reconciliation state is visible',
        evidence: 'integration admin recovery-state test'
      }
    ],
    non_goals: ['Changing workspace role semantics'],
    failure_recovery: [
      {
        failure: 'response is lost after authoritative commit',
        recovery: 'reconcile by stable request identity',
        visible_state: 'one project and one explicit reconciliation outcome'
      }
    ],
    assumptions: [],
    open_product_decisions: [],
    validation_mapping: [
      { criterion_id: 'AC-1', oracle: 'retry after timeout-after-commit' },
      { criterion_id: 'AC-2', oracle: 'admin recovery-state integration check' }
    ],
    compatibility: {
      applicable: false,
      reason: 'fixture does not change a public compatibility boundary'
    }
  };
}

async function runManifest(t, manifest) {
  if (!(await exists(gate))) {
    t.skip('source Skill requirements gate is not present in this isolated runtime fixture');
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-requirements-actor-'));
  try {
    const target = path.join(dir, 'requirements.json');
    await fs.writeFile(target, JSON.stringify(manifest), 'utf8');
    const result = runPython(gate, [target, '--json']);
    assert.ok(result, 'python is required by the requirements actor regression');
    return { result, payload: JSON.parse(result.stdout) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('requirements gate accepts requirements that reference unique declared actors', async (t) => {
  const out = await runManifest(t, validManifest());
  if (!out) return;
  assert.equal(out.result.status, 0, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.gate_passed, true);
  assert.deepEqual(out.payload.blockers, []);
  assert.equal(out.payload.counts.actors, 2);
  assert.equal(out.payload.counts.requirements, 2);
});

test('requirements gate rejects duplicate actor ids before requirements can target an ambiguous actor', async (t) => {
  const manifest = validManifest();
  manifest.actors.push({ id: 'workspace-member', scope: 'a conflicting second workspace-member meaning' });

  const out = await runManifest(t, manifest);
  if (!out) return;
  assert.equal(out.result.status, 1, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.gate_passed, false);
  assert.ok(out.payload.blockers.some((item) =>
    item.code === 'ACTOR_ID_DUPLICATE'
    && item.path === 'actors[2].id'
    && item.message.includes('workspace-member')
  ));
});

test('requirements gate rejects a non-empty requirement actor that was never declared', async (t) => {
  const manifest = validManifest();
  manifest.requirements[0].actor = 'workspace-owner';

  const out = await runManifest(t, manifest);
  if (!out) return;
  assert.equal(out.result.status, 1, out.result.stderr || out.result.stdout);
  assert.equal(out.payload.gate_passed, false);
  assert.ok(out.payload.blockers.some((item) =>
    item.code === 'REQUIREMENT_ACTOR_UNKNOWN'
    && item.path === 'requirements[0].actor'
    && item.message.includes('workspace-owner')
  ));
  assert.ok(!out.payload.blockers.some((item) =>
    item.code === 'REQUIREMENT_FIELD_REQUIRED'
    && item.path === 'requirements[0].actor'
  ), 'a non-empty but unknown actor is a reference-integrity failure, not a missing field');
});

test('requirements actor references use exact declared identities instead of guessing aliases', async (t) => {
  const manifest = validManifest();
  manifest.requirements[1].actor = 'Workspace-Admin';

  const out = await runManifest(t, manifest);
  if (!out) return;
  assert.equal(out.result.status, 1, out.result.stderr || out.result.stdout);
  assert.ok(out.payload.blockers.some((item) =>
    item.code === 'REQUIREMENT_ACTOR_UNKNOWN'
    && item.path === 'requirements[1].actor'
  ));
});
