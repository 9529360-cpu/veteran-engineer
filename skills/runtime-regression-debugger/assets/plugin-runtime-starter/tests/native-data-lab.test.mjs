import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadDataset, profileDataset, queryDataset, runDataLab } from '../src/native-data-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-data-lab-')); }

test('Data Lab parses quoted CSV and profiles typed columns', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'users.csv'), 'id,name,active,note\n1,"Ada, A.",true,"hello\nworld"\n2,Bob,false,\n', 'utf8');
    const dataset = await loadDataset({ file: 'users.csv', rootDir: root });
    assert.equal(dataset.format, 'csv');
    assert.equal(dataset.rows.length, 2);
    assert.equal(dataset.rows[0].id, 1);
    assert.equal(dataset.rows[0].name, 'Ada, A.');
    assert.equal(dataset.rows[0].note, 'hello\nworld');
    const profile = profileDataset(dataset.rows);
    assert.equal(profile.rows, 2);
    assert.deepEqual(profile.columns.find((item) => item.name === 'id').types, ['integer']);
    assert.deepEqual(profile.columns.find((item) => item.name === 'active').types, ['boolean']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Data Lab filters, selects, sorts, and bounds local results', () => {
  const rows = [
    { id: 1, user: { country: 'IT' }, spend: 12 },
    { id: 2, user: { country: 'US' }, spend: 50 },
    { id: 3, user: { country: 'IT' }, spend: 30 }
  ];
  const result = queryDataset(rows, {
    where: [{ path: 'user.country', op: 'eq', value: 'IT' }],
    select: ['id', 'spend'],
    sort: [{ path: 'spend', direction: 'desc' }],
    limit: 1
  });
  assert.equal(result.filteredRows, 2);
  assert.equal(result.totalResultRows, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual({ ...result.rows[0] }, { id: 3, spend: 30 });
});

test('Data Lab aggregates groups with count sum and average', () => {
  const rows = [
    { country: 'IT', spend: 10 },
    { country: 'IT', spend: 30 },
    { country: 'US', spend: 5 }
  ];
  const result = queryDataset(rows, { sort: [{ path: 'revenue', direction: 'desc' }], limit: 10 }, {
    groupBy: ['country'],
    metrics: [
      { name: 'users', op: 'count' },
      { name: 'revenue', op: 'sum', path: 'spend' },
      { name: 'average', op: 'avg', path: 'spend' }
    ]
  });
  assert.deepEqual({ ...result.rows[0] }, { country: 'IT', users: 2, revenue: 40, average: 20 });
  assert.deepEqual({ ...result.rows[1] }, { country: 'US', users: 1, revenue: 5, average: 5 });
});

test('Data Lab loads NDJSON and runs a full spec', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'events.ndjson'), '{"kind":"deploy","ok":true}\n{"kind":"test","ok":false}\n', 'utf8');
    const report = await runDataLab({ file: 'events.ndjson', query: { where: [{ path: 'ok', op: 'eq', value: true }] } }, { rootDir: root });
    assert.equal(report.contract, 'veteran-native-data-lab-v1');
    assert.equal(report.profile.rows, 2);
    assert.equal(report.query.filteredRows, 1);
    assert.equal(report.query.rows[0].kind, 'deploy');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Data Lab rejects prototype paths and symlink escapes', async (t) => {
  assert.throws(() => queryDataset([{ safe: 1 }], { where: [{ path: '__proto__.polluted', op: 'exists' }] }), (error) => error.code === 'DATA_LAB_PATH_INVALID');
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(outside, 'secret.json'), '[{"secret":true}]', 'utf8');
    try { await fs.symlink(path.join(outside, 'secret.json'), path.join(root, 'escape.json')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await assert.rejects(() => loadDataset({ file: 'escape.json', rootDir: root }), (error) => error.code === 'DATA_LAB_ROOT_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('Data Lab rejects delimited rows wider than the header', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'bad.csv'), 'a,b\n1,2,3\n', 'utf8');
    await assert.rejects(() => loadDataset({ file: 'bad.csv', rootDir: root }), (error) => error.code === 'DATA_LAB_DELIMITED_INVALID');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Data Lab rejects unsafe aggregate and filter values', () => {
  assert.throws(() => queryDataset([{ value: 1 }], { where: [{ path: 'value', op: 'in', value: Array.from({ length: 1025 }, (_, i) => i) }] }), (error) => error.code === 'DATA_LAB_FILTER_INVALID');
  assert.throws(() => queryDataset([{ value: 1 }], {}, { metrics: [{ name: 'x', op: 'shell', path: 'value' }] }), (error) => error.code === 'DATA_LAB_METRIC_INVALID');
});
