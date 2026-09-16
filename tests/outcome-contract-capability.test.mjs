import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const gate = path.join(skillRoot, 'scripts', 'outcome_contract_gate.py');
const reference = path.join(skillRoot, 'references', 'outcome-fulfillment-contract.md');
let skillCapabilityAvailable = true;
try { await fs.access(skillRoot); } catch { skillCapabilityAvailable = false; }

function manifest(deliveredIds) {
  const rows = [];
  if (deliveredIds.includes('layout')) rows.push({
    id: 'layout', status: 'done',
    evidence: ['desktop shell/layout owners changed'],
    validation: ['running desktop shows requested multi-pane workspace']
  });
  if (deliveredIds.includes('glass')) rows.push({
    id: 'glass', status: 'done',
    evidence: ['glass material system changed'],
    validation: ['running desktop shows consistent glass surfaces and states']
  });
  return {
    schema: 'veteran-outcome-contract-v1',
    request: {
      summary: 'Give Hermes Desktop a Codex-style workspace layout and OS-style liquid-glass theme',
      requirements: [
        {
          id: 'layout', statement: 'Use a Codex-style workspace layout',
          acceptance: 'Running desktop visibly uses the requested workspace structure',
          dimension: 'layout', validation_boundary: 'runtime'
        },
        {
          id: 'glass', statement: 'Use an OS-style liquid-glass visual system',
          acceptance: 'Running desktop visibly uses a consistent liquid-glass material system',
          dimension: 'visual_style', validation_boundary: 'runtime'
        }
      ]
    },
    delivery: { requirements: rows },
    execution: {
      repository_inspected: true,
      active_path_verified: true,
      final_change_reviewed: true,
      runtime_available: true,
      runtime_observed: true,
      runtime_observation: 'Observed requested desktop changes in the running app'
    },
    completion_claim: 'runtime-validated',
    limitations: 'none known'
  };
}

async function runGate(payload) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-outcome-contract-'));
  const input = path.join(dir, 'manifest.json');
  await fs.writeFile(input, JSON.stringify(payload), 'utf8');
  const result = spawnSync('python3', [gate, input, '--json'], { encoding: 'utf8' });
  await fs.rm(dir, { recursive: true, force: true });
  return { ...result, parsed: JSON.parse(result.stdout) };
}

test('outcome contract gate rejects cosmetic-only completion for a layout plus visual-style request', { skip: !skillCapabilityAvailable }, async () => {
  const result = await runGate(manifest(['glass']));
  assert.equal(result.status, 1);
  assert.equal(result.parsed.gate_passed, false);
  assert.deepEqual(result.parsed.missing_dimensions, ['layout']);
  assert.ok(result.parsed.blockers.some((item) => item.code === 'REQUESTED_REQUIREMENT_UNDELIVERED'));
});

test('outcome contract gate passes only after every required request clause has evidence', { skip: !skillCapabilityAvailable }, async () => {
  const result = await runGate(manifest(['layout', 'glass']));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.parsed.gate_passed, true);
  assert.deepEqual(result.parsed.missing_dimensions, []);
  assert.equal(result.parsed.delivered_requirements, 2);
});

test('outcome fulfillment reference encodes clause preservation and real runtime verification', { skip: !skillCapabilityAvailable }, async () => {
  const text = await fs.readFile(reference, 'utf8');
  assert.match(text, /Related work is not substitute work/);
  assert.match(text, /Codex-style workspace layout/);
  assert.match(text, /liquid-glass/);
  assert.match(text, /Do not treat the first plausible patch as the default stopping point/);
  assert.match(text, /scripts\/outcome_contract_gate\.py/);
});
