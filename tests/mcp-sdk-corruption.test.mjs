import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertMcpSdkIntegrity, inspectMcpSdkIntegrity, PINNED_MCP_PACKAGES } from '../src/mcp-sdk-integrity.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function writePackageMetadata(root, name, content) {
  const file = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test('MCP SDK integrity distinguishes absent packages from corrupt detected package metadata', async () => {
  const root = await tempDir('veteran-mcp-sdk-corrupt-');
  try {
    const absent = await inspectMcpSdkIntegrity(root);
    assert.equal(absent.status, 'unavailable');
    assert.equal(absent.graph.status, 'unavailable');

    const [firstPackage] = Object.keys(PINNED_MCP_PACKAGES);
    await writePackageMetadata(root, firstPackage, '{not-json');

    const corrupt = await inspectMcpSdkIntegrity(root);
    assert.equal(corrupt.status, 'invalid', 'detected corrupt SDK metadata must never degrade to optional unavailable');
    assert.equal(corrupt.graph.status, 'invalid');
    assert.equal(corrupt.graph.packages[firstPackage].detected, true);
    assert.equal(corrupt.graph.packages[firstPackage].present, false);
    assert.equal(corrupt.graph.packages[firstPackage].readError, 'PACKAGE_JSON_INVALID');
    assert.ok(corrupt.graph.errors.some((item) => item.includes(`${firstPackage} package metadata is unreadable or invalid`)));
    assert.throws(() => assertMcpSdkIntegrity(corrupt), (error) => error.code === 'MCP_SDK_INTEGRITY');
  } finally {
    await cleanup(root);
  }
});

test('MCP SDK integrity rejects detected package metadata that omits its version', async () => {
  const root = await tempDir('veteran-mcp-sdk-versionless-');
  try {
    const [firstPackage] = Object.keys(PINNED_MCP_PACKAGES);
    await writePackageMetadata(root, firstPackage, '{}\n');
    const report = await inspectMcpSdkIntegrity(root);
    assert.equal(report.status, 'invalid');
    assert.equal(report.graph.status, 'invalid');
    assert.equal(report.graph.packages[firstPackage].detected, true);
    assert.equal(report.graph.packages[firstPackage].readError, null);
    assert.ok(report.graph.errors.includes(`${firstPackage} package metadata is missing a version`));
  } finally {
    await cleanup(root);
  }
});
