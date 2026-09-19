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
const gate = path.join(skillRoot, 'scripts', 'product_analysis_gate.py');
const analysisReference = path.join(skillRoot, 'references', 'product-analysis-engineering.md');

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

test('engineering context router treats Product Analysis as a first-class full-stack capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(analysisReference), true, 'Product Analysis reference must exist when its route is published');

  const direct = runPython(router, [
    '--signals',
    'product-analysis,product-research,competitor-analysis,product-teardown,behavior-analysis,black-box-analysis,product-diff,capability-map,product-network-analysis,technical-fingerprint',
    '--max', '7',
    '--json'
  ]);
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/product-analysis-engineering.md'));
  assert.ok(paths.includes('references/product-analysis-engineering.md'));
  assert.ok(paths.includes('references/api-backend-patterns.md'));

  const aliases = runPython(router, [
    '--signals',
    'product-intelligence,competitive-analysis,blackbox-analysis,product-comparison,product-version-diff,feature-map,api-observation,technology-fingerprint',
    '--max', '7',
    '--json'
  ]);
  assert.ok(aliases, 'Python is required to validate Product Analysis aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'product-analysis',
    'competitor-analysis',
    'black-box-analysis',
    'competitor-analysis',
    'product-diff',
    'capability-map',
    'product-network-analysis',
    'technical-fingerprint'
  ]);
  assert.ok(aliasPayload.references.some((entry) => entry.path === 'references/product-analysis-engineering.md'));
});

test('product analysis gate requires evidence-backed observations and falsifiable inferences', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(gate), true, 'Product Analysis gate must exist when the source Skill package is present');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-product-analysis-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      target: {
        name: 'Example product',
        question: 'How does project creation recover from validation failure?',
        scope: 'authorized test account in browser'
      },
      evidence: [
        { id: 'e-ui', kind: 'interaction', summary: 'Submitting an empty name keeps the dialog open and renders an inline error.' },
        { id: 'e-net', kind: 'network', summary: 'A valid submit produces one POST request and a successful response.' }
      ],
      claims: [
        {
          id: 'c-observed',
          statement: 'Validation failure preserves the open creation dialog.',
          status: 'observed',
          confidence: 'high',
          evidence_ids: ['e-ui']
        },
        {
          id: 'c-inferred',
          statement: 'Project creation is server-backed rather than a local-only draft mutation.',
          status: 'inferred',
          confidence: 'medium',
          evidence_ids: ['e-net'],
          rationale: 'The visible successful action is paired with a POST request.',
          falsifier: 'Repeat while intercepting the POST and prove the project still persists.'
        },
        {
          id: 'c-unknown',
          statement: 'Whether duplicate POST retries are idempotent is not yet known.',
          status: 'unknown',
          confidence: 'low',
          evidence_ids: []
        }
      ]
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid, 'Python is required to validate Product Analysis manifests');
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.deepEqual(validPayload.counts, {
      claims: 3,
      evidence: 2,
      inferred: 1,
      observed: 1,
      unknown: 1
    });

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      target: {
        name: 'Example product',
        question: 'What happens?',
        scope: 'public surface'
      },
      evidence: [
        { id: 'e-one', kind: 'screenshot', summary: 'Current page state.' }
      ],
      claims: [
        {
          id: 'c-observed',
          statement: 'A backend mutation definitely occurred.',
          status: 'observed',
          confidence: 'high',
          evidence_ids: []
        },
        {
          id: 'c-inferred',
          statement: 'The server likely uses a specific hidden data model.',
          status: 'inferred',
          confidence: 'medium',
          evidence_ids: ['missing-evidence'],
          rationale: 'One UI label suggests it.'
        }
      ]
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = invalidPayload.blockers.map((item) => item.code);
    assert.ok(codes.includes('OBSERVED_CLAIM_REQUIRES_EVIDENCE'));
    assert.ok(codes.includes('CLAIM_EVIDENCE_MISSING'));
    assert.ok(codes.includes('INFERRED_CLAIM_REQUIRES_FALSIFIER'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
