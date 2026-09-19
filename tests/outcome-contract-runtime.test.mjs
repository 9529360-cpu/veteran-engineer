import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRequirementReview } from '../src/outcome-contract.mjs';

const criteria = [
  { id: 'mission-goal', statement: 'layout and glass', acceptance: 'both are present' },
  { id: 'task:T1', statement: 'implement layout', acceptance: 'layout is real' }
];

test('acceptance review passes only with one evidence-backed passed row per criterion', () => {
  const result = evaluateRequirementReview(criteria, [
    { id: 'mission-goal', status: 'passed', evidence: ['runtime shows layout and glass'] },
    { id: 'task:T1', status: 'passed', evidence: ['layout owner changed and rendered'] }
  ]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.findings, []);
});

test('acceptance review fails closed on missing, duplicate, unknown, invalid, failed, unproven, and evidence-free rows', () => {
  const cases = [
    [undefined, 'ACCEPTANCE_RESULTS_REQUIRED'],
    [[{ id: 'task:T1', status: 'passed', evidence: ['ok'] }], 'ACCEPTANCE_REQUIREMENT_UNREVIEWED'],
    [[
      { id: 'mission-goal', status: 'passed', evidence: ['one'] },
      { id: 'mission-goal', status: 'passed', evidence: ['two'] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] }
    ], 'ACCEPTANCE_RESULT_DUPLICATE'],
    [[
      { id: 'mission-goal', status: 'passed', evidence: ['ok'] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] },
      { id: 'ghost', status: 'passed', evidence: ['fake'] }
    ], 'ACCEPTANCE_RESULT_UNKNOWN'],
    [[
      { id: 'mission-goal', status: 'maybe', evidence: ['guess'] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] }
    ], 'ACCEPTANCE_RESULT_STATUS_INVALID'],
    [[
      { id: 'mission-goal', status: 'failed', evidence: ['layout missing'] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] }
    ], 'ACCEPTANCE_REQUIREMENT_NOT_PROVEN'],
    [[
      { id: 'mission-goal', status: 'unproven', evidence: ['not rendered'] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] }
    ], 'ACCEPTANCE_REQUIREMENT_NOT_PROVEN'],
    [[
      { id: 'mission-goal', status: 'passed', evidence: [] },
      { id: 'task:T1', status: 'passed', evidence: ['ok'] }
    ], 'ACCEPTANCE_EVIDENCE_REQUIRED']
  ];

  for (const [rows, code] of cases) {
    const result = evaluateRequirementReview(criteria, rows);
    assert.equal(result.passed, false, code);
    assert.ok(result.findings.some((item) => item.code === code), code);
  }
});
