import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'package-plugin-artifact.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Workspace install artifact waits for full exact-head release readiness', () => {
  for (const expected of [
    '356929464: "CI"',
    '358643055: "Skill Engineering Tools"',
    '358628814: "Cross-platform host smoke"',
    '358757508: "Release"',
    'Require sibling package profiles',
    '"Export desktop plugin artifact"',
    '"Export codex plugin artifact"',
    '"Export web plugin artifact"',
  ]) {
    assert.ok(workflow.includes(expected), `missing release-readiness contract: ${expected}`);
  }

  assert.ok(
    workflow.indexOf('Require exact-main validation workflows') <
      workflow.indexOf('Stage workspace install artifact'),
    'exact-main workflow gate must run before Workspace staging',
  );
  assert.ok(
    workflow.indexOf('Require sibling package profiles') <
      workflow.indexOf('Stage workspace install artifact'),
    'profile parity gate must run before Workspace staging',
  );
});

test('Workspace publication trust-root quarantine covers every release validator', () => {
  for (const expected of [
    '.github/workflows/ci.yml',
    '.github/workflows/skill-engineering-tools.yml',
    '.github/workflows/cross-platform-host-smoke.yml',
    '.github/workflows/package-plugin-artifact.yml',
    '.github/workflows/release.yml',
    'skills/runtime-regression-debugger/scripts/workspace_release_gate.py',
    'skills/runtime-regression-debugger/scripts/export_plugin_bundle.py',
    'skills/runtime-regression-debugger/tests/requirements-ci.txt',
  ]) {
    assert.ok(workflow.includes(expected), `missing trust-root path: ${expected}`);
  }
});

test('merged-PR provenance tolerates propagation without weakening exact identity', () => {
  assert.ok(workflow.includes('deadline = time.time() + 2 * 60'));
  assert.ok(workflow.includes('merged PR association not visible yet; retrying'));
  assert.ok(workflow.includes('pr.get("merge_commit_sha") == sha'));
  assert.ok(workflow.includes('pr.get("base", {}).get("ref") == "main"'));
  assert.ok(workflow.includes('len(merged) == 1'));
});

test('publishable Workspace install remains main-push, clean-trust-root only', () => {
  const publishable =
    "matrix.profile == 'workspace' && github.event_name == 'push' && github.ref == 'refs/heads/main' && steps.studio-delta.outputs.changed == 'true' && steps.studio-delta.outputs.trust_root_changed == 'false'";
  assert.ok(workflow.split(publishable).length - 1 >= 5);
  assert.equal(workflow.includes("github.event_name != 'pull_request'"), false);
});
