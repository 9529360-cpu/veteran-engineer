import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HandoffService } from '../src/handoff-service.mjs';
import { renderHandoffMarkdown, renderHandoffWorkspaceHtml } from '../src/handoff-workspace.mjs';

const projectionFixture = {
  exportedAt: '2026-09-16T00:00:00Z',
  project: { id: 'project-a', name: 'Monster <Lab>' },
  mission: { id: 'mission-a', goal: 'Ship <script>alert(1)</script>', status: 'executing', phase: 'execution' },
  tasks: [
    { id: 'T1', status: 'executing', contract: 'Build workspace', owner: 'runtime', risk: 'low' },
    { id: 'T2', status: 'blocked', contract: 'Publish board', dependencies: ['T1'], owner: 'handoff' }
  ],
  evidence: [{ id: 'e1', type: 'test', summary: '<b>green</b>' }],
  timeline: [{ at: '2026-09-16T00:00:00Z', type: 'task-started', taskId: 'T1', message: '<img src=x onerror=alert(1)>' }],
  readiness: { ready: false, blockers: [{ code: 'TASK_BLOCKED', message: '<blocked>' }] },
  nextSafeAction: 'mission-execute'
};

test('handoff workspace projections escape untrusted mission content', () => {
  const markdown = renderHandoffMarkdown(projectionFixture);
  assert.match(markdown, /## Task board/);
  assert.match(markdown, /### executing \(1\)/);
  assert.doesNotMatch(markdown, /<script>/);
  assert.match(markdown, /&lt;script&gt;/);

  const html = renderHandoffWorkspaceHtml(projectionFixture);
  assert.match(html, /Task board/);
  assert.match(html, /Next safe action/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test('handoff export preserves JSON artifactPointer and adds local Markdown and HTML projections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-handoff-workspace-'));
  try {
    const store = {
      artifactsDir: path.join(root, 'artifacts'),
      async read() {
        return {
          projects: { p1: { id: 'p1', name: 'Monster', repoPath: root, sourceIdentity: { head: 'abc' } } },
          evidence: { e1: { id: 'e1', missionId: 'm1', type: 'test', summary: '<green>', sourceIdentity: { head: 'abc' }, createdAt: 'now' } },
          experiences: {},
          runtime: { timeline: [{ missionId: 'm1', type: 'task-started', taskId: 'T1', at: 'now' }] }
        };
      }
    };
    const missionService = {
      async status() {
        return {
          mission: { id: 'm1', projectId: 'p1', goal: '<script>x</script>', status: 'executing', phase: 'execution' },
          tasks: [{ id: 'T1', missionId: 'm1', status: 'executing', contract: 'Build' }],
          candidates: []
        };
      },
      async readiness() { return { ready: true, nextAction: 'mission-advance', blockers: [] }; }
    };
    const service = new HandoffService({ store, missionService });
    const exported = await service.export({ missionId: 'm1' });

    assert.equal(exported.artifacts.json.artifactPointer, exported.artifactPointer);
    assert.equal(exported.artifacts.json.mediaType, 'application/json');
    assert.equal(exported.artifacts.markdown.mediaType, 'text/markdown; charset=utf-8');
    assert.equal(exported.artifacts.workspace.mediaType, 'text/html; charset=utf-8');
    assert.equal(exported.artifacts.json.sha256.length, 64);

    const jsonFile = path.join(root, exported.artifacts.json.artifactPointer);
    const markdownFile = path.join(root, exported.artifacts.markdown.artifactPointer);
    const workspaceFile = path.join(root, exported.artifacts.workspace.artifactPointer);
    const machine = JSON.parse(await fs.readFile(jsonFile, 'utf8'));
    assert.equal(machine.nextSafeAction, 'mission-advance');
    const markdown = await fs.readFile(markdownFile, 'utf8');
    assert.match(markdown, /Next safe action: mission\\-advance/);
    const workspace = await fs.readFile(workspaceFile, 'utf8');
    assert.match(workspace, /Mission workspace/);
    assert.doesNotMatch(workspace, /<script\b/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
