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

if (TOOL_NAMES.length !== 34) {
  throw new Error(`Veteran Engineer MCP surface must contain exactly 34 tools, got ${TOOL_NAMES.length}`);
}
