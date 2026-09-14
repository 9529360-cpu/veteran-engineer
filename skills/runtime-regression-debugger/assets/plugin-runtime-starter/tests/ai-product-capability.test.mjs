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

test('AI/LLM routing retains deterministic-authority and tool-boundary guidance', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const routed = runPython(router, [
    '--signals',
    'ai-product,llm,prompt-engineering,rag,tool-calling,agent-loop,model-eval,structured-output',
    '--max', '10',
    '--json'
  ]);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/ai-llm-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/search-relevance-serving.md',
    'references/api-backend-patterns.md',
    'references/async-edge-job-patterns.md',
    'references/engineering-evidence-gates.md'
  ]) assert.ok(paths.includes(expected), `expected route ${expected}`);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Keep deterministic authority outside the model/);
  assert.match(specialist, /Vector similarity is neither authorization nor truth/);
  assert.match(specialist, /Tool calls are proposed actions/);
  assert.match(specialist, /Bound loops by positive time, step, and tool-call budgets/);
  assert.match(specialist, /model timeout never justifies blind replay/);
  assert.match(specialist, /Do not silently promote model inference to user truth/);
  assert.match(specialist, /Offline eval is not production outcome/);
});

test('AI product gate checks executable identity, tool confirmation, and bounded execution only', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-ai-product-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      model: { provider: 'configured-provider', model_id: 'model-v1', config_version: 'prompt-v3' },
      tools: [
        { id: 'repo-read', consequential: false },
        { id: 'merge-proposal', consequential: true, confirmation_boundary: 'operator approval' }
      ],
      limits: { timeout_ms: 45000, max_steps: 8, max_tool_calls: 12 }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.deepEqual(validPayload.counts, { consequential_tools: 1, tools: 2 });

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      model: { provider: '', model_id: 'model-v1', config_version: '' },
      tools: [
        { id: 'dup', consequential: true },
        { id: 'dup', consequential: 'yes' }
      ],
      limits: { timeout_ms: 0, max_steps: true, max_tool_calls: -1 },
      privacy: { prose: 'this field intentionally does not affect the structural gate' }
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const codes = new Set(JSON.parse(invalid.stdout).blockers.map((item) => item.code));
    for (const code of [
      'MODEL_IDENTITY_REQUIRED',
      'TOOL_ID_DUPLICATE',
      'CONSEQUENTIAL_TOOL_CONFIRMATION_REQUIRED',
      'TOOL_CONSEQUENTIAL_INVALID',
      'LIMIT_INVALID'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
