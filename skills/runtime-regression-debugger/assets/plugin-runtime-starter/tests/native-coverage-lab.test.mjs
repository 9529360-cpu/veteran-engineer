import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  COVERAGE_REPORT_CONTRACT,
  COVERAGE_SPEC_CONTRACT,
  normalizeCoverageSpec,
  runCoverageCheck
} from '../src/native-coverage-lab.mjs';

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-coverage-'));
  await fs.mkdir(path.join(root, 'coverage'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'alpha.js'), 'export const alpha = 1;\n');
  await fs.writeFile(path.join(root, 'src', 'beta.js'), 'export const beta = 2;\n');
  return root;
}

function spec(reports, thresholds = {}, perFileThresholds = {}) {
  return { contract: COVERAGE_SPEC_CONTRACT, reports, thresholds, perFileThresholds };
}

test('coverage spec is closed, bounded, and does not expose an arbitrary evaluator', () => {
  const normalized = normalizeCoverageSpec(spec([{ path: 'coverage/lcov.info', format: 'lcov' }], { lines: 80 }));
  assert.equal(normalized.reports[0].format, 'lcov');
  assert.equal(normalized.thresholds.lines, 80);
  assert.throws(
    () => normalizeCoverageSpec({ ...spec([{ path: 'coverage/lcov.info', format: 'lcov' }]), command: 'curl example.com' }),
    (error) => error.code === 'COVERAGE_SPEC_INVALID'
  );
  assert.throws(
    () => normalizeCoverageSpec(spec([{ path: 'coverage/lcov.info', format: 'javascript-eval' }])),
    (error) => error.code === 'COVERAGE_SPEC_INVALID'
  );
  assert.throws(
    () => normalizeCoverageSpec(spec([{ path: 'coverage/lcov.info', format: 'lcov' }], {}, { minFiles: 2 })),
    (error) => error.code === 'COVERAGE_SPEC_INVALID'
  );
});

test('LCOV coverage is checked locally with deterministic aggregate and per-file thresholds', async () => {
  const root = await workspace();
  await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), [
    'TN:',
    'SF:src/alpha.js',
    'FN:1,alpha',
    'FNDA:1,alpha',
    'DA:1,1',
    'DA:2,0',
    'BRDA:1,0,0,1',
    'BRDA:1,0,1,-',
    'end_of_record',
    'SF:src/beta.js',
    'FN:1,beta',
    'FNDA:0,beta',
    'DA:1,1',
    'DA:2,1',
    'end_of_record',
    ''
  ].join('\n'));

  const result = await runCoverageCheck({
    root,
    spec: spec(
      [{ path: 'coverage/lcov.info', format: 'lcov' }],
      { lines: 75, functions: 50, branches: 50, maxUncoveredLines: 1, minFiles: 2 },
      { lines: 50 }
    )
  });

  assert.equal(result.contract, COVERAGE_REPORT_CONTRACT);
  assert.equal(result.passed, true);
  assert.deepEqual(result.metrics.lines, { total: 4, covered: 3, uncovered: 1, pct: 75 });
  assert.deepEqual(result.metrics.functions, { total: 2, covered: 1, uncovered: 1, pct: 50 });
  assert.deepEqual(result.metrics.branches, { total: 2, covered: 1, uncovered: 1, pct: 50 });
  assert.equal(result.metrics.statements, null);
  assert.equal(result.fileCount, 2);
  assert.match(result.coverageIdentity, /^[a-f0-9]{64}$/);
});


test('multiple LCOV shards union the same source instead of double-counting it', async () => {
  const root = await workspace();
  await fs.writeFile(path.join(root, 'coverage', 'shard-a.info'), 'SF:src/alpha.js\nDA:1,1\nDA:2,0\nend_of_record\n');
  await fs.writeFile(path.join(root, 'coverage', 'shard-b.info'), 'SF:src/alpha.js\nDA:1,0\nDA:2,1\nend_of_record\n');
  const result = await runCoverageCheck({
    root,
    spec: spec([
      { path: 'coverage/shard-a.info', format: 'lcov' },
      { path: 'coverage/shard-b.info', format: 'lcov' }
    ], { lines: 100 })
  });
  assert.equal(result.fileCount, 1);
  assert.deepEqual(result.metrics.lines, { total: 2, covered: 2, uncovered: 0, pct: 100 });
  assert.equal(result.passed, true);
});

