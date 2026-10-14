import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('Mission spawns a real Veteran-native agent process, uses a local model and integrates scoped changes', { timeout: 90_000 }, async () => {
  const fixture = await createGitRepo({ files: { 'src/target.txt': 'before\n' } });
  const calls = [];
  const model = http.createServer(async (req, res) => {
    let json = '';
    for await (const part of req) json += part;
    const body = JSON.parse(json);
    calls.push(body);
    const stage = calls.length;
    const assistant = stage === 1
      ? { content: null, tool_calls: [{ id: 'read1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/target.txt"}' } }] }
      : stage === 2
        ? { content: null, tool_calls: [{ id: 'edit1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/target.txt","content":"native-agent-change\\n"}' } }] }
        : { content: 'Implemented the scoped change.', tool_calls: [] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: assistant }] }));
  });
  await listen(model);
  try {
    const address = model.address();
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), JSON.stringify({ defaults: { workerPolicy: {
      enabled: true, maxWorkers: 1, memoryMiBPerWorker: 64,
      nativeAgent: { model: 'mock-local-coder', baseURL: `http://127.0.0.1:${address.port}/v1`, maxTurns: 8, advisorCapacity: 0 }
    } } }));
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'change file with self-owned Agent kernel', doneDefinition: 'file contains native-agent-change',
      tasks: [{ id: 'A', owner: 'src/target.txt', contract: 'replace src/target.txt with native-agent-change', writeSet: ['src/target.txt'], dependencies: [], risk: 'low' }] });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, true, JSON.stringify(result.results[0]));
    assert.ok(result.results[0].commitSha);
    assert.equal(calls.length, 3);
    assert.ok(calls[1].messages.some((m) => m.role === 'tool' && m.content.includes('before')));
    assert.deepEqual((await git(fixture.repo, ['show', '--format=', '--name-only', result.results[0].commitSha])).stdout.trim().split('\n'), ['src/target.txt']);
    assert.equal(await fs.readFile(path.join(fixture.repo, 'src/target.txt'), 'utf8'), 'before\n');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.agentTeam.memberCount, 1);
    assert.equal(status.agentTeam.members[0].execution, 'independent-runtime-worker');
  } finally {
    await close(model);
    await cleanup(fixture.root);
  }
});
