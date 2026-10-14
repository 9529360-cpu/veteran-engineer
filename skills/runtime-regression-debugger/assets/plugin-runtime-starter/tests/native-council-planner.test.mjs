import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('native primary Mission planner selects competitive adviser proposal and persists choice evidence without delegating mission authority', { timeout: 60_000 }, async () => {
  const fixture = await createGitRepo({ files: { 'src/component.js': 'export const ok = true;\n' } });
  let primaryTurns = 0;
  let advisers = 0;
  let reviews = 0;
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw);
    const system = message.messages[0].content;
    const lastUser = message.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
    let assistant;
    if (system.includes('independent, read-only adviser')) {
      assert.equal(message.tools.some((t) => ['write_file', 'submit_plan', 'select_council_option', 'convene_council'].includes(t.function.name)), false);
      if (lastUser.includes('Competing independent proposals')) {
        reviews++;
        assistant = { content: JSON.stringify({ strongest: 'option_2', weakest: 'option_1', reason: 'The second scope is smaller and has direct repository evidence' }) };
      } else {
        advisers++;
        assistant = { content: lastUser.includes('option_2') ? 'A minimal change to the target file fits the mission.' : 'A full rewrite would be more expensive.' };
      }
    } else {
      primaryTurns++;
      if (primaryTurns === 1) {
        assistant = { tool_calls: [{ id: 'deliberate', function: { name: 'convene_council', arguments: JSON.stringify({
          question: 'Choose the smallest viable implementation for src/component.js',
          perspectives: ['Propose the smallest change that can be validated', 'Stress test the assumptions and realistic failure modes']
        }) } }] };
      } else {
        const toolResults = message.messages.filter((m) => m.role === 'tool');
        const council = JSON.parse(toolResults[0].content);
        if (primaryTurns === 2) assistant = { tool_calls: [{ id: 'select', function: { name: 'select_council_option', arguments: JSON.stringify({
          councilId: council.councilId, candidateId: 'option_2',
          rationale: 'Cross-reviewed minimal change with direct repository evidence'
        }) } }] };
        else if (primaryTurns === 3) assistant = { tool_calls: [{ id: 'submit', function: { name: 'submit_plan', arguments: JSON.stringify({ tasks: [
          { id: 'TASK1', contract: 'Make a minimal improvement to src/component.js and retain public API', owner: 'src/component.js', writeSet: ['src/component.js'], dependencies: [], risk: 'low' }
        ], rationale: 'Council reviewed and selected bounded change' }) } }] };
        else assistant = { content: 'The lead owns validation and final authority.' };
      }
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: assistant }] }));
  });
  await listen(server);
  try {
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), JSON.stringify({ defaults: { workerPolicy: {
      enabled: true, memoryMiBPerWorker: 64,
      nativeAgent: { model: 'local-test', baseURL: `http://127.0.0.1:${server.address().port}/v1`, plannerMaxTurns: 8, advisorCapacity: 2 }
    } } }));
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const result = await app.services.missionService.plan({ projectId: project.id, goal: 'Small improvement', doneDefinition: 'Source file remains valid' });
    assert.equal(result.tasks.length, 1);
    assert.equal(primaryTurns, 4);
    assert.equal(advisers, 2);
    assert.equal(reviews, 2);
    const state = await app.store.read();
    const planner = Object.values(state.evidence || {}).find((proof) => proof.type === 'native-agent-planner');
    assert.ok(planner);
    const summary = JSON.parse(planner.summary);
    assert.equal(summary.nativeCouncilCount, 1);
    assert.equal(summary.nativeCouncilChoices, 1);
    assert.equal(summary.nativeCouncilReviewBallots, 2);
    assert.ok(planner.artifactPointer);
    const artifact = await fs.readFile(path.join(fixture.stateRoot, planner.artifactPointer), 'utf8');
    assert.match(artifact, /Cross-reviewed minimal change/);
    assert.match(artifact, /"proposalEvidence"/);
    assert.equal(result.mission.executionStrategy?.leadAgentId || result.mission.agentId || null, null, 'Council must not fabricate a second mission owner');
  } finally {
    await close(server);
    await cleanup(fixture.root);
  }
});
