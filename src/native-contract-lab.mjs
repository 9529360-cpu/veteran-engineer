#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const NATIVE_CONTRACT_LAB_CONTRACT = 'veteran-native-contract-lab-v1';

const MAX_SPEC_BYTES = 8 * 1024 * 1024;
const MAX_FINDINGS = 5_000;
const MAX_REF_DEPTH = 32;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const SEVERITY_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, critical: 4 });

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodePointerPart(value) {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerGet(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw codedError('Only local JSON Pointer refs are supported', 'CONTRACT_REF_UNSUPPORTED', { ref: typeof ref === 'string' ? ref.slice(0, 240) : null });
  let current = root;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = decodePointerPart(rawPart);
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) throw codedError('OpenAPI local ref cannot be resolved', 'CONTRACT_REF_INVALID', { ref });
    current = current[part];
  }
  return current;
}

function dereference(root, value, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.$ref !== 'string') return value;
  if (depth >= MAX_REF_DEPTH) throw codedError('OpenAPI ref depth exceeds supported bound', 'CONTRACT_REF_DEPTH');
  const ref = value.$ref;
  if (seen.has(ref)) throw codedError('OpenAPI ref cycle is not supported in this comparison position', 'CONTRACT_REF_CYCLE', { ref });
  const nextSeen = new Set(seen);
  nextSeen.add(ref);
  return dereference(root, pointerGet(root, ref), nextSeen, depth + 1);
}

function assertOpenApi(spec, label) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw codedError(`${label} must be a JSON object`, 'CONTRACT_SPEC_INVALID');
  if (typeof spec.openapi !== 'string' || !/^3(?:\.|$)/.test(spec.openapi)) throw codedError(`${label} must be an OpenAPI 3.x JSON document`, 'CONTRACT_SPEC_UNSUPPORTED');
  if (!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) throw codedError(`${label} paths must be an object`, 'CONTRACT_SPEC_INVALID');
  return spec;
}

function addFinding(findings, finding) {
  const normalized = {
    code: finding.code,
    severity: finding.severity || 'high',
    path: finding.path || null,
    method: finding.method ? String(finding.method).toUpperCase() : null,
    location: finding.location || null,
    detail: finding.detail || null
  };
  normalized.fingerprint = stableHash(JSON.stringify(normalized));
  findings.push(normalized);
  if (findings.length > MAX_FINDINGS) throw codedError('Contract findings exceed supported limit', 'CONTRACT_FINDING_LIMIT');
}

function parameterKey(parameter) {
  return `${String(parameter?.in || '')}\0${String(parameter?.name || '')}`;
}

function mergedParameters(spec, pathItem, operation) {
  const map = new Map();
  for (const raw of [...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation?.parameters) ? operation.parameters : [])]) {
    const parameter = dereference(spec, raw);
    if (!parameter || typeof parameter !== 'object') continue;
    const key = parameterKey(parameter);
    if (key !== '\0') map.set(key, parameter);
  }
  return map;
}

function schemaType(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return [...schema.type].sort().join('|');
  return null;
}

function schemaEnum(schema) {
  return Array.isArray(schema?.enum) ? schema.enum.map((value) => JSON.stringify(value)) : null;
}

function schemaObject(spec, schema) {
  return dereference(spec, schema);
}

function compareRequestSchema(findings, baselineSpec, candidateSpec, baselineSchemaRaw, candidateSchemaRaw, context, depth = 0) {
  if (depth > 12) return;
  const baselineSchema = schemaObject(baselineSpec, baselineSchemaRaw);
  const candidateSchema = schemaObject(candidateSpec, candidateSchemaRaw);
  if (!baselineSchema || !candidateSchema || typeof baselineSchema !== 'object' || typeof candidateSchema !== 'object') return;
  const beforeType = schemaType(baselineSchema);
  const afterType = schemaType(candidateSchema);
  if (beforeType && afterType && beforeType !== afterType) addFinding(findings, { ...context, code: 'request-schema-type-changed', detail: `${beforeType} -> ${afterType}` });

  const beforeEnum = schemaEnum(baselineSchema);
  const afterEnum = schemaEnum(candidateSchema);
  if (beforeEnum && afterEnum) {
    const afterSet = new Set(afterEnum);
    const removed = beforeEnum.filter((value) => !afterSet.has(value));
    if (removed.length) addFinding(findings, { ...context, code: 'request-enum-narrowed', detail: `${removed.length} previously accepted value(s) removed` });
  }

  const beforeRequired = new Set(Array.isArray(baselineSchema.required) ? baselineSchema.required.map(String) : []);
  const afterRequired = new Set(Array.isArray(candidateSchema.required) ? candidateSchema.required.map(String) : []);
  for (const property of afterRequired) {
    if (!beforeRequired.has(property)) addFinding(findings, { ...context, code: 'request-property-became-required', location: `${context.location || 'schema'}.${property}`, detail: `Property ${property} is newly required` });
  }

  const beforeProperties = baselineSchema.properties && typeof baselineSchema.properties === 'object' ? baselineSchema.properties : {};
  const afterProperties = candidateSchema.properties && typeof candidateSchema.properties === 'object' ? candidateSchema.properties : {};
  for (const property of Object.keys(beforeProperties)) {
    if (Object.hasOwn(afterProperties, property)) compareRequestSchema(findings, baselineSpec, candidateSpec, beforeProperties[property], afterProperties[property], { ...context, location: `${context.location || 'schema'}.${property}` }, depth + 1);
  }
}

