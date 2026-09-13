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

async function cleanupUncommittedFiles(paths) {
  await Promise.allSettled(paths.map((full) => fs.rm(full, { force: true })));
}

export class EvidenceService {
  constructor({ store }) {
    this.store = store;
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
    const record = {
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
      attachments: attachmentRecords,
      metadata,
      createdAt: nowIso()
    };

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
        state.evidence[id] = record;
        if (taskId && missionId) {
          const task = state.tasks[`${missionId}:${taskId}`];
          if (task && !task.evidenceIds.includes(id)) task.evidenceIds.push(id);
        }
      }, { evidenceId: id, type, projectId, missionId, taskId, attachmentCount: attachmentRecords.length });
      return record;
    } catch (error) {
      if (!isStateCommitAuditOutcomeUnknown(error)) await cleanupUncommittedFiles(createdFiles);
      throw error;
    }
  }

  async query({ projectId, missionId, taskId, type, ids, limit = 50 }) {
    const state = await this.store.read();
    let items = Object.values(state.evidence);
    if (ids?.length) items = ids.map((id) => state.evidence[id]).filter(Boolean);
    if (projectId) items = items.filter((item) => item.projectId === projectId);
    if (missionId) items = items.filter((item) => item.missionId === missionId);
    if (taskId) items = items.filter((item) => item.taskId === taskId);
    if (type) items = items.filter((item) => item.type === type);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(limit, 200)));
  }
}
