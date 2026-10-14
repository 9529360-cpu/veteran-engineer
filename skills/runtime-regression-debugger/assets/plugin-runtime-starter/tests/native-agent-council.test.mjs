import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeAgent } from '../src/native-agent-kernel.mjs';
import { conveneNativeCouncil, readNativeCouncil, selectNativeCouncilOption } from '../src/native-agent-council.mjs';

const perspective = (i) => `Independent perspective ${i}: develop an implementation plan and examine tradeoffs`;

function councilModel({ reviewMode = 'ballots', slow = false } = {}) {
  const traces = [];
  let concurrent = 0;
  let peak = 0;
  const model = {
    async complete({ messages, tools }) {
      assert.ok(messages[0].content.includes('read-only adviser'));
      assert.ok(tools.every((t) => t.name !== 'write_file' && t.name !== 'spawn_advisor'
        && t.name !== 'convene_council' && t.name !== 'select_council_option'));
      const prompt = messages.at(-1).content;
      concurrent++;
      peak = Math.max(peak, concurrent);
      try {
        if (slow) await delay(12);
        traces.push({ messages, tools });
        if (prompt.includes('Competing independent proposals')) {
          return { content: reviewMode === 'ballots'
            ? JSON.stringify({ strongest: 'option_2', weakest: 'option_1', reason: 'Option 2 minimizes changes and has independent evidence', unresolvedRisks: ['Run regression tests'] })
            : 'I suspect option_2 is more practical but cannot structure a ballot', toolCalls: [],
          usage: { prompt_tokens: 21, completion_tokens: 7 } };
        }
        const id = prompt.match(/Your candidate identifier: (option_\d+)/)?.[1];
        assert.ok(id);
        return { content: `${id} concrete proposal with repository evidence and risk`, toolCalls: [],
          usage: { prompt_tokens: 11, completion_tokens: 5 } };
      } finally { concurrent--; }
    }
  };
  return { model, traces, get peak() { return peak; } };
}

test('Council forms real independent proposals, cross-reviews, advisory ranking and bounded model telemetry', async () => {
  const m = councilModel({ slow: true });
  const events = [];
  const lead = createNativeAgent({ model: m.model, advisorCapacity: 2,
    tools: [
      { name: 'read_file', readOnly: true, execute: async () => 'evidence' },
      { name: 'write_file', readOnly: false, execute: async () => 'danger' }
    ], onEvent: (e) => events.push(e) });
  const result = await conveneNativeCouncil(lead, {
    question: 'Evaluate reliability of the new multi-Agent engineering workflow',
    perspectives: Array.from({ length: 5 }, (_, i) => perspective(i + 1)),
    maxTurns: 4
  });
  assert.equal(result.proposed, 5);
  assert.equal(result.ballots, 5);
  assert.equal(result.ranking[0].candidateId, 'option_2');
  assert.equal(result.ranking.at(-1).candidateId, 'option_1');
  assert.ok(m.peak <= 2, `Exceeded host+operator adviser capacity: ${m.peak}`);
  assert.equal(m.traces.length, 10, 'Five distinct proposing and five separate critiquing model loops');
  assert.ok(m.traces.every((t) => t.messages.length === 2));
  assert.equal(new Set(events.filter((e) => e.type === 'agent_spawned').map((e) => e.childAgentId)).size, 10);
  assert.equal(lead.children.size, 0);
  const records = readNativeCouncil(lead, { councilId: result.councilId, offset: 4, limit: 1 });
  assert.equal(records.members[0].candidateId, 'option_5');
  assert.equal(records.nextOffset, null);
  assert.equal(records.reviews.length, 1);
  assert.throws(() => readNativeCouncil(lead, { councilId: result.councilId, limit: 6 }), (e) => e.code === 'NATIVE_COUNCIL_PAGE_INVALID');
  assert.throws(() => selectNativeCouncilOption(lead, { councilId: result.councilId, candidateId: 'invented', rationale: 'A long enough rationale indeed' }), (e) => e.code === 'NATIVE_COUNCIL_OPTION_INVALID');
  const chosen = selectNativeCouncilOption(lead, { councilId: result.councilId, candidateId: 'option_2', rationale: 'Fewer changes and lower integration risk after independent critique', evidence: ['tests/native-agent-council.test.mjs'] });
  assert.equal(chosen.selection.candidateId, 'option_2');
  assert.equal(lead.getCouncilSummaries()[0].selection.candidateId, 'option_2');
  assert.throws(() => selectNativeCouncilOption(lead, { councilId: result.councilId, candidateId: 'option_1', rationale: 'Changing the vote after the fact' }), (e) => e.code === 'NATIVE_COUNCIL_ALREADY_SELECTED');
  assert.ok(lead.getCouncilSummaries()[0].ranking[0].endorsements > 0);
});

test('Council does not invent review wins when critics disagree with schema, nor treat votes as authority', async () => {
  const m = councilModel({ reviewMode: 'unstructured' });
  const lead = createNativeAgent({ model: m.model, advisorCapacity: 2 });
  const result = await conveneNativeCouncil(lead, {
    question: 'Competing migration plans', perspectives: [perspective(1), perspective(2)]
  });
  assert.equal(result.ballots, 0);
  assert.deepEqual(result.ranking.map((item) => item.netEndorsements), [0, 0]);
  assert.equal(lead.getCouncilSummaries()[0].selection, null);
  assert.equal(lead.councils.get(result.councilId).reviews[0].status, 'unstructured-review');
});

