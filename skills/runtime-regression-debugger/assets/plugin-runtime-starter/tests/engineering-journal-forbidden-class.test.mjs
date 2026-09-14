import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const journalScript = path.join(
  root,
  'skills',
  'runtime-regression-debugger',
  'scripts',
  'engineering_journal.py'
);

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [journalScript, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

async function readJournal(journalPath) {
  return JSON.parse(await fs.readFile(journalPath, 'utf8'));
}

test('engineering journal rejects a later attempt from an explicitly forbidden equivalence class', async (t) => {
  if (!(await exists(journalScript))) {
    t.skip('source Skill engineering journal is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-journal-forbid-'));
  const journalPath = path.join(dir, 'journal.json');
  try {
    const init = runPython([journalPath, 'init', '--contract', 'request -> owner -> durable effect']);
    assert.ok(init, 'python is required by the Skill journal regression');
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const first = runPython([
      journalPath,
      'attempt',
      '--name', 'increase-timeout',
      '--assumption', 'dependency will eventually succeed',
      '--outcome', 'failed',
      '--equivalence-class', 'dependency-will-eventually-succeed',
      '--forbid', 'dependency-will-eventually-succeed'
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const repeated = runPython([
      journalPath,
      'attempt',
      '--name', 'add-more-retries',
      '--assumption', 'dependency will eventually succeed',
      '--outcome', 'failed',
      '--equivalence-class', 'dependency-will-eventually-succeed'
    ]);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /equivalence class is forbidden by a prior failed attempt: dependency-will-eventually-succeed/);

    const afterRejected = await readJournal(journalPath);
    assert.equal(afterRejected.attempts.length, 1, 'rejected retry must not mutate the journal');

    const differentMechanism = runPython([
      journalPath,
      'attempt',
      '--name', 'reconcile-authoritative-operation',
      '--assumption', 'provider operation identity is authoritative',
      '--outcome', 'succeeded',
      '--equivalence-class', 'authority-reconciliation'
    ]);
    assert.equal(differentMechanism.status, 0, differentMechanism.stderr || differentMechanism.stdout);

    const summary = runPython([journalPath, 'summary']);
    assert.equal(summary.status, 0, summary.stderr || summary.stdout);
    assert.match(summary.stdout, /forbidden equivalent patch classes: dependency-will-eventually-succeed/);

    const finalJournal = await readJournal(journalPath);
    assert.equal(finalJournal.attempts.length, 2);
    assert.equal(finalJournal.attempts[1].equivalence_class, 'authority-reconciliation');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('engineering journal only allows failed attempts to create a forbidden equivalence class', async (t) => {
  if (!(await exists(journalScript))) {
    t.skip('source Skill engineering journal is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-journal-forbid-outcome-'));
  const journalPath = path.join(dir, 'journal.json');
  try {
    const init = runPython([journalPath, 'init', '--contract', 'probe -> evidence -> decision']);
    assert.ok(init, 'python is required by the Skill journal regression');
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const invalid = runPython([
      journalPath,
      'attempt',
      '--name', 'successful-probe',
      '--assumption', 'probe established a viable mechanism',
      '--outcome', 'succeeded',
      '--equivalence-class', 'viable-mechanism',
      '--forbid', 'viable-mechanism'
    ]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /--forbid is valid only for failed attempts/);

    const journal = await readJournal(journalPath);
    assert.deepEqual(journal.attempts, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('engineering journal can reopen only the latest active ban with explicit new evidence and can forbid it again', async (t) => {
  if (!(await exists(journalScript))) {
    t.skip('source Skill engineering journal is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-journal-reconsider-'));
  const journalPath = path.join(dir, 'journal.json');
  try {
    const init = runPython([journalPath, 'init', '--contract', 'timeout -> provider outcome -> safe next action']);
    assert.ok(init, 'python is required by the Skill journal regression');
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const ban = runPython([
      journalPath,
      'attempt',
      '--name', 'blind-retry',
      '--assumption', 'timeout means no remote commit',
      '--outcome', 'failed',
      '--equivalence-class', 'timeout-means-no-commit',
      '--forbid', 'timeout-means-no-commit'
    ]);
    assert.equal(ban.status, 0, ban.stderr || ban.stdout);

    const unknownReview = runPython([
      journalPath,
      'reconsider',
      '--equivalence-class', 'never-forbidden',
      '--basis', 'new mechanism',
      '--new-evidence', 'fresh integration observation'
    ]);
    assert.notEqual(unknownReview.status, 0);
    assert.match(unknownReview.stderr, /equivalence class is not currently forbidden: never-forbidden/);

    const emptyEvidence = runPython([
      journalPath,
      'reconsider',
      '--equivalence-class', 'timeout-means-no-commit',
      '--basis', 'provider now exposes authoritative operation status',
      '--new-evidence', ''
    ]);
    assert.notEqual(emptyEvidence.status, 0);
    assert.match(emptyEvidence.stderr, /--new-evidence must not be empty/);

    const reopen = runPython([
      journalPath,
      'reconsider',
      '--equivalence-class', 'timeout-means-no-commit',
      '--basis', 'provider now exposes authoritative operation status',
      '--new-evidence', 'fresh integration probe resolves the operation id after timeout'
    ]);
    assert.equal(reopen.status, 0, reopen.stderr || reopen.stdout);

    const allowedAgain = runPython([
      journalPath,
      'attempt',
      '--name', 'status-aware-retry',
      '--assumption', 'authoritative operation status distinguishes committed from absent',
      '--outcome', 'succeeded',
      '--equivalence-class', 'timeout-means-no-commit'
    ]);
    assert.equal(allowedAgain.status, 0, allowedAgain.stderr || allowedAgain.stdout);

    const reban = runPython([
      journalPath,
      'attempt',
      '--name', 'provider-regression',
      '--assumption', 'operation status is always authoritative',
      '--outcome', 'failed',
      '--equivalence-class', 'timeout-means-no-commit',
      '--forbid', 'timeout-means-no-commit'
    ]);
    assert.equal(reban.status, 0, reban.stderr || reban.stdout);

    const blockedAgain = runPython([
      journalPath,
      'attempt',
      '--name', 'repeat-after-reban',
      '--assumption', 'operation status is always authoritative',
      '--outcome', 'failed',
      '--equivalence-class', 'timeout-means-no-commit'
    ]);
    assert.notEqual(blockedAgain.status, 0);
    assert.match(blockedAgain.stderr, /equivalence class is forbidden by a prior failed attempt: timeout-means-no-commit/);

    const journal = await readJournal(journalPath);
    assert.equal(journal.equivalence_class_reviews.length, 1);
    assert.equal(journal.equivalence_class_reviews[0].action, 'reopen');
    assert.equal(journal.equivalence_class_reviews[0].forbidden_attempt_index, 0);
    assert.equal(journal.attempts.length, 3, 'rejected attempts and invalid reviews must not mutate attempt history');

    const summary = runPython([journalPath, 'summary']);
    assert.equal(summary.status, 0, summary.stderr || summary.stdout);
    assert.match(summary.stdout, /equivalence class reviews: 1/);
    assert.match(summary.stdout, /forbidden equivalent patch classes: timeout-means-no-commit/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
