import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fingerprint = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'stack_fingerprint.py');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runFingerprint(repo) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [fingerprint, repo, '--json'], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('stack fingerprint recognizes CLI and TUI frameworks across JS, Python, Go, and Rust', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-cli-fingerprint-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'cli-fixture',
      dependencies: {
        commander: '14.0.0',
        ink: '6.0.0'
      }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'pyproject.toml'), [
      '[project]',
      'name = "cli-fixture-python"',
      'version = "1.0.0"',
      'dependencies = ["typer>=0.12", "textual>=1.0"]',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'go.mod'), [
      'module example.com/cli-fixture',
      '',
      'go 1.23',
      '',
      'require (',
      '  github.com/spf13/cobra v1.9.0',
      '  github.com/charmbracelet/bubbletea v1.3.0',
      ')',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'Cargo.toml'), [
      '[package]',
      'name = "cli-fixture-rust"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'clap = "4.5"',
      'ratatui = "0.29"',
      ''
    ].join('\n'));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.detected.cli, [
      'Bubble Tea',
      'Clap',
      'Cobra',
      'Commander',
      'Ink',
      'Ratatui',
      'Textual',
      'Typer'
    ]);
    assert.ok(payload.suggested_references.includes('references/cli-tui-product-engineering.md'));
    assert.ok(payload.languages.includes('Python'));
    assert.ok(payload.languages.includes('Go'));
    assert.ok(payload.languages.includes('Rust'));
    assert.ok(payload.package_managers.includes('Go modules'));
    assert.ok(payload.package_managers.includes('Cargo'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('ordinary web and API dependencies do not imply a CLI product surface', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-non-cli-fingerprint-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'ordinary-web-app',
      dependencies: { react: '19.0.0', vite: '7.0.0' }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'pyproject.toml'), [
      '[project]',
      'name = "ordinary-api"',
      'version = "1.0.0"',
      'dependencies = ["fastapi>=0.116", "uvicorn>=0.35"]',
      ''
    ].join('\n'));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(Object.hasOwn(payload.detected, 'cli'), false);
    assert.equal(payload.suggested_references.includes('references/cli-tui-product-engineering.md'), false);
    assert.ok(payload.suggested_references.includes('references/stack-react-nextjs.md'));
    assert.ok(payload.suggested_references.includes('references/stack-python-fastapi.md'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
