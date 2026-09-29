import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildKnowledgeIndex, readKnowledgeIndex, searchKnowledgeIndex, tokenizeKnowledge, writeKnowledgeIndex } from '../src/native-knowledge-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-knowledge-lab-')); }

test('Knowledge Lab indexes markdown into line-addressable chunks and ignores build/vendor directories', async () => {
  const root = await tempRoot();
  try {
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'hidden'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'runbook.md'), '# Payments Runbook\n\n## Recovery\n\nRetry idempotently.\n\nVerify ledger balance.\n', 'utf8');
    await fs.writeFile(path.join(root, 'node_modules', 'hidden', 'noise.md'), '# Noise\n\nDo not index me.\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    assert.equal(index.source.files, 1);
    assert.equal(index.chunks.length, 2);
    assert.equal(index.chunks[0].path, 'docs/runbook.md');
    assert.equal(index.chunks[0].heading, 'Recovery');
    assert.equal(index.chunks[0].startLine, 5);
    assert.equal(index.chunks[0].endLine, 5);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Knowledge Lab ranks relevant English chunks and returns source line citations', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'deploy.md'), '# Deployments\n\nBlue green deploys reduce rollback risk.\n', 'utf8');
    await fs.writeFile(path.join(root, 'billing.md'), '# Billing\n\nInvoices and refunds use the ledger.\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    const result = searchKnowledgeIndex(index, 'rollback deployment risk', { limit: 2 });
    assert.equal(result.results[0].path, 'deploy.md');
    assert.match(result.results[0].citation, /^deploy\.md:L\d+-L\d+$/);
    assert.match(result.results[0].excerpt, /rollback risk/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Knowledge Lab tokenizes Han text with character and bigram terms for Chinese search', async () => {
  const tokens = tokenizeKnowledge('支付失败处理流程');
  assert.ok(tokens.includes('支付'));
  assert.ok(tokens.includes('失败'));
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'payments.md'), '# 支付故障\n\n支付失败时先检查订单状态，再核对账本。\n', 'utf8');
    await fs.writeFile(path.join(root, 'cache.md'), '# 缓存\n\n缓存失效需要重新预热。\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    const result = searchKnowledgeIndex(index, '支付失败', { limit: 2 });
    assert.equal(result.results[0].path, 'payments.md');
    assert.ok(result.results[0].matchedTerms >= 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Knowledge Lab skips symlinks instead of following knowledge roots outside the corpus', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(outside, 'secret.md'), '# Secret\n\noutside material\n', 'utf8');
    try { await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'linked.md')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await fs.writeFile(path.join(root, 'inside.md'), '# Inside\n\ntrusted local note\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    assert.equal(index.source.files, 1);
    assert.equal(index.chunks.some((chunk) => chunk.path === 'linked.md'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('Knowledge Lab persists an open JSON index and searches the reloaded artifact', async () => {
  const root = await tempRoot();
  try {
    await fs.mkdir(path.join(root, 'artifacts'));
    await fs.writeFile(path.join(root, 'notes.txt'), 'incident recovery checklist\nconfirm rollback completed\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    const artifact = await writeKnowledgeIndex(index, 'artifacts/knowledge.json', { rootDir: root });
    assert.equal(artifact.path, 'artifacts/knowledge.json');
    assert.equal(artifact.sha256.length, 64);
    const reloaded = await readKnowledgeIndex('artifacts/knowledge.json', { rootDir: root });
    assert.equal(reloaded.contentIdentity, index.contentIdentity);
    assert.equal(searchKnowledgeIndex(reloaded, 'rollback').results[0].path, 'notes.txt');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Knowledge Lab output containment rejects parent and symlink escapes', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'note.md'), '# Note\n\nhello\n', 'utf8');
    const index = await buildKnowledgeIndex({ rootDir: root });
    await assert.rejects(() => writeKnowledgeIndex(index, '../escape.json', { rootDir: root }), (error) => error.code === 'KNOWLEDGE_LAB_ROOT_ESCAPE');
    try { await fs.symlink(outside, path.join(root, 'link')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await assert.rejects(() => writeKnowledgeIndex(index, 'link/index.json', { rootDir: root }), (error) => error.code === 'KNOWLEDGE_LAB_ROOT_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