function compareResponseSchema(findings, baselineSpec, candidateSpec, baselineSchemaRaw, candidateSchemaRaw, context, depth = 0) {
  if (depth > 12) return;
  const baselineSchema = schemaObject(baselineSpec, baselineSchemaRaw);
  const candidateSchema = schemaObject(candidateSpec, candidateSchemaRaw);
  if (!baselineSchema || !candidateSchema || typeof baselineSchema !== 'object' || typeof candidateSchema !== 'object') return;
  const beforeType = schemaType(baselineSchema);
  const afterType = schemaType(candidateSchema);
  if (beforeType && afterType && beforeType !== afterType) addFinding(findings, { ...context, code: 'response-schema-type-changed', detail: `${beforeType} -> ${afterType}` });

  const beforeRequired = new Set(Array.isArray(baselineSchema.required) ? baselineSchema.required.map(String) : []);
  const afterRequired = new Set(Array.isArray(candidateSchema.required) ? candidateSchema.required.map(String) : []);
  for (const property of beforeRequired) {
    if (!afterRequired.has(property)) addFinding(findings, { ...context, code: 'response-required-property-no-longer-guaranteed', location: `${context.location || 'schema'}.${property}`, detail: `Response property ${property} may now be omitted` });
  }

  const beforeProperties = baselineSchema.properties && typeof baselineSchema.properties === 'object' ? baselineSchema.properties : {};
  const afterProperties = candidateSchema.properties && typeof candidateSchema.properties === 'object' ? candidateSchema.properties : {};
  for (const property of Object.keys(beforeProperties)) {
    if (!Object.hasOwn(afterProperties, property)) {
      addFinding(findings, { ...context, code: 'response-property-removed', location: `${context.location || 'schema'}.${property}`, detail: `Response property ${property} was removed` });
      continue;
    }
    compareResponseSchema(findings, baselineSpec, candidateSpec, beforeProperties[property], afterProperties[property], { ...context, location: `${context.location || 'schema'}.${property}` }, depth + 1);
  }
}

function firstMediaSchema(content, mediaType) {
  const media = content?.[mediaType];
  return media && typeof media === 'object' ? media.schema : null;
}

