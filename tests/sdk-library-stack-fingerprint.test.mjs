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

test('stack fingerprint recognizes explicit SDK and published-library package surfaces', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-sdk-library-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: '@example/sdk',
      version: '1.0.0',
      exports: { '.': './dist/index.js' },
      types: './dist/index.d.ts',
      publishConfig: { access: 'public' },
      devDependencies: { '@hey-api/openapi-ts': '0.80.0' }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'pyproject.toml'), [
      '[project]',
      'name = "example-python-sdk"',
      'version = "1.0.0"',
      'dependencies = ["openapi-python-client>=0.25"]',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'Cargo.toml'), [
      '[package]',
      'name = "example-rust-sdk"',
      'version = "0.1.0"',
      '',
      '[lib]',
      'name = "example_sdk"',
      'path = "src/lib.rs"',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'Example.Library.csproj'), [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <PropertyGroup>',
      '    <TargetFramework>net8.0</TargetFramework>',
      '    <PackageId>Example.Library</PackageId>',
      '    <IsPackable>true</IsPackable>',
      '  </PropertyGroup>',
      '</Project>',
      ''
    ].join('\n'));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.detected['sdk-library'], [
      'Hey API OpenAPI generator',
      'JavaScript/TypeScript package surface',
      'NuGet packable library',
      'OpenAPI Python client generator',
      'Rust library crate'
    ]);
    assert.ok(payload.suggested_references.includes('references/sdk-library-product-engineering.md'));
    assert.ok(payload.languages.includes('Python'));
    assert.ok(payload.languages.includes('Rust'));
    assert.ok(payload.languages.includes('.NET'));
    assert.ok(payload.package_managers.includes('Cargo'));
    assert.ok(payload.package_managers.includes('NuGet'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('private applications and binary-only packages do not imply a public SDK/library surface', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-non-library-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'private-web-app',
      private: true,
      exports: { '.': './src/app.js' },
      types: './src/app.d.ts',
      dependencies: { react: '19.0.0', vite: '7.0.0' }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'pyproject.toml'), [
      '[project]',
      'name = "ordinary-api"',
      'version = "1.0.0"',
      'dependencies = ["fastapi>=0.116", "uvicorn>=0.35"]',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'Cargo.toml'), [
      '[package]',
      'name = "binary-tool"',
      'version = "0.1.0"',
      ''
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'WebApp.csproj'), [
      '<Project Sdk="Microsoft.NET.Sdk.Web">',
      '  <PropertyGroup>',
      '    <TargetFramework>net8.0</TargetFramework>',
      '    <IsPackable>false</IsPackable>',
      '  </PropertyGroup>',
      '</Project>',
      ''
    ].join('\n'));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(Object.hasOwn(payload.detected, 'sdk-library'), false);
    assert.equal(payload.suggested_references.includes('references/sdk-library-product-engineering.md'), false);
    assert.ok(payload.suggested_references.includes('references/stack-react-nextjs.md'));
    assert.ok(payload.suggested_references.includes('references/stack-python-fastapi.md'));
    assert.ok(payload.detected.dotnet.includes('ASP.NET Core'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
