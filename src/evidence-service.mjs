import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, randomId, sha256, stableStringify } from './util.mjs';

export class EvidenceService {
  constructor({ store }) {
    this.store = store;
  }

  async record({ projectId, missionId = null, taskId = null, type, summary, sourceIdentity = null, runtimeIdentity = null, artifact = null, metadata = {} }) {
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
      metadata,
      createdAt: nowIso()
    };
    await this.store.transaction('evidence_recorded', (state) => {
      state.evidence[id] = record;
      if (taskId && missionId) {
        const task = state.tasks[`${missionId}:${taskId}`];
        if (task && !task.evidenceIds.includes(id)) task.evidenceIds.push(id);
      }
    }, { evidenceId: id, type, projectId, missionId, taskId });
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