function compareOperation(findings, baselineSpec, candidateSpec, pathName, method, baselinePathItem, candidatePathItem, baselineOperation, candidateOperation) {
  const context = { path: pathName, method };
  const beforeParameters = mergedParameters(baselineSpec, baselinePathItem, baselineOperation);
  const afterParameters = mergedParameters(candidateSpec, candidatePathItem, candidateOperation);
  for (const [key, candidateParameter] of afterParameters) {
    const baselineParameter = beforeParameters.get(key);
    const requiredNow = candidateParameter.required === true || candidateParameter.in === 'path';
    const requiredBefore = baselineParameter ? (baselineParameter.required === true || baselineParameter.in === 'path') : false;
    if (requiredNow && (!baselineParameter || !requiredBefore)) {
      addFinding(findings, { ...context, code: 'request-parameter-became-required', location: `${candidateParameter.in}:${candidateParameter.name}`, detail: baselineParameter ? 'Optional parameter became required' : 'New required parameter added' });
    }
    if (baselineParameter?.schema && candidateParameter.schema) compareRequestSchema(findings, baselineSpec, candidateSpec, baselineParameter.schema, candidateParameter.schema, { ...context, location: `parameter:${candidateParameter.in}:${candidateParameter.name}` });
  }

  const beforeRequestBody = baselineOperation.requestBody ? dereference(baselineSpec, baselineOperation.requestBody) : null;
  const afterRequestBody = candidateOperation.requestBody ? dereference(candidateSpec, candidateOperation.requestBody) : null;
  if (afterRequestBody?.required === true && beforeRequestBody?.required !== true) addFinding(findings, { ...context, code: 'request-body-became-required', location: 'requestBody', detail: 'Request body is newly required' });
  if (beforeRequestBody?.content && afterRequestBody?.content) {
    for (const mediaType of Object.keys(beforeRequestBody.content)) {
      if (!Object.hasOwn(afterRequestBody.content, mediaType)) {
        addFinding(findings, { ...context, code: 'request-content-type-removed', location: `requestBody:${mediaType}`, detail: `Previously accepted request content type ${mediaType} was removed` });
        continue;
      }
      const beforeSchema = firstMediaSchema(beforeRequestBody.content, mediaType);
      const afterSchema = firstMediaSchema(afterRequestBody.content, mediaType);
      if (beforeSchema && afterSchema) compareRequestSchema(findings, baselineSpec, candidateSpec, beforeSchema, afterSchema, { ...context, location: `requestBody:${mediaType}` });
    }
  }

  const beforeResponses = baselineOperation.responses && typeof baselineOperation.responses === 'object' ? baselineOperation.responses : {};
  const afterResponses = candidateOperation.responses && typeof candidateOperation.responses === 'object' ? candidateOperation.responses : {};
  for (const [status, baselineResponseRaw] of Object.entries(beforeResponses)) {
    if (!Object.hasOwn(afterResponses, status)) {
      addFinding(findings, { ...context, code: 'response-status-removed', location: `response:${status}`, detail: `Documented response ${status} was removed` });
      continue;
    }
    const baselineResponse = dereference(baselineSpec, baselineResponseRaw);
    const candidateResponse = dereference(candidateSpec, afterResponses[status]);
    const beforeContent = baselineResponse?.content && typeof baselineResponse.content === 'object' ? baselineResponse.content : {};
    const afterContent = candidateResponse?.content && typeof candidateResponse.content === 'object' ? candidateResponse.content : {};
    for (const mediaType of Object.keys(beforeContent)) {
      if (!Object.hasOwn(afterContent, mediaType)) {
        addFinding(findings, { ...context, code: 'response-content-type-removed', location: `response:${status}:${mediaType}`, detail: `Response content type ${mediaType} was removed` });
        continue;
      }
      const beforeSchema = firstMediaSchema(beforeContent, mediaType);
      const afterSchema = firstMediaSchema(afterContent, mediaType);
      if (beforeSchema && afterSchema) compareResponseSchema(findings, baselineSpec, candidateSpec, beforeSchema, afterSchema, { ...context, location: `response:${status}:${mediaType}` });
    }
  }

  const beforeSecurity = Array.isArray(baselineOperation.security) ? baselineOperation.security : (Array.isArray(baselineSpec.security) ? baselineSpec.security : []);
  const afterSecurity = Array.isArray(candidateOperation.security) ? candidateOperation.security : (Array.isArray(candidateSpec.security) ? candidateSpec.security : []);
  if (beforeSecurity.length === 0 && afterSecurity.length > 0) addFinding(findings, { ...context, code: 'security-requirement-added', location: 'security', detail: 'Operation now requires a documented security scheme' });
}

export function compareOpenApiContracts(baselineInput, candidateInput) {
  const baseline = assertOpenApi(baselineInput, 'Baseline');
  const candidate = assertOpenApi(candidateInput, 'Candidate');
  const findings = [];
  for (const [pathName, baselinePathRaw] of Object.entries(baseline.paths)) {
    if (!Object.hasOwn(candidate.paths, pathName)) {
      addFinding(findings, { code: 'path-removed', severity: 'high', path: pathName, detail: 'Documented path was removed' });
      continue;
    }
    const baselinePathItem = dereference(baseline, baselinePathRaw);
    const candidatePathItem = dereference(candidate, candidate.paths[pathName]);
    for (const method of HTTP_METHODS) {
      const baselineOperation = baselinePathItem?.[method];
      if (!baselineOperation || typeof baselineOperation !== 'object') continue;
      const candidateOperation = candidatePathItem?.[method];
      if (!candidateOperation || typeof candidateOperation !== 'object') {
        addFinding(findings, { code: 'operation-removed', severity: 'high', path: pathName, method, detail: 'Documented operation was removed' });
        continue;
      }
      compareOperation(findings, baseline, candidate, pathName, method, baselinePathItem, candidatePathItem, baselineOperation, candidateOperation);
    }
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || String(a.path).localeCompare(String(b.path)) || String(a.method).localeCompare(String(b.method)) || String(a.location).localeCompare(String(b.location)) || a.code.localeCompare(b.code));
  return {
    contract: NATIVE_CONTRACT_LAB_CONTRACT,
    format: 'openapi-3-json',
    baselineVersion: baseline.openapi,
    candidateVersion: candidate.openapi,
    findings,
    limitations: [
      'JSON input only; YAML is intentionally unsupported without a parser.',
      'Known breaking wire-contract changes are detected; this is not a complete proof of all OpenAPI semantics.',
      'Only local JSON Pointer refs are resolved; remote refs are intentionally unsupported.',
      'Combinators such as allOf/oneOf/anyOf are not deeply compared.'
    ]
  };
}

