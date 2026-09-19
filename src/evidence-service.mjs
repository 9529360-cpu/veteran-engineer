import fs from 'node:fs/promises';
import path from 'node:path';
import { isStateCommitAuditOutcomeUnknown } from './state-backend-durability-contract.mjs';
import { nowIso, randomId, sha256, stableStringify } from './util.mjs';

const MAX_ATTACHMENTS = 128;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 64 * 1024 * 1024;

function attachmentExtension(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '.bin';
}

function buildEvidenceRecord({
  id,
  projectId,
  missionId = null,
  taskId = null,
  type,
  summary,
  sourceIdentity = null,
  runtimeIdentity = null,
  artifactPointer = null,
  artifactHash = null,
  attachments = [],
  metadata = {}
}) {
  return {
    id,
    projectId,
    missionId,
    taskId,
    type,
    summary: typeof summary === 'string' ? summary.slice(0, 4000) : stableStringify(summary).slice(0, 4000),
    sourceIdentity,
    runtimeIdentity,
    artifactPointer,
    artifactHash,
    attachments,
    metadata,
    createdAt: nowIso()
  };
}

function attachEvidenceRecord(state, record) {
  state.evidence[record.id] = record;
  if (record.taskId && record.missionId) {
    const task = state.tasks[`${record.missionId}:${record.taskId}`];
    if (task && !task.evidenceIds.includes(record.id)) task.evidenceIds.push(record.id);
  }
}

async function cleanupUncommittedFiles(paths) {
  await Promise.allSettled(paths.map((full) => fs.rm(full, { force: true })));
}

export class EvidenceService {
  constructor({ store }) {
    this.store = store;
  }

  prepareMetadataRecord({ projectId, missionId = null, taskId = null, type, summary, sourceIdentity = null, runtimeIdentity = null, metadata = {} }) {
    return buildEvidenceRecord({
      id: randomId('evidence'),
      projectId,
      missionId,
      taskId,
      type,
      summary,
      sourceIdentity,
      runtimeIdentity,
      artifactPointer: null,
      artifactHash: null,
      attachments: [],
      metadata
    });
  }

  attachPreparedRecord(state, record) {
    if (!record || typeof record !== 'object' || !record.id || record.artifactPointer !== null || record.artifactHash !== null || !Array.isArray(record.attachments) || record.attachments.length !== 0) {
      throw new TypeError('prepared evidence record must be metadata-only');
    }
    attachEvidenceRecord(state, record);
    return record;
  }

