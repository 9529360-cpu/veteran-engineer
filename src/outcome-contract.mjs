const MAX_ACCEPTANCE_CRITERIA = 64;

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function contractError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function normalizeAcceptanceCriteria(raw = []) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw contractError('MISSION_ACCEPTANCE_CRITERIA_INVALID', 'acceptanceCriteria must be an array');
  }
  if (raw.length > MAX_ACCEPTANCE_CRITERIA) {
    throw contractError('MISSION_ACCEPTANCE_CRITERIA_TOO_LARGE', `acceptanceCriteria exceeds the ${MAX_ACCEPTANCE_CRITERIA}-item safety bound`);
  }
  const seen = new Set();
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw contractError('MISSION_ACCEPTANCE_CRITERION_INVALID', `acceptanceCriteria[${index}] must be an object`);
    }
    const id = String(item.id || '').trim();
    const statement = String(item.statement || '').trim();
    const acceptance = String(item.acceptance || '').trim();
    if (!id || !statement || !acceptance) {
      throw contractError(
        'MISSION_ACCEPTANCE_CRITERION_INVALID',
        `acceptanceCriteria[${index}] requires non-empty id, statement, and acceptance`,
        { index, id: id || null }
      );
    }
    if (seen.has(id)) {
      throw contractError('MISSION_ACCEPTANCE_CRITERION_DUPLICATE', `Duplicate acceptance criterion id: ${id}`, { id });
    }
    seen.add(id);
    const dimension = nonempty(item.dimension) ? item.dimension.trim() : null;
    const validationBoundary = nonempty(item.validationBoundary) ? item.validationBoundary.trim() : null;
    return { id, statement, acceptance, dimension, validationBoundary };
  });
}

export function normalizeRequirementIds(raw, taskId) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw contractError('TASK_REQUIREMENT_IDS_INVALID', `Task ${taskId} requirementIds must be an array`, { taskId });
  }
  const normalized = raw.map((value) => String(value || '').trim());
  if (normalized.some((value) => !value)) {
    throw contractError('TASK_REQUIREMENT_IDS_INVALID', `Task ${taskId} requirementIds must contain only non-empty strings`, { taskId });
  }
  return [...new Set(normalized)];
}

export function assertAcceptanceCoverage(criteria, tasks) {
  const accepted = new Set(criteria.map((criterion) => criterion.id));
  const coverage = new Map(criteria.map((criterion) => [criterion.id, []]));
  for (const task of tasks) {
    for (const requirementId of task.requirementIds || []) {
      if (!accepted.has(requirementId)) {
        throw contractError(
          'MISSION_ACCEPTANCE_REQUIREMENT_UNKNOWN',
          `Task ${task.id} references unknown acceptance criterion ${requirementId}`,
          { taskId: task.id, requirementId }
        );
      }
      coverage.get(requirementId).push(task.id);
    }
  }
  if (!criteria.length) {
    const dangling = tasks.filter((task) => (task.requirementIds || []).length).map((task) => task.id);
    if (dangling.length) {
      throw contractError(
        'MISSION_ACCEPTANCE_CRITERIA_REQUIRED',
        'Tasks declare requirementIds but the Mission has no acceptanceCriteria',
        { taskIds: dangling }
      );
    }
    return [];
  }
  const missing = criteria.filter((criterion) => coverage.get(criterion.id).length === 0).map((criterion) => criterion.id);
  if (missing.length) {
    throw contractError(
      'MISSION_ACCEPTANCE_UNCOVERED',
      `Mission acceptance criteria are not covered by tasks: ${missing.join(', ')}`,
      { missingRequirementIds: missing }
    );
  }
  return criteria.map((criterion) => ({
    requirementId: criterion.id,
    taskIds: [...coverage.get(criterion.id)]
  }));
}

export function evaluateRequirementReview(criteria, rawResults) {
  if (!criteria.length) return { passed: true, results: [], findings: [] };
  const findings = [];
  const rows = Array.isArray(rawResults) ? rawResults : [];
  if (!Array.isArray(rawResults)) {
    findings.push({ severity: 'high', code: 'ACCEPTANCE_RESULTS_REQUIRED', message: 'Semantic reviewer must return requirementResults for structured Mission acceptance criteria.' });
  }
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = String(row.id || '').trim();
    if (!id) continue;
    if (byId.has(id)) {
      findings.push({ severity: 'high', code: 'ACCEPTANCE_RESULT_DUPLICATE', requirementId: id, message: `Duplicate semantic-review result for ${id}.` });
      continue;
    }
    byId.set(id, row);
  }
  const known = new Set(criteria.map((criterion) => criterion.id));
  for (const id of byId.keys()) {
    if (!known.has(id)) findings.push({ severity: 'high', code: 'ACCEPTANCE_RESULT_UNKNOWN', requirementId: id, message: `Semantic reviewer returned unknown requirement ${id}.` });
  }
  const normalized = [];
  for (const criterion of criteria) {
    const row = byId.get(criterion.id);
    if (!row) {
      findings.push({ severity: 'high', code: 'ACCEPTANCE_REQUIREMENT_UNREVIEWED', requirementId: criterion.id, message: `No semantic-review result for ${criterion.id}.` });
      normalized.push({ id: criterion.id, status: 'unproven', evidence: [] });
      continue;
    }
    const status = String(row.status || '').trim();
    const evidence = Array.isArray(row.evidence) ? row.evidence.filter(nonempty).map((value) => value.trim()) : [];
    if (!['passed', 'failed', 'unproven'].includes(status)) {
      findings.push({ severity: 'high', code: 'ACCEPTANCE_RESULT_STATUS_INVALID', requirementId: criterion.id, message: `Invalid acceptance result status for ${criterion.id}: ${status || 'missing'}.` });
    }
    if (status !== 'passed') {
      findings.push({ severity: 'high', code: 'ACCEPTANCE_REQUIREMENT_NOT_PROVEN', requirementId: criterion.id, message: `Acceptance criterion ${criterion.id} is ${status || 'unproven'}.` });
    }
    if (status === 'passed' && evidence.length === 0) {
      findings.push({ severity: 'high', code: 'ACCEPTANCE_EVIDENCE_REQUIRED', requirementId: criterion.id, message: `Passed acceptance criterion ${criterion.id} requires concrete evidence.` });
    }
    normalized.push({ id: criterion.id, status: ['passed', 'failed', 'unproven'].includes(status) ? status : 'unproven', evidence });
  }
  return {
    passed: findings.length === 0 && normalized.every((row) => row.status === 'passed' && row.evidence.length > 0),
    results: normalized,
    findings
  };
}
