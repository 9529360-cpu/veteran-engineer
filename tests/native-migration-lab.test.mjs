import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  MIGRATION_SPEC_CONTRACT,
  auditMigrations,
  evaluateMigrationReport,
  normalizeMigrationSpec
} from '../src/native-migration-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-migration-')); }
async function write(root, relative, content) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); return file; }
function spec(extra = {}) { return { contract: MIGRATION_SPEC_CONTRACT, roots: ['migrations'], policy: {}, ...extra }; }

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(MODULE_ROOT, 'src', 'native-migration-lab.mjs');

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('clean explicit-transaction migration passes and returns only metadata', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_create_users.sql', 'BEGIN;\nCREATE TABLE users (id bigint primary key);\nCOMMIT;\n');
  const report = await auditMigrations(root, spec({ policy: { idMode: 'numeric-prefix', requireTransaction: true } }));
  assert.equal(report.migrations.length, 1);
  assert.equal(report.migrations[0].id, '001');
  assert.equal(report.findings.length, 0);
  assert.equal(evaluateMigrationReport(report, 'high').passed, true);
  assert.equal(JSON.stringify(report).includes('CREATE TABLE users'), false);
});

test('destructive SQL and mutations outside required transaction are classified', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_bad.sql', 'ALTER TABLE users DROP COLUMN email;\nDELETE FROM sessions;\nUPDATE users SET active = true;\n');
  const report = await auditMigrations(root, spec({ policy: { requireTransaction: true } }));
  const rules = report.findings.map((item) => item.rule);
  assert.ok(rules.includes('drop-column'));
  assert.ok(rules.includes('delete-without-where'));
  assert.ok(rules.includes('update-without-where'));
  assert.equal(rules.filter((rule) => rule === 'statement-outside-explicit-transaction').length, 3);
  assert.equal(evaluateMigrationReport(report, 'high').passed, false);
});

test('comments, quoted strings, identifiers, and dollar bodies do not trigger destructive rules', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_safe.sql', `-- DROP TABLE users;\n/* DELETE FROM users; */\nBEGIN;\nINSERT INTO notes(text) VALUES ('DROP TABLE users;');\nCREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE 'DROP SCHEMA x'; END $$ LANGUAGE plpgsql;\nCOMMIT;\n`);
  const report = await auditMigrations(root, spec());
  assert.equal(report.findings.some((item) => ['drop-table', 'drop-schema', 'delete-without-where'].includes(item.rule)), false);
});

test('duplicate and non-monotonic numeric migration ids are reported deterministically', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_a.sql', 'SELECT 1;');
  await write(root, 'migrations/001_b.sql', 'SELECT 2;');
  await write(root, 'migrations/000_c.sql', 'SELECT 3;');
  const report = await auditMigrations(root, spec({ policy: { idMode: 'numeric-prefix' } }));
  const rules = report.findings.map((item) => item.rule);
  assert.ok(rules.includes('duplicate-migration-id'));
  assert.ok(rules.includes('migration-id-order'));
});

test('CREATE INDEX CONCURRENTLY inside explicit transaction is rejected but not required outside', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_bad.sql', 'BEGIN; CREATE INDEX CONCURRENTLY users_email_idx ON users(email); COMMIT;');
  await write(root, 'migrations/002_good.sql', 'CREATE INDEX CONCURRENTLY users_name_idx ON users(name);');
  const report = await auditMigrations(root, spec({ policy: { requireTransaction: true } }));
  assert.equal(report.findings.filter((item) => item.rule === 'concurrent-index-inside-transaction').length, 1);
  assert.equal(report.findings.filter((item) => item.path.endsWith('002_good.sql') && item.rule === 'statement-outside-explicit-transaction').length, 0);
});

test('down-pair policy reports missing companion without exposing SQL', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_users.up.sql', 'CREATE TABLE users(id bigint);');
  await write(root, 'migrations/002_posts.up.sql', 'CREATE TABLE posts(id bigint);');
  await write(root, 'migrations/002_posts.down.sql', 'DROP TABLE posts;');
  const report = await auditMigrations(root, spec({ policy: { requireDownPair: true } }));
  const missing = report.findings.filter((item) => item.rule === 'down-migration-missing');
  assert.equal(missing.length, 1);
  assert.ok(missing[0].path.endsWith('001_users.up.sql'));
});