  async record({ projectId, missionId = null, taskId = null, type, summary, sourceIdentity = null, runtimeIdentity = null, artifact = null, attachments = [], metadata = {} }) {
    const id = randomId('evidence');
    if (!Array.isArray(attachments)) throw new TypeError('evidence attachments must be an array');
    if (attachments.length > MAX_ATTACHMENTS) throw new RangeError(`evidence attachments may contain at most ${MAX_ATTACHMENTS} files`);

    const artifactContent = artifact !== null && artifact !== undefined
      ? (typeof artifact === 'string' ? artifact : `${JSON.stringify(artifact, null, 2)}\n`)
      : null;
    const artifactFilename = artifactContent !== null ? `${id}.txt` : null;
    const artifactPointer = artifactFilename ? `artifacts/${artifactFilename}` : null;
    const artifactHash = artifactContent !== null ? sha256(artifactContent) : null;

    let attachmentTotalBytes = 0;
    const normalizedAttachments = attachments.map((item, index) => {
      if (!item || typeof item !== 'object' || !item.name || (typeof item.content !== 'string' && !Buffer.isBuffer(item.content) && !(item.content instanceof Uint8Array))) {
        throw new TypeError('evidence attachment must provide name and string/binary content');
      }
      const content = typeof item.content === 'string' ? Buffer.from(item.content) : Buffer.from(item.content);
      if (content.length > MAX_ATTACHMENT_BYTES) throw new RangeError(`evidence attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
      attachmentTotalBytes += content.length;
      if (attachmentTotalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new RangeError(`evidence attachments exceed ${MAX_ATTACHMENT_TOTAL_BYTES} total bytes`);
      const filename = `${id}-${String(index + 1).padStart(3, '0')}${attachmentExtension(item.name)}`;
      return {
        content,
        filename,
        record: {
          name: String(item.name).slice(0, 1000),
          kind: item.kind ? String(item.kind).slice(0, 80) : 'evidence-attachment',
          artifactPointer: `artifacts/${filename}`,
          artifactHash: sha256(content),
          bytes: content.length
        }
      };
    });
    const attachmentRecords = normalizedAttachments.map((item) => item.record);
    const record = buildEvidenceRecord({
      id,
      projectId,
      missionId,
      taskId,
      type,
      summary,
      sourceIdentity,
      runtimeIdentity,
      artifactPointer,
      artifactHash,
      attachments: attachmentRecords,
      metadata
    });

    const createdFiles = [];
    try {
      if (artifactContent !== null) {
        const full = path.join(this.store.artifactsDir, artifactFilename);
        createdFiles.push(full);
        await fs.writeFile(full, artifactContent, { mode: 0o600 });
      }
      for (const attachment of normalizedAttachments) {
        const full = path.join(this.store.artifactsDir, attachment.filename);
        createdFiles.push(full);
        await fs.writeFile(full, attachment.content, { mode: 0o600 });
      }
      await this.store.transaction('evidence_recorded', (state) => {
        attachEvidenceRecord(state, record);
      }, { evidenceId: id, type, projectId, missionId, taskId, attachmentCount: attachmentRecords.length });
      return record;
    } catch (error) {
      if (!isStateCommitAuditOutcomeUnknown(error)) await cleanupUncommittedFiles(createdFiles);
      throw error;
    }
  }

  async readImageAttachments(records, {
    maxImages,
    maxImageBytes,
    maxTotalBytes
  } = {}) {
    if (!Array.isArray(records)) throw new TypeError('evidence image records must be an array');
    if (!Number.isInteger(maxImages) || maxImages < 1) throw new TypeError('maxImages must be a positive integer');
    if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1) throw new TypeError('maxImageBytes must be a positive integer');
    if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < 1) throw new TypeError('maxTotalBytes must be a positive integer');

    const mimeByExtension = new Map([
      ['.png', 'image/png'],
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.webp', 'image/webp']
    ]);
    const candidates = [];
    for (const record of records) {
      for (const attachment of Array.isArray(record?.attachments) ? record.attachments : []) {
        const pointer = typeof attachment?.artifactPointer === 'string' ? attachment.artifactPointer : '';
        const mimeType = mimeByExtension.get(path.extname(pointer).toLowerCase());
        if (!mimeType) continue;
        candidates.push({ record, attachment, pointer, mimeType });
      }
    }
    if (candidates.length > maxImages) {
      const error = new Error(`Evidence query selected ${candidates.length} image attachments; maximum inline image count is ${maxImages}`);
      error.code = 'EVIDENCE_IMAGE_DELIVERY_LIMIT';
      throw error;
    }

    let totalBytes = 0;
    for (const candidate of candidates) {
      const bytes = candidate.attachment?.bytes;
      if (!Number.isInteger(bytes) || bytes < 0 || typeof candidate.attachment?.artifactHash !== 'string' || !/^[0-9a-f]{64}$/i.test(candidate.attachment.artifactHash)) {
        const error = new Error(`Evidence image metadata is invalid for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_INTEGRITY_INVALID';
        throw error;
      }
      if (bytes > maxImageBytes || totalBytes + bytes > maxTotalBytes) {
        const error = new Error('Evidence image selection exceeds the bounded inline delivery budget');
        error.code = 'EVIDENCE_IMAGE_DELIVERY_LIMIT';
        error.details = { maxImages, maxImageBytes, maxTotalBytes };
        throw error;
      }
      totalBytes += bytes;
    }

    let artifactsRoot;
    try {
      artifactsRoot = await fs.realpath(this.store.artifactsDir);
    } catch (cause) {
      const error = new Error('Evidence artifact store is unavailable');
      error.code = 'EVIDENCE_IMAGE_ATTACHMENT_UNAVAILABLE';
      error.details = { reason: cause?.code || 'ARTIFACT_STORE_UNAVAILABLE' };
      throw error;
    }

    const blocks = [];
    for (const candidate of candidates) {
      const prefix = 'artifacts/';
      const relative = candidate.pointer.startsWith(prefix) ? candidate.pointer.slice(prefix.length) : '';
      if (!relative || path.basename(relative) !== relative || relative.includes('\\') || relative.includes('/')) {
        const error = new Error(`Evidence image pointer is invalid for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_POINTER_INVALID';
        throw error;
      }
      const declaredPath = path.resolve(artifactsRoot, relative);
      let realPath;
      let stat;
      try {
        realPath = await fs.realpath(declaredPath);
        const escape = path.relative(artifactsRoot, realPath);
        if (!escape || escape.startsWith('..') || path.isAbsolute(escape) || path.dirname(realPath) !== artifactsRoot) {
          const error = new Error('Evidence image escaped the artifact store');
          error.code = 'EVIDENCE_IMAGE_POINTER_INVALID';
          throw error;
        }
        stat = await fs.stat(realPath);
      } catch (cause) {
        if (cause?.code === 'EVIDENCE_IMAGE_POINTER_INVALID') throw cause;
        const error = new Error(`Evidence image attachment is unavailable for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_ATTACHMENT_UNAVAILABLE';
        error.details = { reason: cause?.code || 'ATTACHMENT_UNAVAILABLE' };
        throw error;
      }
      if (!stat.isFile() || stat.size !== candidate.attachment.bytes || stat.size > maxImageBytes) {
        const error = new Error(`Evidence image metadata no longer matches stored bytes for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_INTEGRITY_MISMATCH';
        throw error;
      }
      let content;
      try {
        content = await fs.readFile(realPath);
      } catch (cause) {
        const error = new Error(`Evidence image attachment is unreadable for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_ATTACHMENT_UNAVAILABLE';
        error.details = { reason: cause?.code || 'ATTACHMENT_UNREADABLE' };
        throw error;
      }
      if (sha256(content) !== candidate.attachment.artifactHash) {
        const error = new Error(`Evidence image hash mismatch for ${candidate.record?.id || 'unknown evidence'}`);
        error.code = 'EVIDENCE_IMAGE_INTEGRITY_MISMATCH';
        throw error;
      }
      blocks.push({
        type: 'image',
        data: content.toString('base64'),
        mimeType: candidate.mimeType
      });
    }
    return blocks;
  }

  async query({ projectId, missionId, taskId, type, ids, limit = 50 }) {
    const state = await this.store.read();
    let items = Object.values(state.evidence);
    if (ids !== undefined) {
      if (!Array.isArray(ids)) throw new TypeError('evidence ids must be an array when provided');
      items = ids.map((id) => state.evidence[id]).filter(Boolean);
    }
    if (projectId) items = items.filter((item) => item.projectId === projectId);
    if (missionId) items = items.filter((item) => item.missionId === missionId);
    if (taskId) items = items.filter((item) => item.taskId === taskId);
    if (type) items = items.filter((item) => item.type === type);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(limit, 200)));
  }
}
