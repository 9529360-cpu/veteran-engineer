/** Veteran-native Mission planner using the same independent Agent loop as workers. */
import { createNativeAgent } from './native-agent-kernel.mjs';
import { createOpenAICompatibleModel } from './native-agent-model.mjs';
import { createScopedRepositoryTools } from './native-agent-tools.mjs';

function plannerError(code, message) { return Object.assign(new Error(message), { code }); }

/**
 * Create a real, model-driven Mission task DAG proposal. The MissionService
 * still validates schema, dependencies, path conflicts and source identity
 * before anything can execute. Proposal is not execution authorization.
 */
export async function planNativeMission({ project, mission, continuity, projectExperience = [], repoPath, missionId, onEvent = null } = {}) {
  const opts = project.workerPolicy?.nativeAgent;
  if (!project.workerPolicy?.enabled || !opts) throw plannerError('NATIVE_PLANNER_DISABLED', 'Native Agent planning requires explicitly enabled worker policy and configured model');
  const model = createOpenAICompatibleModel({
    baseURL: opts.baseURL,
    model: opts.model,
    apiKey: opts.apiKeyEnv ? process.env[opts.apiKeyEnv] || null : null,
    timeoutMs: opts.modelTimeoutMs ?? 120_000
  });
  const allTools = await createScopedRepositoryTools({ worktreePath: repoPath, writeSet: [] });
  const proposals = [];
  const submitPlan = {
    name: 'submit_plan',
    description: 'Submit a concrete, dependency-aware engineering task DAG. Tasks must identify contract, owner and authorized predicted writeSet. Do not start execution.',
    readOnly: false,
    parameters: { type: 'object', properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 64, items: {
        type: 'object', properties: {
          id: { type: 'string' }, contract: { type: 'string' }, owner: { type: 'string' },
          writeSet: { type: 'array', items: { type: 'string' } },
          dependencies: { type: 'array', items: { type: 'string' } },
          risk: { type: 'string' }, worker: { type: 'string' }, protectedPaths: { type: 'array', items: { type: 'string' } }
        }, required: ['id', 'contract', 'owner', 'writeSet', 'dependencies'] }
      },
      rationale: { type: 'string' }
    }, required: ['tasks'] },
    async execute({ tasks, rationale = '' }) {
      if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 64) {
        throw plannerError('NATIVE_PLANNER_TASK_LIMIT', 'Native plan must contain 1-64 tasks');
      }
      // The canonical schema and source/write-conflict checks happen inside
      // MissionService after this untrusted planning proposal returns.
      proposals.push({ tasks, rationale: String(rationale).slice(0, 1500) });
      return { acceptedForValidation: true, count: tasks.length };
    }
  };
  const native = createNativeAgent({
    model,
    tools: [...allTools.filter((tool) => tool.readOnly), submitPlan],
    agentId: `lead:${missionId}:planner`,
    parentAgentId: `lead:${missionId}`,
    role: 'planner',
    maxTurns: opts.plannerMaxTurns ?? 20,
    advisorCapacity: opts.advisorCapacity ?? null,
    onEvent,
    systemPrompt: [
      'You are the Veteran primary engineering planning Agent. Use repository evidence before assigning tasks.',
      'Own the entire end-to-end outcome. Propose the smallest complete, executable and reviewable work graph.',
      'Decide dynamically whether the task warrants one worker or many independent subordinate Agent workstreams.',
      'Avoid ceremonial roles or inflated teams. Partition by actual writable repository ownership and dependencies.',
      'Use spawn_advisor when independent brainstorming, architectural criticism or risk challenge would improve the plan.',
      'You may explore ideas freely, but only submit_plan is a valid plan. Never write files or execute production actions during planning.',
      'No preset maximum team of two or four; task DAG and runtime capacity control concurrency.',
      'The MissionService will reject unsafe, cyclic or out-of-scope proposals.'
    ].join('\n')
  });
  await native.prompt([
    `Goal: ${mission.goal}`,
    `Done definition: ${mission.doneDefinition}`,
    `Non-goals: ${JSON.stringify(mission.nonGoals || [])}`,
    `Risk envelope: ${mission.riskEnvelope}`,
    `Active project continuity: ${JSON.stringify(continuity).slice(0, 5_000)}`,
    `Prior evidence: ${JSON.stringify(projectExperience).slice(0, 6_000)}`,
    'Inspect repository structure as needed, then use submit_plan with concrete actionable independent tasks and accurate dependencies.',
    'Do not fragment trivial fixes, do not assign overlapping writeSets to parallel tasks, and do not declare unsupported runtime capabilities.'
  ].join('\n'));
  const proposal = proposals.at(-1);
  if (!proposal) throw plannerError('NATIVE_PLANNER_NO_PROPOSAL', 'Native planning Agent did not submit an executable task graph');
  return proposal;
}
