const REQUEST_ID_TOOL_NAMES = Object.freeze([
  'project_open', 'project_snapshot', 'mission_plan', 'mission_execute', 'mission_advance',
  'mission_cancel', 'mission_resume', 'task_result_commit', 'worker_cancel', 'worker_resume',
  'worker_retry', 'validation_run', 'review_run', 'semantic_review_run', 'remediation_plan',
  'candidate_refresh', 'experience_commit', 'experience_review', 'experience_challenge',
  'experience_compact', 'runtime_cleanup', 'runtime_maintenance', 'handoff_export'
]);

const REQUEST_ID_TOOL_SET = new Set(REQUEST_ID_TOOL_NAMES);

export const TOOL_DEFINITIONS = Object.freeze([
  ['project_open', 'Open a local Git project or safely acquire an authorized remote repository and capture exact source identity.'],
  ['project_snapshot', 'Refresh repository identity, dirty state, and project signals.'],
  ['mission_plan', 'Create a dependency-aware mission plan with quality and write-conflict gates.'],
  ['mission_execute', 'Dispatch or execute ready worker waves inside isolated worktrees.'],
  ['mission_status', 'Read current mission, task, validation, review, candidate, and merge-proposal status.'],
  ['mission_advance', 'Advance the mission state machine through execution, proof gates, immutable candidate creation, and operator-only merge proposal finalization.'],
  ['mission_readiness', 'Explain whether a mission is safe and ready for its next transition or requires operator merge action.'],
  ['mission_timeline', 'Return the durable mission event timeline.'],
  ['mission_cancel', 'Cancel a mission without mutating the user branch.'],
  ['mission_resume', 'Resume an interrupted mission after conservative reconciliation.'],
  ['task_result_commit', 'Commit an externally produced task result after scope and ownership checks.'],
  ['worker_cancel', 'Request cancellation of an executing worker.'],
  ['worker_resume', 'Resume an interrupted worker task after reconciliation.'],
  ['worker_retry', 'Retry a failed worker task with a new dispatch identity.'],
  ['evidence_query', 'Query bounded evidence records and artifact pointers.'],
  ['validation_capabilities', 'List operator-defined repository validation capabilities.'],
  ['validation_run', 'Run an allowed command or service-backed product validation in an isolated detached worktree.'],
  ['review_run', 'Run deterministic whole-change review against the mission base.'],
  ['semantic_review_run', 'Run the configured independent semantic reviewer provider.'],
  ['remediation_plan', 'Create a bounded remediation plan from review findings.'],
  ['candidate_preflight', 'Read-only preflight the mission candidate against current source using merge-tree.'],
  ['candidate_refresh', 'Create a new immutable candidate after source drift and invalidate stale proof.'],
  ['candidate_status', 'Read immutable candidate identity and proof freshness.'],
  ['experience_query', 'Retrieve reviewed active project experience without allowing candidates to influence execution.'],
  ['experience_commit', 'Persist a candidate experience backed by evidence.'],
  ['experience_review', 'Activate, reject, reactivate, or retire an experience after review.'],
  ['experience_challenge', 'Challenge an active experience with contrary evidence.'],
  ['experience_audit', 'Audit experience freshness, conflicts, evidence, and lifecycle state.'],
  ['experience_compact', 'Compact exact duplicate candidate experiences without auto-activation.'],
  ['runtime_health', 'Report runtime, state, MCP transport mode, and protocol capability.'],
  ['runtime_integrity', 'Verify audit hash chain, state readability, and runtime invariants.'],
  ['runtime_cleanup', 'Inspect or remove orphaned runtime-owned temporary resources.'],
  ['runtime_maintenance', 'Run conservative reconciliation and maintenance tasks.'],
  ['handoff_export', 'Export a compact resumable project/mission handoff bundle.']
].map(([name, description]) => ({ name, description })));

export const TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((item) => item.name));
export { REQUEST_ID_TOOL_NAMES };

export function toolRequiresRequestId(name) {
  return REQUEST_ID_TOOL_SET.has(name);
}

export function toolInputJsonSchema(name) {
  if (!toolRequiresRequestId(name)) return { type: 'object', additionalProperties: true };
  return {
    type: 'object',
    properties: {
      requestId: { type: 'string', minLength: 1, description: 'Stable idempotency key for this mutating operation.' }
    },
    required: ['requestId'],
    additionalProperties: true
  };
}

if (TOOL_NAMES.length !== 34) {
  throw new Error(`Veteran Engineer MCP surface must contain exactly 34 tools, got ${TOOL_NAMES.length}`);
}
for (const name of REQUEST_ID_TOOL_NAMES) {
  if (!TOOL_NAMES.includes(name)) throw new Error(`Unknown requestId-requiring tool in catalog: ${name}`);
}
