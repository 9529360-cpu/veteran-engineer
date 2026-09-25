import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const exporter = path.join(skillRoot, 'scripts', 'export_plugin_bundle.py');
const workspaceRevision = '0123456789abcdef0123456789abcdef01234567';

function pythonAvailable() {
  return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
}

function runPython(args, cwd = root) {
  const result = spawnSync('python3', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `python3 failed: ${args.join(' ')}`);
  return result.stdout;
}

function zipReport(file) {
  const program = [
    'import json,sys,zipfile',
    'z=zipfile.ZipFile(sys.argv[1])',
    'names=set(z.namelist())',
    "m=json.loads(z.read('veteran-engineer/.codex-plugin/plugin.json'))",
    "d=json.loads(z.read('veteran-engineer/veteran-distribution.json'))",
    "print(json.dumps({'names':sorted(names),'manifest':m,'distribution':d}))"
  ].join(';');
  return JSON.parse(runPython(['-c', program, file]));
}

function zipText(file, member) {
  const program = "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode(),end='')";
  return runPython(['-c', program, file, member]);
}

test('distribution exporter keeps local MCP artifacts out of the web profile', async (t) => {
  if (!pythonAvailable()) return t.skip('python3 unavailable; exporter is validated by Skill packaging instead');
  const temp = await tempDir('veteran-export-profiles-');
  try {
    const desktop = path.join(temp, 'desktop.zip');
    const web = path.join(temp, 'web.zip');
    runPython([exporter, skillRoot, '--profile', 'desktop', '--output', desktop]);
    runPython([exporter, skillRoot, '--profile', 'web', '--output', web]);
    const desktopReport = zipReport(desktop);
    const webReport = zipReport(web);
    assert.equal(desktopReport.manifest.mcpServers, './.mcp.json');
    assert.ok(desktopReport.names.includes('veteran-engineer/.mcp.json'));
    assert.ok(desktopReport.names.includes('veteran-engineer/mcp/server.mjs'));
    assert.equal(desktopReport.distribution.surfaceProfile, 'local-stdio');
    assert.equal(webReport.manifest.mcpServers, undefined);
    assert.equal(webReport.names.includes('veteran-engineer/.mcp.json'), false);
    assert.equal(webReport.names.includes('veteran-engineer/mcp/server.mjs'), false);
    assert.equal(webReport.names.some((name) => name.startsWith('veteran-engineer/src/')), false);
    assert.ok(webReport.names.includes('veteran-engineer/skills/runtime-regression-debugger/SKILL.md'));
    assert.equal(webReport.distribution.platformNotes.webCompatible, true);
  } finally {
    await cleanup(temp);
  }
});

test('desktop export carries the outcome-closure and visible-validation Skill kernel', async (t) => {
  if (!pythonAvailable()) return t.skip('python3 unavailable; exporter is validated by Skill packaging instead');
  const temp = await tempDir('veteran-export-skill-kernel-');
  try {
    const desktop = path.join(temp, 'desktop.zip');
    runPython([exporter, skillRoot, '--profile', 'desktop', '--output', desktop]);
    const skill = zipText(desktop, 'veteran-engineer/skills/runtime-regression-debugger/SKILL.md');
    assert.match(skill, /Authorized implementation is an outcome contract/);
    assert.match(skill, /outcome-fulfillment-contract\.md/);
    assert.match(skill, /user clause -> observable postcondition -> active owner -> validation evidence/);
    assert.match(skill, /finish at the visible boundary/);
    assert.match(skill, /UI\/interaction claims require live rendered\/task evidence/);
  } finally {
    await cleanup(temp);
  }
});

test('web exporter references only a caller-supplied app manifest instead of inventing app configuration', async (t) => {
  if (!pythonAvailable()) return t.skip('python3 unavailable; exporter is validated by Skill packaging instead');
  const temp = await tempDir('veteran-export-app-');
  try {
    const appManifest = path.join(temp, '.app.json');
    const appValue = { apps: [{ id: 'app_test_veteran' }] };
    await fs.writeFile(appManifest, `${JSON.stringify(appValue)}\n`);
    const web = path.join(temp, 'web-app.zip');
    runPython([exporter, skillRoot, '--profile', 'web', '--app-manifest', appManifest, '--output', web]);
    const report = zipReport(web);
    assert.equal(report.manifest.apps, './.app.json');
    assert.ok(report.names.includes('veteran-engineer/.app.json'));
    assert.equal(report.distribution.includes.appReference, true);
    const readProgram = "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read('veteran-engineer/.app.json').decode(),end='')";
    assert.deepEqual(JSON.parse(runPython(['-c', readProgram, web])), appValue);
  } finally {
    await cleanup(temp);
  }
});


test('workspace exporter refuses releases without Git provenance', async (t) => {
  if (!pythonAvailable()) return t.skip('python3 unavailable; exporter is validated by packaging CI instead');
  const temp = await tempDir('veteran-export-workspace-provenance-');
  try {
    const workspace = path.join(temp, 'workspace.zip');
    const result = spawnSync('python3', [exporter, skillRoot, '--profile', 'workspace', '--output', workspace], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /--source-revision is required with --profile workspace/);
  } finally {
    await cleanup(temp);
  }
});

test('workspace exporter normalizes Studio identity and remains skill-only', async (t) => {
  if (!pythonAvailable()) return t.skip('python3 unavailable; exporter is validated by packaging CI instead');
  const temp = await tempDir('veteran-export-workspace-');
  try {
    const workspace = path.join(temp, 'workspace.zip');
    runPython([
      exporter,
      skillRoot,
      '--profile',
      'workspace',
      '--source-revision',
      workspaceRevision,
      '--output',
      workspace
    ]);
    const report = zipReport(workspace);
    assert.equal(report.manifest.name, 'veteran-engineering-studio');
    assert.equal(report.manifest.skills, './skills');
    assert.equal(report.manifest.mcpServers, undefined);
    assert.equal(report.manifest.apps, undefined);
    assert.equal(report.distribution.profile, 'workspace');
    assert.equal(report.distribution.surfaceProfile, 'workspace-skill');
    assert.equal(report.distribution.releaseProvenance.sourceRevision, workspaceRevision);
    assert.equal(report.distribution.releaseProvenance.sourceOfTruth, 'https://github.com/9529360-cpu/veteran-engineer');
    assert.match(report.distribution.releaseProvenance.policy, /refs\/heads\/main/);
    assert.match(report.distribution.releaseProvenance.policy, /never publish pull-request artifacts/);
    assert.ok(report.names.includes('veteran-engineer/plugin.json'));
    assert.ok(report.names.includes('veteran-engineer/skills/runtime-regression-debugger/SKILL.md'));
    assert.ok(report.names.includes('veteran-engineer/skills/frontend-design-builder/SKILL.md'));
    const portable = JSON.parse(zipText(workspace, 'veteran-engineer/plugin.json'));
    assert.equal(report.manifest.version, portable.version);
    assert.deepEqual(report.manifest.interface, portable.extensions['com.openai'].interface);
  } finally {
    await cleanup(temp);
  }
});
