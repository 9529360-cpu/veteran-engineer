import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, randomId } from './util.mjs';
import { renderHandoffMarkdown, renderHandoffWorkspaceHtml } from './handoff-workspace.mjs';

function contentSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function writeBundle(artifactsDir, files) {
  const written = [];
  try {
    await fs.mkdir(artifactsDir, { recursive: true });
    for (const file of files) {
      const full = path.join(artifactsDir, file.filename);
      await fs.writeFile(full, file.content, { mode: 0o600, flag: 'wx' });
      written.push(full);
    }
  } catch (error) {
    await Promise.allSettled(written.map((file) => fs.rm(file, { force: true })));
    throw error;
  }
}

function descriptor(filename, mediaType, content) {
  return {
    artifactPointer: `artifacts/${filename}`,
    mediaType,
    sha256: contentSha256(content)
  };
}

export class HandoffService {
  constructor({ store, missionService }) {
    this.store = store;
    this.missionService = missionService;
  }

  async export({ missionId }) {
    const { mission, tasks, candidates } = await this.missionService.status({ missionId });
    const readiness = await this.missionService.readiness({ missionId });
    const state = await this.store.read();
    const project = state.projects[mission.projectId];
    const evidence = Object.values(state.evidence).filter((item) => item.missionId === missionId).map((item) => ({ id: item.id, type: item.type, summary: item.summary, sourceIdentity: item.sourceIdentity, createdAt: item.createdAt }));
    const experiences = Object.values(state.experiences).filter((item) => item.projectId === mission.projectId && item.status === 'active').map((item) => ({ id: item.id, mechanism: item.mechanism, statement: item.statement, evidenceIds: item.evidenceIds, sourceIdentity: item.sourceIdentity }));
    const handoff = {
      schema: 'veteran-handoff-v1',
      exportedAt: nowIso(),
      project: { id: project.id, name: project.name, repoPath: project.repoPath, sourceIdentity: project.sourceIdentity },
      mission,
      tasks,
      candidates,
      evidence,
      activeExperiences: experiences,
      timeline: state.runtime.timeline.filter((item) => item.missionId === missionId),
      readiness,
      nextSafeAction: readiness.nextAction || (readiness.ready ? mission.phase : null)
    };
    const id = randomId('handoff');
    const jsonFilename = `${id}.json`;
    const markdownFilename = `${id}.md`;
    const workspaceFilename = `${id}.html`;
    const jsonContent = `${JSON.stringify(handoff, null, 2)}\n`;
    const markdownContent = renderHandoffMarkdown(handoff);
    const workspaceContent = renderHandoffWorkspaceHtml(handoff);
    await writeBundle(this.store.artifactsDir, [
      { filename: jsonFilename, content: jsonContent },
      { filename: markdownFilename, content: markdownContent },
      { filename: workspaceFilename, content: workspaceContent }
    ]);
    const artifacts = {
      json: descriptor(jsonFilename, 'application/json', jsonContent),
      markdown: descriptor(markdownFilename, 'text/markdown; charset=utf-8', markdownContent),
      workspace: descriptor(workspaceFilename, 'text/html; charset=utf-8', workspaceContent)
    };
    return { id, artifactPointer: artifacts.json.artifactPointer, artifacts, handoff };
  }
}
