/**
 * Veteran's model-agnostic Agent kernel, adapted from the architecture of
 * CodeAny Open Agent SDK QueryEngine + AgentTool (MIT, copyright 2025 CodeAny).
 * Upstream: https://github.com/codeany-ai/open-agent-sdk-typescript
 * Source reference: a9ade5fdaefb0fb5cffdddeed93b3bc81feb7734
 * Full license: ./native-agent-LICENSE.txt
 *
 * This is a bounded, dependency-free JavaScript adaptation for Veteran's
 * existing task-authority and process-supervisor boundary. In particular, it
 * deliberately does NOT inherit upstream bypassPermissions or Bash defaults.
 */
import { randomUUID } from 'node:crypto';
import { inspectHostWorkerCapacity } from './host-worker-capacity.mjs';
import { conveneNativeCouncil, readNativeCouncil, selectNativeCouncilOption, nativeCouncilSummaries } from './native-agent-council.mjs';

const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_TOOL_CALLS_PER_TURN = 64;
const MAX_HISTORY_MESSAGES = 150;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) throw fail('NATIVE_AGENT_TOOLS_INVALID', 'Agent tools must be an array');
  const names = new Set();
  return tools.map((tool) => {
    if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z][\w-]{0,79}$/.test(tool.name)
        || typeof tool.execute !== 'function' || names.has(tool.name)) {
      throw fail('NATIVE_AGENT_TOOLS_INVALID', 'Agent tool names must be distinct and executable');
    }
    names.add(tool.name);
    return { ...tool, parameters: tool.parameters || { type: 'object', properties: {} }, readOnly: tool.readOnly === true };
  });
}

function safeResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? text.slice(0, MAX_TOOL_RESULT_CHARS) + '\n[tool result truncated]'
    : text;
}

function activeModelMessage(message) {
  if (!message || typeof message !== 'object') throw fail('NATIVE_AGENT_MODEL_INVALID', 'Model returned no response');
  const content = typeof message.content === 'string' ? message.content : '';
  const calls = message.toolCalls ?? [];
  if (!Array.isArray(calls) || calls.length > MAX_TOOL_CALLS_PER_TURN) {
    throw fail('NATIVE_AGENT_TOOL_LIMIT', 'Invalid number of tool requests in a model response');
  }
  const toolCalls = calls.map((c, i) => {
    if (!c || typeof c.name !== 'string') throw fail('NATIVE_AGENT_MODEL_INVALID', 'Model returned an invalid tool');
    let args = c.arguments ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { throw fail('NATIVE_AGENT_TOOL_ARGS_INVALID', `Malformed tool arguments for ${c.name}`); }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('NATIVE_AGENT_TOOL_ARGS_INVALID', `Invalid tool arguments for ${c.name}`);
    return { id: String(c.id || `call_${i}_${randomUUID()}`), name: c.name, arguments: args };
  });
  return { content, toolCalls };
}

/**
 * Each instance has its own model conversation, tool set, cancellation signal,
 * and lifecycle. Sharing the provider does not share messages or authority.
 * Subagents are actual independent model loops, not prompt role-play.
 */
