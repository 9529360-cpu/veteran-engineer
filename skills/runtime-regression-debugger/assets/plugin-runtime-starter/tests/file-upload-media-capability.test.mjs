import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const gate = path.join(skillRoot, 'scripts', 'file_upload_media_gate.py');
const reference = path.join(skillRoot, 'references', 'file-upload-media-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats file/upload/media lifecycle as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'File/Upload/Media Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'file-upload,resumable-upload,multipart-upload,attachment-flow,object-delivery,media-processing,signed-object-url,upload-quarantine,upload-lifecycle,remote-file-import',
    '--max', '13',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/file-upload-media-product-engineering.md',
    'references/security-multitenancy-patterns.md',
    'references/data-movement-cdc-search-storage.md',
    'references/async-edge-job-patterns.md',
    'references/lifecycle-closure-design-to-deletion.md',
    'references/dependency-outcome-degradation.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'direct-upload,presigned-upload,resume-upload,chunked-upload,file-attachment,download-delivery,media-transcoding,thumbnail-processing,presigned-download,virus-scan-upload,orphan-upload-cleanup,import-from-url',
    '--max', '13',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'file-upload', 'file-upload', 'resumable-upload', 'multipart-upload', 'attachment-flow',
    'object-delivery', 'media-processing', 'media-processing', 'signed-object-url',
    'upload-quarantine', 'upload-lifecycle', 'remote-file-import'
  ]);

  const ambiguous = runPython(router, ['--signals', 'file,upload,download,storage,media,url,attachment', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['file', 'upload', 'download', 'storage', 'media', 'url', 'attachment']);
});

test('file/upload/media gate fails closed on incomplete transfer and lifecycle contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'File/Upload/Media Product Engineering reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-file-upload-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      experience: {
        user_outcome: 'Users can upload, resume, process, attach, preview/download, replace and delete files with truthful states and recoverable failures.',
        purpose: 'workspace document attachment and image/video preview pipeline',
        file_categories: ['document-attachment', 'image', 'video'],
        visible_states: 'queued/uploading/paused/processing/ready/rejected/failed/reconciling are distinct when the user can act differently'
      },
      identity: {
        upload_intent: 'server-issued intent binds actor, tenant, target purpose, policy, expiry and stable upload session id',
        object_version: 'immutable/versioned object identity owns bytes, checksum, size and verified metadata independently of user filename',
        domain_attachment: 'document attachment id links one authorized object version to the domain resource only after validation',
        owner_scope: 'tenant/resource ownership is authoritative metadata and is rechecked for finalization, attach and delivery'
      },
      transfer: {
        method: 'direct object-storage upload uses multipart for large files and application-controlled finalization',
        resume_retry: 'stable upload id and part identities make retry/resume idempotent without duplicate objects or attachments',
        finalization: 'trusted server verifies object version, byte size/checksum and intent before marking transfer complete',
        unknown_outcome: 'timeout after finalize/attach reconciles by upload/object/operation id before creating new work',
        abandon_cleanup: 'expired upload intents and multipart parts become cleanup candidates after a bounded grace period'
      },
      validation_processing: {
        trusted_validation: 'server-side policy validates actual bytes/type/size/checksum and parser limits rather than client extension alone',
        quarantine_policy: 'objects requiring scanning are unavailable to normal preview/download until the authoritative scan passes',
        processing_state: 'processing jobs own explicit pending/ready/failed states and publish derived media only after success',
        stale_transform_policy: 'transform jobs bind source object generation so an old job cannot publish over a replacement version'
      },
      delivery: {
        authorization: 'every preview/download rechecks current principal tenant resource permission at trusted boundary',
        preview_download: 'stream/range delivery bounds memory and uses safe content type/disposition/sandbox behavior for active content',
        signed_capability_policy: 'signed upload/download capabilities scope exact object/version method and bounded expiry and are never logged raw',
        cache_versioning: 'immutable/versioned object/derivative urls prevent stale CDN/browser content after replacement or deletion'
      },
      lifecycle: {
        attach_commit: 'domain service authorizes and commits attachment to a validated object version; indexing/notification failures remain separate',
        replacement_versioning: 'replacement creates a new version/generation and old processing results cannot attach to the new logical file',
        delete_cleanup: 'domain suppression stops delivery then source/derivatives/projections are deleted or reconciled under policy',
        orphan_policy: 'unattached completed objects and failed derivatives are cleaned after a bounded window without racing valid multi-step flows',
        quota_policy: 'server-side accounting bounds size, unfinalized bytes, concurrent uploads, processing capacity and retained storage'
      },
      tests: {
        scenarios: ['cross-tenant-attach', 'duplicate-finalize', 'lost-finalize-ack', 'interrupted-resume', 'invalid-content', 'processing-failure', 'quarantine-bypass', 'stale-transform', 'delete-cleanup', 'orphan-expiry'],
        oracle: 'domain attachment, authoritative object version, processing state, delivery authorization and user-visible state agree after retry/replay/failure'
      },
      observability: {
        transfer_status: 'track issued/finalized/expired intents, resume/retry/abort and bytes/duration by bounded product category',
        processing_status: 'track validation rejection, quarantine, processing latency/failure and stale-generation rejection',
        cleanup_status: 'track abandoned multipart/orphan/derivative cleanup backlog and deletion reconciliation without logging raw files or signed urls'
      },
      compatibility: {
        mixed_version_behavior: 'supported old clients can finalize existing intents while new server schemas remain additive/versioned',
        storage_or_recipe_migration: 'stable domain object identity survives provider/key migration and derivative recipe versions are explicit',
        rollback: 'code rollback is separate from irreversible deletes/external writes and uses approved object recovery where available'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      experience: { user_outcome: '', purpose: true, file_categories: [], visible_states: '' },
      identity: {}, transfer: {}, validation_processing: {}, delivery: {}, lifecycle: {},
      tests: { scenarios: ['invalid-content'], oracle: false },
      observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'EXPERIENCE_FIELD_REQUIRED', 'FILE_CATEGORIES_REQUIRED', 'IDENTITY_FIELD_REQUIRED', 'TRANSFER_FIELD_REQUIRED',
      'VALIDATION_PROCESSING_FIELD_REQUIRED', 'DELIVERY_FIELD_REQUIRED', 'LIFECYCLE_FIELD_REQUIRED',
      'TEST_SCENARIOS_INCOMPLETE', 'TESTS_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
