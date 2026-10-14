import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('Veteran native lead Agent generates task DAG without Codex/Claude executors or external planner commands', { timeout: 60_000 }, async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a', 'src/b.txt': 'b' } });
  let turns = 0;
  const model = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    turns++;
    const assistant = turns === 1
      ? { content: null, tool_calls: [{ id: 'structure', type: 'function', function: { name: 'list_files', arguments: '{"path":"src"}' } }] }
      : turns === 2
        ? { content: null, tool_calls: [{ id: 'plan', type: 'function', function: { name: 'submit_plan', arguments: JSON.stringify({ tasks: [
          { id: 'A', contract: 'Update src/a.txt', owner: 'src/a.txt', writeSet: ['src/a.txt'], dependencies: [], risk: 'low' },
          { id: 'B', contract: 'Update src/b.txt', owner: 'src/b.txt', writeSet: ['src/b.txt'], dependencies: [], risk: 'low' }
        ], rationale: 'Independent file owners permit safe parallelism.' }) } }] }
        : { content: 'Submitted the task graph', tool_calls: [] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: assistant }] }));
    if (turns === 2) assert.equal(body.tools.some((t) => t.function.name === 'write_file'), false);
  });
  await listen(model);
  try {
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), JSON.stringify({ defaults: { workerPolicy: {
      enabled: true, memoryMiBPerWorker: 64, maxWorkers: 8,
      nativeAgent: { model: 'local-planner', baseURL: `http://127.0.0.1:${model.address().port}/v1`, advisorCapacity: 0 }
    } } }));
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'Update two files independently', doneDefinition: 'both changed' });
    assert.equal(planned.tasks.length, 2);
    assert.deepEqual(planned.mission.waves, [['A', 'B']]);
    assert.equal(planned.mission.executionStrategy.executionMode, 'parallel-mission');
    assert.equal(turns, 3);
    const state = await app.store.read();
    const plannerProof = Object.values(state.evidence || {}).find((e) => e.type === 'native-agent-planner');
    assert.ok(plannerProof, 'Native planner result should be evidence-bound');
  } finally {
    await close(model);
    await cleanup(fixture.root);
  }
});
