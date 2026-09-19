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
const gate = path.join(skillRoot, 'scripts', 'product_improvement_gate.py');
const improvementReference = path.join(skillRoot, 'references', 'product-analytics-experimentation.md');

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

test('engineering context router treats product improvement as a first-class full-stack capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(improvementReference), true, 'Product Improvement reference must exist when its route is published');

  const direct = runPython(router, [
    '--signals',
    'product-improvement,product-analytics,instrumentation,funnel-analysis,retention-analysis,experimentation,ab-test,feature-rollout',
    '--max', '7',
    '--json'
  ]);
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/product-analytics-experimentation.md'));
  assert.ok(paths.includes('references/proactive-product-stewardship.md'));
  assert.ok(paths.includes('references/operability-control-plane-contract.md'));

  const aliases = runPython(router, [
    '--signals',
    'analytics,product-metrics,event-tracking,funnel,retention,experiment,a-b-test,feature-flag-rollout',
    '--max', '7',
    '--json'
  ]);
  assert.ok(aliases, 'Python is required to validate Product Improvement aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'product-analytics',
    'instrumentation',
    'funnel-analysis',
    'retention-analysis',
    'experimentation',
    'ab-test',
    'feature-rollout'
  ]);
});

test('product improvement gate requires a decision-linked metric, quality checks, and complete experiment semantics', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(gate), true, 'Product Improvement gate must exist when the source Skill package is present');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-product-improvement-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      question: 'Does the redesigned onboarding improve activation without increasing failures?',
      decision: 'Ramp treatment if activation improves and failure guardrail remains inside the rollback bound.',
      population: 'new eligible workspaces',
      events: [
        {
          id: 'onboarding_completed_v1',
          kind: 'event',
          trigger: 'authoritative onboarding completion commits',
          authority: 'server domain transition',
          properties: ['workspace_id', 'flow_version']
        },
        {
          id: 'onboarding_exposed_v1',
          kind: 'exposure',
          trigger: 'eligible workspace actually receives the assigned flow',
          authority: 'application flag boundary',
          properties: ['workspace_id', 'experiment_id', 'variant']
        }
      ],
      metrics: [
        {
          id: 'activation_rate_v1',
          role: 'primary',
          definition: 'eligible workspaces completing onboarding within 24 hours / exposed eligible workspaces',
          unit: 'workspace',
          window: '24h from first exposure',
          source_event_ids: ['onboarding_exposed_v1', 'onboarding_completed_v1']
        },
        {
          id: 'onboarding_failure_rate_v1',
          role: 'guardrail',
          definition: 'eligible workspaces with terminal onboarding failure / exposed eligible workspaces',
          unit: 'workspace',
          window: '24h from first exposure',
          source_event_ids: ['onboarding_exposed_v1']
        }
      ],
      experiments: [
        {
          id: 'onboarding_redesign_v1',
          kind: 'experiment',
          hypothesis: 'The redesigned flow increases activation.',
          eligibility: 'new workspaces that have not started onboarding',
          randomization_unit: 'workspace',
          assignment_authority: 'server-side experiment assignment',
          exposure_event_id: 'onboarding_exposed_v1',
          variants: ['control', 'redesign'],
          decision_rule: 'Ramp if primary improves materially and guardrail remains acceptable.',
          rollback_rule: 'Stop treatment if onboarding failures exceed the configured safety bound.',
          cleanup: 'Remove experiment assignment and temporary exposure fields after final decision.'
        }
      ],
      data_quality: [
        'check exposure counts against configured allocation',
        'check missing/duplicate completion events around retries'
      ],
      privacy: {
        purpose: 'measure onboarding product outcomes',
        retention: 'retain only for the approved product analytics window'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid, 'Python is required to validate Product Improvement manifests');
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.equal(validPayload.counts.primary_metrics, 1);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      question: 'Did engagement move?',
      decision: '',
      population: 'users',
      events: [
        {
          id: 'assignment_only',
          kind: 'event',
          trigger: 'assignment computed',
          authority: 'client',
          properties: []
        }
      ],
      metrics: [
        {
          id: 'engagement',
          role: 'diagnostic',
          definition: 'some clicks',
          unit: 'user',
          window: '7d',
          source_event_ids: ['missing-event']
        }
      ],
      experiments: [
        {
          id: 'exp',
          kind: 'experiment',
          eligibility: 'all users',
          randomization_unit: 'user',
          assignment_authority: 'client',
          exposure_event_id: 'missing-exposure',
          variants: ['control'],
          decision_rule: '',
          rollback_rule: '',
          cleanup: ''
        }
      ],
      data_quality: [],
      privacy: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = invalidPayload.blockers.map((item) => item.code);
    assert.ok(codes.includes('DECISION_REQUIRED'));
    assert.ok(codes.includes('PRIMARY_METRIC_COUNT'));
    assert.ok(codes.includes('METRIC_SOURCE_MISSING'));
    assert.ok(codes.includes('EXPOSURE_EVENT_MISSING'));
    assert.ok(codes.includes('EXPERIMENT_VARIANTS_INVALID'));
    assert.ok(codes.includes('DATA_QUALITY_REQUIRED'));
    assert.ok(codes.includes('PRIVACY_PURPOSE_REQUIRED'));
    assert.ok(codes.includes('PRIVACY_RETENTION_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
