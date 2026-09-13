import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, randomId, sha256, stableStringify } from './util.mjs';

const MAX_ATTACHMENTS = 128;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 64 * 1024 * 1024;

function attachmentExtension(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '.bin';
}

export class EvidenceService {
  constructor({ store }) {
    this.store = store;
  }

  async record({ projectId, missionId = null, taskId = null, type, summary, sourceIdentity = null, runtimeIdentity = null, artifact = null, attachments = [], metadata = {} }) {
    const id = randomId('evidence');
    let artifactPointer = null;
    let artifactHash = null;
    if (artifact !== null && artifact !== undefined) {
      const content = typeof artifact === 'string' ? artifact : `${JSON.stringify(artifact, null, 2)}\n`;
      artifactHash = sha256(content);
      const filename = `${id}.txt`;
      const full = path.join(this.store.artifactsDir, filename);
      await fs.writeFile(full, content, { mode: 0o600 });
      artifactPointer = `artifacts/${filename}`;
    }
    const attachmentRecords = [];
    if (!Array.isArray(attachments)) throw new TypeError('evidence attachments must be an array');
    if (attachments.length > MAX_ATTACHMENTS) throw new RangeError(`evidence attachments may contain at most ${MAX_ATTACHMENTS} files`);
    let attachmentTotalBytes = 0;
    const normalizedAttachments = attachments.map((item) => {
      if (!item || typeof item !== 'object' || !item.name || (typeof item.content !== 'string' && !Buffer.isBuffer(item.content) && !(item.content instanceof Uint8Array))) {
        throw new TypeError('evidence attachment must provide name and string/binary content');
      }
      const content = typeof item.content === 'string' ? Buffer.from(item.content) : Buffer.from(item.content);
      if (content.length > MAX_ATTACHMENT_BYTES) throw new RangeError(`evidence attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
      attachmentTotalBytes += content.length;
      if (attachmentTotalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new RangeError(`evidence attachments exceed ${MAX_ATTACHMENT_TOTAL_BYTES} total bytes`);
      return { item, content };
    });
    for (const [index, { item, content }] of normalizedAttachments.entries()) {
      const filename = `${id}-${String(index + 1).padStart(3, '0')}${attachmentExtension(item.name)}`;
      const full = path.join(this.store.artifactsDir, filename);
      await fs.writeFile(full, content, { mode: 0o600 });
      attachmentRecords.push({
        name: String(item.name).slice(0, 1000),
        kind: item.kind ? String(item.kind).slice(0, 80) : 'evidence-attachment',
        artifactPointer: `artifacts/${filename}`,
        artifactHash: sha256(content),
        bytes: content.length
      });
    }
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
    await this.store.transaction('evidence_recorded', (state) => {
      state.evidence[id] = record;
      if (taskId && missionId) {
        const task = state.tasks[`${missionId}:${taskId}`];
        if (task && !task.evidenceIds.includes(id)) task.evidenceIds.push(id);
      }
    }, { evidenceId: id, type, projectId, missionId, taskId, attachmentCount: attachmentRecords.length });
    return record;
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