test('Lead invokes council, sees evidence, and explicitly selects a proposal through independent tool calls', async () => {
  const m = councilModel();
  let leadTurns = 0;
  const events = [];
  const lead = createNativeAgent({ advisorCapacity: 2, onEvent: (e) => events.push(e),
    model: { async complete(request) {
      if (request.messages[0].content.includes('read-only adviser')) return m.model.complete(request);
      leadTurns++;
      const tools = request.tools.map((t) => t.name);
      assert.ok(['convene_council', 'read_council', 'select_council_option'].every((name) => tools.includes(name)));
      if (leadTurns === 1) return { toolCalls: [{ id: 'council', name: 'convene_council', arguments: {
        question: 'Pick architecture based on evidence', perspectives: [perspective(1), perspective(2)]
      } }] };
      const councilId = JSON.parse(request.messages.find((m) => m.role === 'tool').content).councilId;
      if (leadTurns === 2) return { toolCalls: [{ id: 'read', name: 'read_council', arguments: { councilId } }] };
      if (leadTurns === 3) return { toolCalls: [{ id: 'choose', name: 'select_council_option', arguments: {
        councilId, candidateId: 'option_2', rationale: 'Independent review picked least risky option for verified scope'
      } }] };
      return { content: 'Primary made a choice but must still validate implementation', toolCalls: [] };
    } }
  });
  const result = await lead.prompt('Choose strategy');
  assert.equal(result.turns, 4);
  assert.equal(lead.getCouncilSummaries()[0].selection.candidateId, 'option_2');
  assert.equal(events.filter((event) => event.type === 'council_option_selected').length, 1);
  assert.ok(result.usage.modelCalls >= 4);
  assert.ok(result.usage.toolCalls >= 3);
});

test('Advisor and council are denied when capacity is zero, even if the model asks', async () => {
  const lead = createNativeAgent({ model: { complete: async () => ({ content: 'ok' }) }, advisorCapacity: 0 });
  await assert.rejects(conveneNativeCouncil(lead, { question: 'Review', perspectives: [perspective(1), perspective(2)] }), (e) => e.code === 'NATIVE_AGENT_HOST_CAPACITY');
});

test('Cancelled council does not falsely return a valid decision or leak active children', async () => {
  const aborter = new AbortController();
  const lead = createNativeAgent({ signal: aborter.signal, advisorCapacity: 1,
    model: { async complete() {
      aborter.abort();
      await delay(2);
      return { content: 'Should not be accepted', toolCalls: [] };
    } }
  });
  await assert.rejects(conveneNativeCouncil(lead, { question: 'Cancel during review', perspectives: [perspective(1), perspective(2)] }), (e) => e.code === 'NATIVE_AGENT_CANCELLED');
  assert.equal(lead.children.size, 0);
  assert.equal(lead.getCouncilSummaries().length, 0);
});

test('Council can recruit 24 independent perspectives without a fixed 2/4-agent roster, scheduling in waves', async () => {
  let inFlight = 0;
  let maximum = 0;
  const lead = createNativeAgent({ advisorCapacity: 3, model: {
    async complete({ messages }) {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      try {
        await delay(1);
        const id = messages.at(-1).content.match(/Your candidate identifier: (option_\d+)/)?.[1];
        return { content: `Independent proposal for ${id}`, toolCalls: [] };
      } finally { inFlight--; }
    }
  } });
  const result = await conveneNativeCouncil(lead, { question: 'Large infrastructure migration tradeoff analysis',
    perspectives: Array.from({ length: 24 }, (_, i) => perspective(i)), crossExamine: false });
  assert.equal(result.proposed, 24);
  assert.equal(result.ballots, 0);
  assert.equal(result.ranking.length, 24);
  assert.ok(maximum <= 3, `Exceeded configured advisory parallelism: ${maximum}`);
  assert.equal(readNativeCouncil(lead, { councilId: result.councilId, offset: 20, limit: 5 }).members.length, 4);
  assert.equal(lead.children.size, 0);
});

test('Council isolates one failing adviser, counts only real completed candidates, and exposes the failed lifecycle', async () => {
  const events = [];
  const lead = createNativeAgent({ advisorCapacity: 2, onEvent: (e) => events.push(e), model: {
    async complete({ messages }) {
      const question = messages.at(-1).content;
      if (question.includes('Your candidate identifier: option_1')) throw Object.assign(new Error('model unavailable'), { code: 'MODEL_UNAVAILABLE' });
      if (question.includes('Competing independent proposals')) {
        return { content: JSON.stringify({ strongest: 'option_3', weakest: 'option_2', reason: 'The final candidate has the most tractable test approach' }) };
      }
      const id = question.match(/Your candidate identifier: (option_\d+)/)?.[1];
      return { content: `Real proposal ${id}`, toolCalls: [] };
    }
  } });
  const result = await conveneNativeCouncil(lead, { question: 'Compare three deployment safety approaches',
    perspectives: [perspective(1), perspective(2), perspective(3)] });
  assert.equal(result.proposed, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.ballots, 2);
  assert.equal(result.ranking[0].candidateId, 'option_3');
  assert.equal(events.filter((event) => event.type === 'agent_failed').length, 1);
  assert.equal(lead.children.size, 0);
  const all = readNativeCouncil(lead, { councilId: result.councilId });
  assert.equal(all.members[0].status, 'unavailable');
  assert.equal(all.members[0].failureCode, 'MODEL_UNAVAILABLE');
});
