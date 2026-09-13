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
const gate = path.join(skillRoot, 'scripts', 'ai_product_gate.py');
const reference = path.join(skillRoot, 'references', 'ai-llm-product-engineering.md');

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
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats AI/LLM product engineering as first-class capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'AI/LLM Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'ai-product,llm,prompt-engineering,rag,tool-calling,agent-loop,model-eval,structured-output',
    '--max', '10',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/ai-llm-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/search-relevance-serving.md',
    'references/api-backend-patterns.md',
    'references/async-edge-job-patterns.md',
    'references/engineering-evidence-gates.md'
  ]) {
    assert.ok(paths.includes(expected), `expected route ${expected}`);
  }

  const aliases = runPython(router, [
    '--signals',
    'ai,ai-feature,genai,generative-ai,large-language-model,prompt,retrieval-augmented-generation,function-calling,agentic,llm-eval,json-output',
    '--max', '10',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'ai-product', 'ai-product', 'ai-product', 'ai-product', 'llm', 'prompt-engineering', 'rag', 'tool-calling', 'agent-loop', 'model-eval', 'structured-output'
  ]);
});

test('AI product gate requires deterministic authority, bounded tools, fallback and evaluation', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(gate), true, 'AI Product gate must exist when source Skill package is present');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-ai-product-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      feature: {
        user_outcome: 'Draft a repository change plan grounded in the authorized project state.',
        model_step: 'Generate a bounded implementation plan and optional read-only inspection calls.',
        visible_result: 'A validated plan with cited repository evidence and explicit unresolved risks.'
      },
      authority: {
        deterministic_owner: 'application mission state and repository runtime',
        authorization_boundary: 'server validates project, principal, object and tool action before execution',
        validation_before_effect: 'tool schema, scope and consequential-action policy are checked outside the model'
      },
      model: {
        provider: 'configured-provider',
        model_id: 'model-family-version',
        config_version: 'prompt-v3'
      },
      context: {
        sources: ['authorized repository snippets', 'current mission state'],
        trust_boundary: 'retrieved/user text is data and cannot override system/tool policy',
        privacy_policy: 'send only required project context and never credentials or unrelated tenant data'
      },
      output: {
        contract: 'schema-bound plan with steps, evidence ids, risks and stop conditions',
        semantic_validation: 'referenced files/ids must exist and consequential actions remain proposals only'
      },
      tools: [
        {
          id: 'repo-read',
          purpose: 'read authorized repository files',
          authorization: 'project-scoped read permission',
          side_effect: 'read-only',
          retry_policy: 'bounded retry for transient read failure',
          consequential: false
        },
        {
          id: 'merge-proposal',
          purpose: 'propose a merge action without executing it',
          authorization: 'mission-scoped operator permission',
          side_effect: 'creates proposal state only',
          retry_policy: 'stable idempotency identity',
          consequential: true,
          confirmation_boundary: 'operator approval remains required before merge'
        }
      ],
      limits: {
        timeout_ms: 45000,
        max_steps: 8,
        max_tool_calls: 12,
        cost_policy: 'use bounded context and configured model tier; stop before budget exhaustion'
      },
      failure_fallback: [
        {
          failure: 'model provider timeout or invalid structured output',
          fallback: 'return explicit unavailable/draft state without executing consequential actions',
          visible_state: 'user sees retryable failure and preserved mission state'
        }
      ],
      evaluation: {
        case_classes: ['normal project', 'missing evidence', 'tool denial', 'instruction conflict'],
        oracle: 'schema/invariant checks plus required evidence and forbidden-action assertions',
        release_threshold: 'all critical invariants pass and quality benchmark meets the maintained threshold',
        regression_policy: 'historical failures remain in the stable eval set'
      },
      rollout: {
        strategy: 'bounded cohort with exact model/prompt identity',
        rollback: 'restore previous known-good model/config identity',
        identity_binding: 'evidence records model_id plus config_version'
      },
      privacy: {
        data_minimization: 'only task-relevant repository context is sent',
        retention: 'follow project evidence retention without storing full sensitive prompts',
        trace_redaction: 'remove credentials, tokens and sensitive tool payloads'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.equal(validPayload.counts.tools, 2);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      feature: { user_outcome: '', model_step: '', visible_result: '' },
      authority: {},
      model: { provider: '', model_id: '', config_version: '' },
      context: { sources: [], trust_boundary: '', privacy_policy: '' },
      output: { contract: '', semantic_validation: '' },
      tools: [
        { id: 'danger', purpose: '', authorization: '', side_effect: '', retry_policy: '', consequential: true }
      ],
      limits: { timeout_ms: 0, max_steps: true, max_tool_calls: -1, cost_policy: '' },
      failure_fallback: [],
      evaluation: { case_classes: [], oracle: '', release_threshold: '', regression_policy: '' },
      rollout: { strategy: '', rollback: '', identity_binding: '' },
      privacy: { data_minimization: '', retention: '', trace_redaction: '' }
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'FEATURE_FIELD_REQUIRED',
      'AUTHORITY_FIELD_REQUIRED',
      'MODEL_FIELD_REQUIRED',
      'CONTEXT_SOURCES_REQUIRED',
      'OUTPUT_CONTRACT_REQUIRED',
      'TOOL_FIELD_REQUIRED',
      'CONSEQUENTIAL_TOOL_CONFIRMATION_REQUIRED',
      'LIMIT_INVALID',
      'COST_POLICY_REQUIRED',
      'FAILURE_FALLBACK_REQUIRED',
      'EVAL_CASES_REQUIRED',
      'EVALUATION_FIELD_REQUIRED',
      'ROLLOUT_FIELD_REQUIRED',
      'PRIVACY_FIELD_REQUIRED'
    ]) {
      assert.ok(codes.has(code), `expected blocker ${code}`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
