import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareOpenApiContracts, evaluateContractReport, main } from '../src/native-contract-lab.mjs';

function baseSpec() {
  return {
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0' },
    paths: {
      '/users/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          parameters: [{ name: 'verbose', in: 'query', required: false, schema: { type: 'boolean' } }],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } } } } },
            '404': { description: 'not found' }
          }
        }
      },
      '/users': {
        post: {
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, role: { type: 'string', enum: ['user', 'admin'] } } } } } },
          responses: { '201': { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } } }
        }
      }
    }
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test('detects removed paths and operations plus newly required parameters', () => {
  const before = baseSpec();
  const after = clone(before);
  delete after.paths['/users'];
  delete after.paths['/users/{id}'].get;
  after.paths['/health'] = { get: { parameters: [{ name: 'token', in: 'header', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } };
  const report = compareOpenApiContracts(before, after);
  assert.equal(report.findings.some((item) => item.code === 'path-removed' && item.path === '/users'), true);
  assert.equal(report.findings.some((item) => item.code === 'operation-removed' && item.path === '/users/{id}'), true);
  assert.equal(evaluateContractReport(report, 'high').passed, false);
});

test('detects request narrowing: required body/property and enum value removal', () => {
  const before = baseSpec();
  const after = clone(before);
  const schema = after.paths['/users'].post.requestBody.content['application/json'].schema;
  after.paths['/users'].post.requestBody.required = true;
  schema.required.push('role');
  schema.properties.role.enum = ['admin'];
  const report = compareOpenApiContracts(before, after);
  const codes = new Set(report.findings.map((item) => item.code));
  assert.equal(codes.has('request-body-became-required'), true);
  assert.equal(codes.has('request-property-became-required'), true);
  assert.equal(codes.has('request-enum-narrowed'), true);
});

test('detects response status/content/property guarantees removed', () => {
  const before = baseSpec();
  const after = clone(before);
  delete after.paths['/users/{id}'].get.responses['404'];
  const ok = after.paths['/users/{id}'].get.responses['200'];
  const schema = ok.content['application/json'].schema;
  schema.required = ['id'];
  delete schema.properties.name;
  const report = compareOpenApiContracts(before, after);
  const codes = new Set(report.findings.map((item) => item.code));
  assert.equal(codes.has('response-status-removed'), true);
  assert.equal(codes.has('response-required-property-no-longer-guaranteed'), true);
  assert.equal(codes.has('response-property-removed'), true);
});

test('resolves local component refs for parameters and schemas', () => {
  const before = baseSpec();
  before.components = { parameters: { Trace: { name: 'trace', in: 'header', required: false, schema: { type: 'string' } } }, schemas: { User: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, email: { type: 'string' } } } } };
  before.paths['/users/{id}'].get.parameters.push({ $ref: '#/components/parameters/Trace' });
  before.paths['/users/{id}'].get.responses['200'].content['application/json'].schema = { $ref: '#/components/schemas/User' };
  const after = clone(before);
  after.components.parameters.Trace.required = true;
  delete after.components.schemas.User.properties.email;
  const report = compareOpenApiContracts(before, after);
  assert.equal(report.findings.some((item) => item.code === 'request-parameter-became-required' && item.location === 'header:trace'), true);
  assert.equal(report.findings.some((item) => item.code === 'response-property-removed' && item.location.endsWith('.email')), true);
});

test('identical contracts pass with explicit limitations', () => {
  const before = baseSpec();
  const report = compareOpenApiContracts(before, clone(before));
  assert.deepEqual(report.findings, []);
  assert.equal(evaluateContractReport(report, 'high').passed, true);
  assert.ok(report.limitations.some((item) => item.includes('JSON input only')));
});

test('CLI rejects YAML and path escapes while allowing contained JSON report output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-contract-'));
  try {
    await fs.writeFile(path.join(root, 'before.json'), JSON.stringify(baseSpec()));
    await fs.writeFile(path.join(root, 'after.json'), JSON.stringify(baseSpec()));
    await fs.writeFile(path.join(root, 'before.yaml'), 'openapi: 3.1.0\n');
    await assert.rejects(() => main(['diff', 'before.yaml', 'after.json', '--root', root]), (error) => error.code === 'CONTRACT_FORMAT_UNSUPPORTED');
    await assert.rejects(() => main(['diff', '../before.json', 'after.json', '--root', root]), (error) => error.code === 'CONTRACT_PATH_INVALID');
    const code = await main(['diff', 'before.json', 'after.json', '--root', root, '--out', 'artifacts/report.json']);
    assert.equal(code, 0);
    const report = JSON.parse(await fs.readFile(path.join(root, 'artifacts/report.json'), 'utf8'));
    assert.equal(report.contract, 'veteran-native-contract-lab-v1');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