test('Istanbul summary supports statement coverage and per-file gating without trusting pct fields', async () => {
  const root = await workspace();
  const summary = {
    total: {
      lines: { total: 999, covered: 999, skipped: 0, pct: 100 },
      statements: { total: 999, covered: 999, skipped: 0, pct: 100 },
      functions: { total: 999, covered: 999, skipped: 0, pct: 100 },
      branches: { total: 999, covered: 999, skipped: 0, pct: 100 }
    },
    'src/alpha.js': {
      lines: { total: 10, covered: 8, skipped: 0, pct: 1 },
      statements: { total: 12, covered: 9, skipped: 0, pct: 1 },
      functions: { total: 4, covered: 3, skipped: 0, pct: 1 },
      branches: { total: 6, covered: 3, skipped: 0, pct: 1 }
    }
  };
  await fs.writeFile(path.join(root, 'coverage', 'coverage-summary.json'), JSON.stringify(summary));
  const result = await runCoverageCheck({
    root,
    spec: spec(
      [{ path: 'coverage/coverage-summary.json', format: 'istanbul-summary' }],
      { lines: 80, statements: 75, functions: 75, branches: 50 },
      { lines: 80 }
    )
  });
  assert.equal(result.passed, true);
  assert.equal(result.metrics.lines.pct, 80);
  assert.equal(result.metrics.statements.pct, 75);
  assert.equal(result.metrics.functions.pct, 75);
  assert.equal(result.metrics.branches.pct, 50);
});

test('unavailable metrics fail closed when a threshold asks for them', async () => {
  const root = await workspace();
  await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), 'SF:src/alpha.js\nDA:1,1\nend_of_record\n');
  const result = await runCoverageCheck({
    root,
    spec: spec([{ path: 'coverage/lcov.info', format: 'lcov' }], { statements: 1 })
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks[0], {
    scope: 'global', metric: 'statements', passed: false, reason: 'metric-unavailable', required: 1, actual: null
  });
});

test('coverage report paths and source identities cannot escape the project root', async () => {
  const root = await workspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-coverage-outside-'));
  await fs.writeFile(path.join(outside, 'outside.info'), 'SF:src/outside.js\nDA:1,1\nend_of_record\n');
  await fs.symlink(path.join(outside, 'outside.info'), path.join(root, 'coverage', 'escape.info'));
  await assert.rejects(
    () => runCoverageCheck({ root, spec: spec([{ path: 'coverage/escape.info', format: 'lcov' }]) }),
    (error) => ['COVERAGE_INPUT_INVALID', 'COVERAGE_PATH_ESCAPE'].includes(error.code)
  );

  await fs.writeFile(path.join(root, 'coverage', 'bad-source.info'), `SF:${path.join(outside, 'secret.js')}\nDA:1,1\nend_of_record\n`);
  await assert.rejects(
    () => runCoverageCheck({ root, spec: spec([{ path: 'coverage/bad-source.info', format: 'lcov' }]) }),
    (error) => error.code === 'COVERAGE_SOURCE_PATH_ESCAPE'
  );
});

test('report artifact is root-contained, mode-restricted, and contains only normalized coverage evidence', async () => {
  const root = await workspace();
  await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), 'SF:src/alpha.js\nDA:1,1\nend_of_record\n');
  const result = await runCoverageCheck({
    root,
    spec: spec([{ path: 'coverage/lcov.info', format: 'lcov' }], { lines: 100 }),
    reportPath: 'artifacts/coverage.json'
  });
  assert.equal(result.passed, true);
  assert.equal(result.artifact.path, 'artifacts/coverage.json');
  assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/);
  const stat = await fs.stat(path.join(root, 'artifacts', 'coverage.json'));
  if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
  const body = await fs.readFile(path.join(root, 'artifacts', 'coverage.json'), 'utf8');
  assert.ok(!body.includes('export const alpha'));
  assert.ok(body.includes('src/alpha.js'));
});


test('output creation rejects an intermediate symlink before writing outside the project root', async () => {
  if (process.platform === 'win32') return;
  const root = await workspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-coverage-output-outside-'));
  await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), 'SF:src/alpha.js\nDA:1,1\nend_of_record\n');
  await fs.symlink(outside, path.join(root, 'artifacts'));
  await assert.rejects(
    () => runCoverageCheck({
      root,
      spec: spec([{ path: 'coverage/lcov.info', format: 'lcov' }]),
      reportPath: 'artifacts/nested/coverage.json'
    }),
    (error) => error.code === 'COVERAGE_PATH_ESCAPE'
  );
  await assert.rejects(() => fs.access(path.join(outside, 'nested', 'coverage.json')));
});

test('CLI returns exit code 2 on threshold failure and prints bounded JSON', async () => {
  const root = await workspace();
  await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), 'SF:src/alpha.js\nDA:1,0\nend_of_record\n');
  await fs.writeFile(path.join(root, 'coverage', 'spec.json'), JSON.stringify(spec([{ path: 'coverage/lcov.info', format: 'lcov' }], { lines: 100 })));
  const source = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/native-coverage-lab.mjs');
  const child = spawnSync(process.execPath, [source, 'check', 'coverage/spec.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 2);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].metric, 'lines');
  assert.equal(result.checks[0].actual, 0);
});
