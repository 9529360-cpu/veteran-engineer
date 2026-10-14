#!/usr/bin/env node
/** Real isolated task process using Veteran's forked, provider-neutral Agent loop. */
import fs from 'node:fs/promises';
import { createOpenAICompatibleModel } from '../src/native-agent-model.mjs';
import { createScopedRepositoryTools } from '../src/native-agent-tools.mjs';
import { createNativeAgent } from '../src/native-agent-kernel.mjs';

const aborter = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => aborter.abort());

async function main() {
  const packetPath = process.env.VETERAN_TASK_PACKET;
  const worktreePath = process.env.VETERAN_WORKTREE;
  if (!packetPath || !worktreePath) throw Object.assign(new Error('Runtime task packet and worktree are required'), { code: 'NATIVE_WORKER_RUNTIME_REQUIRED' });
  const stat = await fs.stat(packetPath);
  if (stat.size > 250_000) throw Object.assign(new Error('Task packet exceeds policy limit'), { code: 'NATIVE_WORKER_PACKET_LIMIT' });
  const packet = JSON.parse(await fs.readFile(packetPath, 'utf8'));
  if (packet.protocol !== 'veteran-worker-v1' || !packet.task?.id || !Array.isArray(packet.task.writeSet)) {
    throw Object.assign(new Error('Unrecognized or invalid Veteran task packet'), { code: 'NATIVE_WORKER_PACKET_INVALID' });
  }
  if (packet.task.id !== process.env.VETERAN_TASK_ID || packet.mission?.id !== process.env.VETERAN_MISSION_ID) {
    throw Object.assign(new Error('Runtime worker identity does not match task packet'), { code: 'NATIVE_WORKER_IDENTITY_INVALID' });
  }
  const model = createOpenAICompatibleModel({
    baseURL: process.env.VETERAN_NATIVE_BASE_URL,
    model: process.env.VETERAN_NATIVE_MODEL,
    apiKey: process.env[process.env.VETERAN_NATIVE_API_KEY_ENV || 'VETERAN_NATIVE_API_KEY'] || null
  });
  const tools = await createScopedRepositoryTools({
    worktreePath, writeSet: packet.task.writeSet, protectedPaths: packet.task.protectedPaths || []
  });
  const maxTurns = Number(process.env.VETERAN_NATIVE_MAX_TURNS || '32');
  const advisorCapacity = process.env.VETERAN_NATIVE_ADVISOR_CAPACITY === undefined
    ? null : Number(process.env.VETERAN_NATIVE_ADVISOR_CAPACITY);
  const agent = createNativeAgent({
    model, tools, signal: aborter.signal, maxTurns, advisorCapacity,
    agentId: packet.agentHierarchy?.selfAgentId || `agent:${packet.mission.id}:${packet.task.id}`,
    parentAgentId: packet.agentHierarchy?.primaryAgentId || `lead:${packet.mission.id}`,
    systemPrompt: [
      'You are an independent subordinate Veteran engineering Agent running inside a runtime-owned Git worktree.',
      'Decide your own steps, read source evidence and use tools iteratively until the assigned outcome is complete.',
      'You may independently ask read-only advisory Agents to brainstorm, critique or inspect alternatives.',
      'Only the declared task writeSet may be changed. Tool write guards enforce the scope; never attempt to bypass them.',
      'The main Agent retains exclusive mission planning, integration, release and final acceptance authority.',
      'Do not commit, merge, push, deploy, publish, modify Git HEAD, inspect private credentials, or expand task authority.',
      'If the task cannot safely be completed, state the blocker rather than claiming success.',
      'Keep implementation focused and practical, but choose your own investigative strategy and tool sequence.'
    ].join('\n')
  });
  const mission = packet.mission;
  const task = packet.task;
  const instruction = [
    `Mission: ${mission.goal}`,
    `Done definition: ${mission.doneDefinition}`,
    `Task: ${task.contract}`,
    `Task owner: ${task.owner}`,
    `Write scope: ${JSON.stringify(task.writeSet)}`,
    `Protected paths: ${JSON.stringify(task.protectedPaths || [])}`,
    `Stop conditions: ${JSON.stringify(packet.stopConditions || [])}`,
    'Complete the assigned task and report exact changes, evidence, outstanding risks and limitations.'
  ].join('\n');
  const result = await agent.prompt(instruction);
  process.stdout.write(JSON.stringify({
    contract: 'veteran-native-agent-result-v1',
    agentId: agent.agentId,
    parentAgentId: agent.parentAgentId,
    status: result.status,
    turns: result.turns,
    summary: result.text.slice(0, 8_000)
  }) + '\n');
}

main().catch((error) => {
  // This worker's stderr is captured into task proof; do not print request
  // URLs, authentication data, complete model responses or stack traces.
  process.stderr.write(JSON.stringify({ error: error?.code || 'NATIVE_WORKER_FAILED', message: String(error?.message || 'Native Agent failed').slice(0, 300) }) + '\n');
  process.exitCode = 1;
});
