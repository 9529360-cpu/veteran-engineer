import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createNativeAgent } from '../src/native-agent-kernel.mjs';
import { createScopedRepositoryTools } from '../src/native-agent-tools.mjs';
import { createOpenAICompatibleModel, normalizeModelEndpoint } from '../src/native-agent-model.mjs';

function modelFromSteps(steps, received) {
  let i = 0;
  return { async complete(value) {
    received.push(value);
    assert.ok(steps[i], 'Unexpected independent model turn ' + i);
    return steps[i++];
  } };
}

test('native agent performs real tool calls and independent follow-up model turns', async () => {
  const trace = [];
  const agent = createNativeAgent({
    model: modelFromSteps([
      { content: '', toolCalls: [{ id: 'call-1', name: 'inspect', arguments: { key: 'a' } }] },
      { content: 'Task completed with evidence', toolCalls: [] }
    ], trace),
    tools: [{ name: 'inspect', readOnly: true, description: 'Read evidence', execute: async ({ key }) => ({ found: key }) }],
    allowAdvisors: false
  });
  const result = await agent.prompt('Inspect the repository');
  assert.equal(result.status, 'completed');
  assert.equal(result.turns, 2);
  assert.equal(trace.length, 2);
  assert.ok(trace[1].messages.some((msg) => msg.role === 'tool' && msg.content.includes('"found":"a"')));
  assert.equal(agent.history[0].role, 'user');
});

test('self-spawned adviser uses a genuinely separate model context and read-only tool set', async () => {
  const trace = [];
  const model = {
    async complete({ messages, tools }) {
      trace.push({ messages, tools });
      const system = messages[0].content;
      if (system.includes('independent, read-only adviser')) {
        assert.equal(tools.some((t) => t.name === 'write_file'), false);
        assert.equal(tools.some((t) => t.name === 'spawn_advisor'), false);
        assert.ok(messages.every((m) => !String(m.content).includes('primary-secret-context')));
        return { content: 'Independent counterexample found', toolCalls: [] };
      }
      if (trace.filter((entry) => !entry.messages[0].content.includes('independent, read-only adviser')).length === 1) {
        return { content: '', toolCalls: [{ id: 'spawn-one', name: 'spawn_advisor', arguments: {
          question: 'Challenge the proposed architecture', perspective: 'Look for race conditions'
        } }] };
      }
      return { content: 'Primary reviewed the counterexample', toolCalls: [] };
    }
  };
  const events = [];
  const parent = createNativeAgent({ model, advisorCapacity: 3, systemPrompt: 'primary-secret-context', onEvent: (e) => events.push(e),
    tools: [
      { name: 'read_file', readOnly: true, execute: async () => 'read' },
      { name: 'write_file', readOnly: false, execute: async () => 'changed' }
    ]
  });
  const result = await parent.prompt('Review the plan');
  assert.equal(result.text, 'Primary reviewed the counterexample');
  assert.equal(trace.length, 3);
  assert.equal(events.filter((e) => e.type === 'agent_spawned').length, 1);
  assert.equal(events.filter((e) => e.type === 'agent_completed').length, 1);
  assert.equal(parent.children.size, 0);
  assert.ok(parent.history.some((e) => e.role === 'tool' && e.content.includes('Independent counterexample found')));
});

test('advisers cannot exceed resource capacity or delegate their own teams', async () => {
  const main = createNativeAgent({ model: { complete: async () => ({ content: 'ok', toolCalls: [] }) }, advisorCapacity: 0 });
  await assert.rejects(main.spawnAdvisor({ question: 'Review' }), (e) => e.code === 'NATIVE_AGENT_HOST_CAPACITY');
  const child = createNativeAgent({ model: { complete: async () => ({ content: 'ok', toolCalls: [] }) }, allowAdvisors: false });
  await assert.rejects(child.spawnAdvisor({ question: 'Delegate' }), (e) => e.code === 'NATIVE_AGENT_DELEGATION_FORBIDDEN');
});

test('native agent scoped tools reject outside paths, symlink escapes and unrelated writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-native-tools-'));
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'allowed.txt'), 'before');
    await fs.writeFile(path.join(root, 'private.txt'), 'keep');
    await fs.symlink(os.tmpdir(), path.join(root, 'src', 'unsafe'));
    const tools = await createScopedRepositoryTools({ worktreePath: root, writeSet: ['src'], protectedPaths: ['src/do-not-touch.txt'] });
    const writer = tools.find((x) => x.name === 'write_file');
    const reader = tools.find((x) => x.name === 'read_file');
    const editor = tools.find((x) => x.name === 'edit_file');
    await writer.execute({ path: 'src/new.txt', content: 'native' });
    assert.equal(await fs.readFile(path.join(root, 'src', 'new.txt'), 'utf8'), 'native');
    await editor.execute({ path: 'src/allowed.txt', old_text: 'before', new_text: 'after' });
    assert.equal(await reader.execute({ path: 'src/allowed.txt' }), 'after');
    await assert.rejects(writer.execute({ path: 'private.txt', content: 'stolen' }), (e) => e.code === 'NATIVE_AGENT_WRITE_SCOPE_DENIED');
    await assert.rejects(writer.execute({ path: 'src/../private.txt', content: 'stolen' }), (e) => e.code === 'NATIVE_AGENT_WRITE_SCOPE_DENIED');
    await assert.rejects(writer.execute({ path: 'src/do-not-touch.txt', content: 'stolen' }), (e) => e.code === 'NATIVE_AGENT_WRITE_SCOPE_DENIED');
    await assert.rejects(reader.execute({ path: 'src/unsafe/payload' }), (e) => e.code === 'NATIVE_AGENT_SYMLINK_DENIED');
    await assert.rejects(reader.execute({ path: '.env.local' }), (e) => e.code === 'NATIVE_AGENT_PATH_DENIED');
    assert.equal(await fs.readFile(path.join(root, 'private.txt'), 'utf8'), 'keep');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('model adapter sends portable OpenAI-compatible tool calls without requiring subscriptions', async () => {
  const calls = [];
  const model = createOpenAICompatibleModel({ baseURL: 'http://127.0.0.1:11434/v1', model: 'local-coder',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, async json() { return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'abc', function: { name: 'read_file', arguments: '{"path":"README.md"}' }
      }] } }] }; } };
    }
  });
  const result = await model.complete({ messages: [{ role: 'user', content: 'read README' }], tools: [{ name: 'read_file', parameters: { type: 'object' } }] });
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(Object.hasOwn(calls[0].opts.headers, 'Authorization'), false);
  assert.equal(result.toolCalls[0].name, 'read_file');
  assert.equal(JSON.parse(calls[0].opts.body).tools[0].function.name, 'read_file');
  assert.throws(() => normalizeModelEndpoint('http://remote.example/v1'), (e) => e.code === 'NATIVE_MODEL_ENDPOINT_UNSAFE');
});
