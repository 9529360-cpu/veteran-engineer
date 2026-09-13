import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const gate = path.join(skillRoot, 'scripts', 'requirements_gate.py');
const reference = path.join(skillRoot, 'references', 'product-requirements-engineering.md');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats product requirements as a first-class capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Product Requirements reference must exist when its route is published');

  const direct = runPython(router, [
    '--signals',
    'product-requirements,prd,user-story,acceptance-criteria,requirement-discovery,scope-definition,requirements,scope',
    '--max', '7',
    '--json'
  ]);
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/product-requirements-engineering.md'));
  assert.ok(paths.includes('references/full-stack-product-engineering.md'));
  assert.ok(paths.includes('references/engineering-evidence-gates.md'));
  assert.ok(paths.includes('references/product-analysis-engineering.md'));

  const aliases = runPython(router, [
    '--signals',
    'product-spec,product-specification,requirements-engineering,requirements-discovery,story,user-stories,acceptance,acceptance-test,scoping',
    '--max', '7',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'product-requirements',
    'product-requirements',
    'product-requirements',
    'requirement-discovery',
    'user-story',
    'user-story',
    'acceptance-criteria',
    'acceptance-criteria',
    'scope-definition'
  ]);
});

test('requirements gate enforces traceable acceptance and recovery contracts', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(gate), true, 'Requirements gate must exist when source Skill package is present');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-requirements-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      problem: {
        statement: 'Users can accidentally create duplicate projects after retrying a timed-out request.',
        outcome: 'A retry of the same logical create action never creates a second project.'
      },
      actors: [
        { id: 'workspace-member', scope: 'one workspace' }
      ],
      requirements: [
        {
          id: 'REQ-1',
          actor: 'workspace-member',
          starting_state: 'the member can create projects',
          action: 'submits a create request and retries after an unknown response outcome',
          postcondition: 'the workspace contains exactly one project for the logical create action'
        }
      ],
      acceptance_criteria: [
        {
          id: 'AC-1',
          requirement_id: 'REQ-1',
          given: 'the first create commits but its response is lost',
          when: 'the client retries with the same idempotency identity',
          then: 'the existing project is returned and no duplicate project is created',
          evidence: 'integration test exercising timeout-after-commit and retry'
        }
      ],
      non_goals: ['Changing project naming rules'],
      failure_recovery: [
        {
          failure: 'response lost after authoritative commit',
          recovery: 'reconcile by stable request identity rather than replaying a new mutation',
          visible_state: 'one existing project and a non-ambiguous retry result'
        }
      ],
      assumptions: [
        {
          statement: 'The existing request ledger is the idempotency authority.',
          falsifier: 'Trace project creation and prove another owner controls duplicate suppression.'
        }
      ],
      open_product_decisions: [],
      validation_mapping: [
        { criterion_id: 'AC-1', oracle: 'real create path with injected timeout-after-commit' }
      ],
      compatibility: {
        applicable: true,
        window: 'old and new clients may overlap during rollout',
        rollout: 'server behavior remains backward compatible while clients adopt retry identity',
        recovery: 'disable new client retry behavior or forward-repair ledger state'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.equal(validPayload.counts.requirements, 1);
    assert.equal(validPayload.counts.acceptance_criteria, 1);
    assert.equal(validPayload.counts.validation_mappings, 1);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      problem: { statement: 'Vague feature request', outcome: '' },
      actors: [],
      requirements: [
        { id: 'REQ-1', actor: '', starting_state: '', action: 'do something', postcondition: '' }
      ],
      acceptance_criteria: [
        { id: 'AC-1', requirement_id: 'MISSING', given: '', when: '', then: '', evidence: '' }
      ],
      non_goals: [null],
      failure_recovery: [],
      assumptions: [{ statement: 'Probably okay' }],
      open_product_decisions: [{ question: 'Delete permanently?' }],
      validation_mapping: [],
      compatibility: { applicable: true }
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'PROBLEM_FIELD_REQUIRED',
      'ACTORS_REQUIRED',
      'REQUIREMENT_FIELD_REQUIRED',
      'ACCEPTANCE_REQUIREMENT_MISSING',
      'ACCEPTANCE_FIELD_REQUIRED',
      'NON_GOALS_INVALID',
      'FAILURE_RECOVERY_REQUIRED',
      'ASSUMPTION_INVALID',
      'OPEN_DECISION_INVALID',
      'VALIDATION_MAPPING_REQUIRED',
      'ACCEPTANCE_UNMAPPED',
      'COMPATIBILITY_FIELD_REQUIRED'
    ]) {
      assert.ok(codes.has(code), `expected blocker ${code}`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