export function evaluateContractReport(report, failOn = 'high') {
  if (!report || report.contract !== NATIVE_CONTRACT_LAB_CONTRACT || !Array.isArray(report.findings)) throw codedError('Contract report is invalid', 'CONTRACT_REPORT_INVALID');
  const level = String(failOn).toLowerCase();
  if (!Object.hasOwn(SEVERITY_RANK, level)) throw codedError('Invalid contract failOn level', 'CONTRACT_FAIL_LEVEL_INVALID');
  const threshold = SEVERITY_RANK[level];
  const failing = threshold === 0 ? [] : report.findings.filter((item) => SEVERITY_RANK[item.severity] >= threshold);
  return { passed: failing.length === 0, failOn: level, failing: failing.length };
}

function normalizeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw codedError(`${label} must be a bounded relative path`, 'CONTRACT_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} escapes root`, 'CONTRACT_PATH_INVALID');
  return normalized;
}

async function readSpec(rootDir, relativePath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelative(relativePath, 'Spec path');
  if (path.extname(safe).toLowerCase() !== '.json') throw codedError('Contract Lab accepts OpenAPI JSON files only', 'CONTRACT_FORMAT_UNSUPPORTED');
  const target = await fs.realpath(path.resolve(root, safe));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw codedError('Spec path escapes root', 'CONTRACT_PATH_ESCAPE');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_SPEC_BYTES) throw codedError('OpenAPI spec is invalid or too large', 'CONTRACT_SPEC_INVALID');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch { throw codedError('OpenAPI JSON is invalid', 'CONTRACT_SPEC_INVALID'); }
  return assertOpenApi(parsed, 'OpenAPI spec');
}

async function writeReport(rootDir, relativePath, report) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelative(relativePath, 'Output path');
  const target = path.resolve(root, safe);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw codedError('Output path escapes root', 'CONTRACT_PATH_ESCAPE');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Output must be a regular file', 'CONTRACT_OUTPUT_INVALID');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const content = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(target, 0o600).catch(() => {});
  return { path: safe.split(path.sep).join('/'), bytes: Buffer.byteLength(content), sha256: stableHash(content) };
}

function usage() {
  return `Veteran Native Contract Lab\n\nUsage:\n  node src/native-contract-lab.mjs diff <baseline.json> <candidate.json> [--root .] [--fail-on high] [--out report.json]\n\nOpenAPI 3.x JSON only. Detects a conservative set of known breaking wire-contract changes; it does not claim exhaustive OpenAPI compatibility proof.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'diff') throw codedError(`Unknown Contract Lab command: ${command}`, 'CONTRACT_COMMAND_UNKNOWN');
  const baselinePath = argv[1];
  const candidatePath = argv[2];
  if (!baselinePath || !candidatePath || baselinePath.startsWith('-') || candidatePath.startsWith('-')) throw codedError('diff requires baseline and candidate JSON paths', 'CONTRACT_ARGUMENT_REQUIRED');
  let rootDir = process.cwd();
  let failOn = 'high';
  let out = null;
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') { rootDir = argv[++index]; if (!rootDir) throw codedError('--root requires a value', 'CONTRACT_ARGUMENT_REQUIRED'); }
    else if (arg === '--fail-on') { failOn = argv[++index]; if (!failOn) throw codedError('--fail-on requires a value', 'CONTRACT_ARGUMENT_REQUIRED'); }
    else if (arg === '--out') { out = argv[++index]; if (!out) throw codedError('--out requires a value', 'CONTRACT_ARGUMENT_REQUIRED'); }
    else throw codedError(`Unknown Contract Lab argument: ${arg}`, 'CONTRACT_ARGUMENT_UNKNOWN');
  }
  const baseline = await readSpec(rootDir, baselinePath);
  const candidate = await readSpec(rootDir, candidatePath);
  const report = compareOpenApiContracts(baseline, candidate);
  const evaluation = evaluateContractReport(report, failOn);
  const result = { ...report, evaluation };
  const artifact = out ? await writeReport(rootDir, out, result) : null;
  process.stdout.write(`${JSON.stringify({ ...result, artifact }, null, 2)}\n`);
  return evaluation.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'CONTRACT_LAB_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