test('quoted identifiers and nested comments preserve conservative destructive detection', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_quoted.sql', '/* outer /* DROP TABLE fake; */ still comment */\nUPDATE "users" SET active = false;\nALTER TABLE "users" DROP COLUMN "legacy";');
  const report = await auditMigrations(root, spec());
  assert.ok(report.findings.some((item) => item.rule === 'update-without-where'));
  assert.ok(report.findings.some((item) => item.rule === 'drop-column'));
  assert.equal(report.findings.some((item) => item.rule === 'drop-table'), false);
});

test('migration ids are scoped to each configured root and overlapping roots are rejected', async () => {
  const root = await tempRoot();
  await write(root, 'service-a/migrations/001_init.sql', 'SELECT 1;');
  await write(root, 'service-b/migrations/001_init.sql', 'SELECT 1;');
  const report = await auditMigrations(root, { contract: MIGRATION_SPEC_CONTRACT, roots: ['service-a/migrations', 'service-b/migrations'], policy: { idMode: 'numeric-prefix' } });
  assert.equal(report.findings.some((item) => item.rule === 'duplicate-migration-id'), false);
  assert.throws(() => normalizeMigrationSpec({ contract: MIGRATION_SPEC_CONTRACT, roots: ['db', 'db/migrations'] }), (error) => error.code === 'MIGRATION_SPEC_INVALID');
});

test('missing migration roots fail with stable migration error code', async () => {
  const root = await tempRoot();
  await assert.rejects(() => auditMigrations(root, spec()), (error) => error.code === 'MIGRATION_ROOT_INVALID');
});

test('root symlink escape and output-parent symlink escape fail closed', async (t) => {
  if (process.platform === 'win32') t.skip('symlink permissions are environment dependent on Windows');
  const root = await tempRoot();
  const outside = await tempRoot();
  await write(outside, '001_outside.sql', 'DROP TABLE secrets;');
  await fs.symlink(outside, path.join(root, 'migrations'));
  await assert.rejects(() => auditMigrations(root, spec()), (error) => ['MIGRATION_ROOT_INVALID', 'MIGRATION_PATH_ESCAPE'].includes(error.code));

  await fs.rm(path.join(root, 'migrations'), { force: true });
  await fs.mkdir(path.join(root, 'migrations'));
  await write(root, 'migrations/001_ok.sql', 'SELECT 1;');
  await write(root, 'spec.json', JSON.stringify(spec()));
  await fs.symlink(outside, path.join(root, 'reports'));
  const result = await runCli(['audit', 'spec.json', '--root', root, '--out', 'reports/result.json'], path.resolve('.'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /MIGRATION_PATH_ESCAPE/);
  await assert.rejects(() => fs.stat(path.join(outside, 'result.json')), (error) => error.code === 'ENOENT');
});

test('CLI writes mode-0600 report and uses exit 2 for policy failure', async () => {
  const root = await tempRoot();
  await write(root, 'migrations/001_drop.sql', 'DROP TABLE users;');
  await write(root, 'spec.json', JSON.stringify(spec()));
  const result = await runCli(['audit', 'spec.json', '--root', root, '--fail-on', 'high', '--out', 'reports/result.json'], path.resolve('.'));
  assert.equal(result.code, 2, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.evaluation.passed, false);
  assert.equal(parsed.artifact.path, 'reports/result.json');
  const info = await fs.stat(path.join(root, 'reports/result.json'));
  if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
});

test('spec validation rejects unknown fields and traversal roots', () => {
  assert.throws(() => normalizeMigrationSpec({ contract: MIGRATION_SPEC_CONTRACT, roots: ['migrations'], unexpected: true }), (error) => error.code === 'MIGRATION_SPEC_INVALID');
  assert.throws(() => normalizeMigrationSpec({ contract: MIGRATION_SPEC_CONTRACT, roots: ['../outside'] }), (error) => error.code === 'MIGRATION_PATH_INVALID');
});