export class NativeAgent {
  constructor({ model, tools = [], systemPrompt = '', agentId = randomUUID(), parentAgentId = null,
    role = 'engineer', maxTurns = 32, signal = null, onEvent = null,
    allowAdvisors = true, advisorCapacity = null } = {}) {
    if (typeof model?.complete !== 'function') throw fail('NATIVE_AGENT_MODEL_MISSING', 'A real model provider is required');
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 256) throw fail('NATIVE_AGENT_TURNS_INVALID', 'maxTurns must be 1 through 256');
    this.model = model;
    this.tools = normalizeTools(tools);
    this.systemPrompt = String(systemPrompt);
    this.agentId = agentId;
    this.parentAgentId = parentAgentId;
    this.role = role;
    this.maxTurns = maxTurns;
    this.signal = signal;
    this.onEvent = onEvent;
    this.allowAdvisors = allowAdvisors === true;
    this.advisorCapacity = advisorCapacity;
    this.history = [];
    this.children = new Map();
    this.councils = new Map();
    this.usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, meteredResponses: 0, toolCalls: 0, toolFailures: 0 };
    this.running = false;
  }

  emit(type, details = {}) {
    this.onEvent?.({ type, agentId: this.agentId, parentAgentId: this.parentAgentId, ...details });
  }

  checkAborted() {
    if (this.signal?.aborted) throw fail('NATIVE_AGENT_CANCELLED', 'Agent was cancelled');
  }

  advisorSlots() {
    const host = inspectHostWorkerCapacity({ workerMemoryMiB: 128 });
    const measuredCapacity = Math.max(0, Math.min(host.effectiveCpuSlots, host.estimatedMemorySlots));
    const capacity = Number.isInteger(this.advisorCapacity) && this.advisorCapacity >= 0
      ? Math.min(this.advisorCapacity, measuredCapacity) : measuredCapacity;
    return Math.max(0, capacity - this.children.size);
  }

  getCouncilSummaries() { return nativeCouncilSummaries(this); }

  /** A child may reason broadly but never receives mutation tools or delegation authority. */
  async spawnAdvisor({ question, perspective = '', maxTurns = 8 } = {}) {
    if (!this.allowAdvisors) throw fail('NATIVE_AGENT_DELEGATION_FORBIDDEN', 'Nested Agent delegation is disabled');
    if (typeof question !== 'string' || !question.trim() || question.length > 12_000) {
      throw fail('NATIVE_AGENT_ADVISOR_INVALID', 'Advisory question must be non-empty and bounded');
    }
    if (typeof perspective !== 'string' || perspective.length > 1200) {
      throw fail('NATIVE_AGENT_ADVISOR_INVALID', 'Advisory perspective must be a short string');
    }
    if (this.advisorSlots() < 1) throw fail('NATIVE_AGENT_HOST_CAPACITY', 'No safe host capacity for another advisory Agent');
    const child = new NativeAgent({
      model: this.model,
      tools: this.tools.filter((tool) => tool.readOnly),
      systemPrompt: [
        'You are an independent, read-only adviser to the Veteran primary Agent.',
        'Explore useful alternatives, counterexamples, design trade-offs and failure modes freely.',
        'Use evidence when available. You may challenge the primary proposal.',
        'Do not claim project authority, make repository changes, delegate, or approve production actions.',
        perspective ? `Requested perspective: ${perspective}` : ''
      ].filter(Boolean).join('\n'),
      agentId: randomUUID(),
      parentAgentId: this.agentId,
      role: 'advisor',
      maxTurns: Number.isInteger(maxTurns) ? Math.min(Math.max(maxTurns, 1), 24) : 8,
      signal: this.signal,
      onEvent: this.onEvent,
      allowAdvisors: false
    });
    this.children.set(child.agentId, child);
    this.emit('agent_spawned', { childAgentId: child.agentId, role: 'advisor' });
    try {
      const result = await child.prompt(question);
      this.emit('agent_completed', { childAgentId: child.agentId, turns: result.turns });
      return { agentId: child.agentId, parentAgentId: this.agentId, role: 'advisor', ...result };
    } catch (error) {
      this.emit('agent_failed', { childAgentId: child.agentId, role: 'advisor', code: error?.code || 'NATIVE_AGENT_FAILED' });
      throw error;
    } finally {
      this.children.delete(child.agentId);
    }
  }

  #availableTools() {
    const list = [...this.tools];
    if (this.allowAdvisors) list.push({
      name: 'spawn_advisor',
      description: 'Create an independent read-only Agent to challenge assumptions, brainstorm alternatives or independently assess evidence. It cannot edit files or spawn further agents.',
      readOnly: true,
      parameters: { type: 'object', additionalProperties: false, properties: {
        question: { type: 'string' }, perspective: { type: 'string' }
      }, required: ['question'] },
      execute: (args) => this.spawnAdvisor(args)
    });
    if (this.allowAdvisors) list.push(
      {
        name: 'convene_council',
        description: 'Optional substantive design competition: independent advisers develop diverse proposals, then independent critics cross-examine evidence. You decide perspectives/count by problem; no preset roster. Primary retains selection authority.',
        readOnly: false,
        parameters: { type: 'object', additionalProperties: false, properties: {
          question: { type: 'string' },
          perspectives: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'string' } },
          crossExamine: { type: 'boolean' }, maxTurns: { type: 'integer' }
        }, required: ['question', 'perspectives'] },
        execute: (args) => conveneNativeCouncil(this, args)
      },
      {
        name: 'read_council',
        description: 'Inspect paginated independent proposals and red-team critiques before deciding.',
        readOnly: true,
        parameters: { type: 'object', properties: {
          councilId: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' }
        }, required: ['councilId'] },
        execute: (args) => readNativeCouncil(this, args)
      },
      {
        name: 'select_council_option',
        description: 'Record the primary Agent choice with explicit rationale and evidence. Voting is advisory only; selection does not authorize any execution.',
        readOnly: false,
        parameters: { type: 'object', properties: {
          councilId: { type: 'string' }, candidateId: { type: 'string' }, rationale: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } }
        }, required: ['councilId', 'candidateId', 'rationale'] },
        execute: (args) => selectNativeCouncilOption(this, args)
      }
    );
    return list;
  }

  async #executeCall(call, tools) {
    this.checkAborted();
    const tool = tools.find((entry) => entry.name === call.name);
    if (!tool) return { role: 'tool', tool_call_id: call.id, content: 'Tool unavailable or denied: ' + call.name };
    this.usage.toolCalls++;
    this.emit('tool_requested', { tool: call.name });
    try {
      const value = await tool.execute(call.arguments, { agentId: this.agentId, signal: this.signal, role: this.role });
      this.emit('tool_finished', { tool: call.name, ok: true });
      return { role: 'tool', tool_call_id: call.id, content: safeResult(value) };
    } catch (error) {
      this.usage.toolFailures++;
      this.emit('tool_finished', { tool: call.name, ok: false, code: error?.code || 'TOOL_ERROR' });
      if (this.signal?.aborted) this.checkAborted();
      // Give the model bounded actionable failure feedback, never a raw stack or secret-bearing object.
      return { role: 'tool', tool_call_id: call.id, content: safeResult({ error: error?.code || 'TOOL_ERROR', message: String(error?.message || 'Tool failed').slice(0, 500) }) };
    }
  }

  async prompt(input) {
    if (this.running) throw fail('NATIVE_AGENT_ALREADY_RUNNING', 'An Agent cannot have two simultaneous root prompts');
    if (typeof input !== 'string' || !input.trim()) throw fail('NATIVE_AGENT_PROMPT_INVALID', 'Agent prompt must be non-empty');
    this.running = true;
    const tools = this.#availableTools();
    try {
      this.history.push({ role: 'user', content: input });
      let text = '';
      for (let turn = 1; turn <= this.maxTurns; turn++) {
        this.checkAborted();
        const request = {
          messages: [{ role: 'system', content: this.systemPrompt }, ...this.history],
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description || '', parameters: tool.parameters })),
          signal: this.signal
        };
        const response = await this.model.complete(request);
        this.usage.modelCalls++;
        const rawUsage = response?.usage || null;
        if (rawUsage && typeof rawUsage === 'object') {
          const input = rawUsage.prompt_tokens ?? rawUsage.input_tokens;
          const output = rawUsage.completion_tokens ?? rawUsage.output_tokens;
          if (Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(output) && output >= 0) {
            this.usage.meteredResponses++;
            this.usage.inputTokens += input;
            this.usage.outputTokens += output;
          }
        }
        const decision = activeModelMessage(response);
        text = decision.content;
        const assistant = { role: 'assistant', content: text };
        if (decision.toolCalls.length) {
          assistant.tool_calls = decision.toolCalls.map((call) => ({
            id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) }
          }));
        }
        this.history.push(assistant);
        this.emit('agent_turn', { turn, toolsRequested: decision.toolCalls.length });
        if (!decision.toolCalls.length) {
          this.emit('agent_finished', { turns: turn });
          return { text, turns: turn, status: 'completed', usage: { ...this.usage } };
        }
        // Read-only operations and independent advisory loops can run concurrently;
        // mutating tools execute in order, never simultaneously in one Agent.
        const results = new Array(decision.toolCalls.length);
        let pendingReads = [];
        const flushReads = async () => {
          await Promise.all(pendingReads.map(async ([i, call]) => { results[i] = await this.#executeCall(call, tools); }));
          pendingReads = [];
        };
        for (const [i, call] of decision.toolCalls.entries()) {
          const tool = tools.find((entry) => entry.name === call.name);
          if (tool?.readOnly) {
            pendingReads.push([i, call]);
          } else {
            await flushReads();
            results[i] = await this.#executeCall(call, tools);
          }
        }
        await flushReads();
        this.history.push(...results);
        // Truncate only from a conversation round boundary to avoid orphaned
        // tool_results and inconsistent tool_call IDs for OpenAI-style models.
        if (this.history.length > MAX_HISTORY_MESSAGES) {
          let start = this.history.length - MAX_HISTORY_MESSAGES;
          while (start < this.history.length && this.history[start].role !== 'user') start++;
          if (start > 0 && start < this.history.length) this.history.splice(0, start);
        }
      }
      throw fail('NATIVE_AGENT_TURN_LIMIT', `Agent did not finish within ${this.maxTurns} turns`);
    } finally {
      this.running = false;
    }
  }
}

export function createNativeAgent(options) { return new NativeAgent(options); }
