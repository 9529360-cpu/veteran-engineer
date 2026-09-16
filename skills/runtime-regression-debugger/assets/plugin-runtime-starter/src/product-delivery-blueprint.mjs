import { TOOL_NAMES } from './tool-catalog.mjs';

export const PRODUCT_DELIVERY_BLUEPRINT_SCHEMA = 'veteran-product-delivery-blueprint-v1';
export const PRODUCT_DELIVERY_READINESS_SCHEMA = 'veteran-project-delivery-readiness-v1';
export const PRODUCT_DELIVERY_META_KEY = 'io.veteran-engineer/product-delivery';

export const DELIVERY_STAGES = Object.freeze([
  'discover', 'define', 'design', 'plan', 'build', 'verify',
  'secure', 'provision', 'release', 'observe', 'operate', 'learn'
]);

export const DELIVERY_READINESS_LEVELS = Object.freeze([
  'implementation-ready', 'release-ready', 'production-ready', 'operationally-ready'
]);

const stage = (id, purpose, evidence, recovery, invalidatedBy) => Object.freeze({
  id, purpose, evidence: Object.freeze([...evidence]), recovery,
  invalidatedBy: Object.freeze([...invalidatedBy])
});

export const DELIVERY_STAGE_DEFINITIONS = Object.freeze([
  stage('discover', 'Validate the customer, market, problem, and feedback signal.',
    ['problem-evidence', 'customer-feedback', 'market-or-competitive-evidence'],
    'Return to problem discovery when evidence contradicts the target problem or audience.',
    ['customer-evidence-drift', 'market-drift', 'problem-reframing']),
  stage('define', 'Commit the JTBD, outcomes, KPI, scope, acceptance, and governance contract.',
    ['jtbd', 'outcome-and-kpi', 'mvp-scope', 'acceptance-contract', 'governance-decision'],
    'Reconcile conflicting outcomes and re-approve the delivery contract.',
    ['scope-change', 'kpi-change', 'governance-change']),
  stage('design', 'Prove information architecture, user flows, states, accessibility, and design-system fit.',
    ['information-architecture', 'user-flow', 'ux-state-coverage', 'accessibility-evidence', 'design-system-fit'],
    'Return failed usability or accessibility findings to the owning design decision.',
    ['user-flow-change', 'design-system-change', 'accessibility-regression']),
  stage('plan', 'Choose architecture, data, security, cost, rollout, and recovery contracts.',
    ['architecture-decision', 'data-contract', 'threat-model', 'cost-budget', 'rollout-plan', 'recovery-plan'],
    'Re-plan the smallest affected owner when assumptions, dependencies, or risk change.',
    ['source-drift', 'dependency-drift', 'risk-change', 'environment-drift']),
  stage('build', 'Implement through the authoritative Mission, task, worker, and integration owners.',
    ['integrated-change', 'task-evidence', 'source-identity'],
    'Retry, resume, remediate, or cancel through existing Mission/worker recovery transitions.',
    ['source-drift', 'failed-task', 'interrupted-task', 'write-conflict']),
  stage('verify', 'Falsify the acceptance contract with exact-source validation and whole-change review.',
    ['validation-evidence', 'deterministic-review', 'semantic-review-when-required', 'candidate-identity'],
    'Create bounded remediation, rebuild the candidate, and rerun invalidated proof.',
    ['source-drift', 'candidate-refresh', 'test-or-review-failure', 'runtime-drift']),
  stage('secure', 'Establish product, dependency, artifact, and supply-chain security evidence.',
    ['security-review', 'dependency-and-supply-chain-evidence', 'artifact-provenance', 'policy-decision'],
    'Remediate the owning risk, rotate compromised material when authorized, and regenerate proof.',
    ['dependency-drift', 'policy-drift', 'artifact-change', 'new-vulnerability']),
  stage('provision', 'Prove environment identity, IaC/state plan, secrets, DNS, data, capacity, cost, and recovery.',
    ['environment-identity', 'infrastructure-plan', 'secret-reference', 'data-readiness', 'capacity-and-cost-evidence', 'restore-evidence'],
    'Re-plan against live state; roll back reversible infrastructure or forward-repair stateful changes.',
    ['environment-drift', 'infrastructure-state-drift', 'secret-rotation', 'capacity-change']),
  stage('release', 'Promote an exact artifact through migration and progressive-delivery controls.',
    ['artifact-identity', 'migration-readiness', 'progressive-delivery-plan', 'release-verification', 'rollback-or-forward-repair'],
    'Stop exposure, roll back the artifact when safe, or forward-repair durable state.',
    ['artifact-change', 'source-drift', 'deployment-drift', 'migration-state-change']),
  stage('observe', 'Bind production logs, metrics, traces, RUM, product analytics, and SLOs to the release.',
    ['telemetry-source', 'slo', 'release-health', 'rum-or-product-analytics'],
    'Repair telemetry coverage before using missing signals as proof of health.',
    ['release-change', 'telemetry-config-drift', 'slo-change', 'analytics-schema-drift']),
  stage('operate', 'Sustain incidents, rollback, backup/restore, DR drills, capacity, and FinOps.',
    ['incident-contract', 'rollback-evidence', 'backup-and-restore-evidence', 'dr-drill', 'capacity-evidence', 'finops-evidence'],
    'Contain impact, recover service/data, reconcile state, then repair the authoritative owner.',
    ['topology-drift', 'recovery-policy-change', 'capacity-drift', 'cost-anomaly']),
  stage('learn', 'Turn product analytics, customer/support feedback, and postmortems into governed next work.',
    ['product-analytics', 'customer-or-support-feedback', 'postmortem', 'reviewed-learning'],
    'Challenge or retire stale learning; feed evidence-backed outcomes into discovery and definition.',
    ['new-feedback', 'analytics-drift', 'contrary-evidence', 'experience-expiry'])
]);

export const EVIDENCE_TAXONOMY = Object.freeze({
  product: Object.freeze(['problem-evidence', 'customer-feedback', 'jtbd', 'outcome-and-kpi', 'acceptance-contract', 'product-analytics']),
  experience: Object.freeze(['information-architecture', 'user-flow', 'ux-state-coverage', 'accessibility-evidence', 'design-system-fit']),
  engineering: Object.freeze(['architecture-decision', 'data-contract', 'integrated-change', 'validation-evidence', 'whole-change-review']),
  security: Object.freeze(['threat-model', 'security-review', 'dependency-and-supply-chain-evidence', 'artifact-provenance']),
  delivery: Object.freeze(['environment-identity', 'infrastructure-plan', 'artifact-identity', 'migration-readiness', 'progressive-delivery-plan']),
  operations: Object.freeze(['telemetry-source', 'slo', 'incident-contract', 'backup-and-restore-evidence', 'dr-drill', 'capacity-evidence', 'finops-evidence']),
  learning: Object.freeze(['customer-or-support-feedback', 'postmortem', 'reviewed-learning'])
});

const TOOL_STAGE_MAP = Object.freeze({
  project_open: ['discover', 'plan'], project_snapshot: ['plan', 'provision'],
  mission_plan: ['define', 'plan'], mission_execute: ['build'], mission_status: ['build', 'verify', 'release'],
  mission_advance: ['build', 'verify', 'release'], mission_readiness: ['plan', 'build', 'verify', 'release'],
  mission_timeline: ['build', 'verify', 'operate', 'learn'], mission_cancel: ['build'], mission_resume: ['build'],
  task_result_commit: ['build'], worker_cancel: ['build'], worker_resume: ['build'], worker_retry: ['build'],
  evidence_query: DELIVERY_STAGES, validation_capabilities: ['plan', 'verify', 'secure', 'observe'],
  validation_run: ['verify', 'secure', 'observe'], review_run: ['verify', 'secure'], semantic_review_run: ['verify', 'secure'],
  remediation_plan: ['plan', 'build', 'verify', 'secure'], candidate_preflight: ['verify', 'release'],
  candidate_refresh: ['verify', 'release'], candidate_status: ['verify', 'release'],
  experience_query: ['discover', 'define', 'plan', 'learn'], experience_commit: ['learn'],
  experience_review: ['learn'], experience_challenge: ['learn'], experience_audit: ['learn'], experience_compact: ['learn'],
  runtime_health: ['observe', 'operate'], runtime_integrity: ['observe', 'operate'], runtime_cleanup: ['operate'],
  runtime_maintenance: ['operate'], handoff_export: ['plan', 'build', 'verify', 'release', 'operate']
});

const EXECUTION_STAGES = new Set(['build', 'verify']);

export const PRODUCT_DELIVERY_BLUEPRINT = Object.freeze({
  schema: PRODUCT_DELIVERY_BLUEPRINT_SCHEMA,
  authority: 'existing-project-mission-workflow-owners',
  sequence: DELIVERY_STAGES,
  stages: DELIVERY_STAGE_DEFINITIONS,
  evidenceTaxonomy: EVIDENCE_TAXONOMY,
  readinessLevels: DELIVERY_READINESS_LEVELS,
  rules: Object.freeze({
    buildCompleteIsNotProjectComplete: true,
    capabilityDoesNotImplyLifecycleReadiness: true,
    selectionsRemainExplicit: true,
    unsupportedExecutionMustRemainADeclaredGap: true
  })
});

export function toolProductDeliveryMeta(name) {
  const stages = TOOL_STAGE_MAP[name];
  if (!stages) throw new Error(`Missing product-delivery mapping for public tool: ${name}`);
  return { [PRODUCT_DELIVERY_META_KEY]: {
    schema: PRODUCT_DELIVERY_BLUEPRINT_SCHEMA,
    ...(name === 'project_open' || name === 'runtime_health' ? { blueprint: PRODUCT_DELIVERY_BLUEPRINT } : {}),
    stages,
    role: stages.some((item) => EXECUTION_STAGES.has(item)) ? 'lifecycle-and-capability' : 'lifecycle-support',
    readinessRule: 'Tool availability is capability only; lifecycle readiness requires current stage evidence and no blockers.'
  } };
}

const readiness = (status, blockers, evidence = []) => ({ status, ready: status === 'ready', blockers, evidence });

export function projectDeliveryReadiness({ mission, tasks = [], candidates = [], missionBlockers = [] }) {
  const completedTasks = tasks.filter((item) => item.status === 'completed');
  const activeCandidate = candidates.find((item) => item.id === mission.activeCandidateId) || candidates.at(-1) || null;
  const implementationBlockers = [];
  if (tasks.length === 0) implementationBlockers.push({ code: 'IMPLEMENTATION_TASKS_REQUIRED' });
  const incomplete = tasks.filter((item) => item.status !== 'completed').map((item) => item.id);
  if (incomplete.length) implementationBlockers.push({ code: 'IMPLEMENTATION_TASKS_INCOMPLETE', taskIds: incomplete });
  for (const item of missionBlockers.filter((blocker) => ['DIRTY_SOURCE_BLOCKED', 'SOURCE_AUTHORITY_CHANGED', 'RECONCILIATION_REQUIRED', 'OUTSTANDING_TASKS', 'FAILED_TASKS', 'CANCELLED_TASKS'].includes(blocker.code))) implementationBlockers.push(item);

  const releaseBlockers = [...implementationBlockers];
  if (!activeCandidate) releaseBlockers.push({ code: 'IMMUTABLE_CANDIDATE_REQUIRED' });
  const candidateProofFresh = activeCandidate?.proofFresh === true || (
    activeCandidate?.proof
    && ['passed', 'skipped'].includes(activeCandidate.proof.validation)
    && activeCandidate.proof.review === 'passed'
    && ['passed', 'skipped'].includes(activeCandidate.proof.semanticReview)
  );
  if (activeCandidate && !candidateProofFresh) releaseBlockers.push({ code: 'CANDIDATE_PROOF_NOT_FRESH' });
  if (!mission.activeMergeProposalId) releaseBlockers.push({ code: 'RELEASE_PROPOSAL_REQUIRED' });

  const productionBlockers = [...releaseBlockers,
    { code: 'PROVISIONING_EVIDENCE_REQUIRED' },
    { code: 'SECURITY_SUPPLY_CHAIN_EVIDENCE_REQUIRED' },
    { code: 'PROGRESSIVE_DELIVERY_EVIDENCE_REQUIRED' }
  ];
  const operationalBlockers = [...productionBlockers,
    { code: 'PRODUCTION_TELEMETRY_EVIDENCE_REQUIRED' },
    { code: 'SLO_AND_INCIDENT_CONTRACT_REQUIRED' },
    { code: 'BACKUP_RESTORE_AND_DR_DRILL_REQUIRED' },
    { code: 'CAPACITY_AND_FINOPS_EVIDENCE_REQUIRED' },
    { code: 'CUSTOMER_FEEDBACK_LOOP_REQUIRED' }
  ];

  const stageByPhase = { execution: 'build', validation: 'verify', review: 'verify', 'semantic-review': 'secure', candidate: 'release', finalize: 'release' };
  return {
    schema: PRODUCT_DELIVERY_READINESS_SCHEMA,
    blueprintSchema: PRODUCT_DELIVERY_BLUEPRINT_SCHEMA,
    currentStage: stageByPhase[mission.phase] || 'plan',
    levels: {
      implementationReady: readiness(implementationBlockers.length ? 'blocked' : 'ready', implementationBlockers, completedTasks.map((item) => item.id)),
      releaseReady: readiness(releaseBlockers.length ? 'blocked' : 'ready', releaseBlockers, activeCandidate ? [activeCandidate.id] : []),
      productionReady: readiness('blocked', productionBlockers),
      operationallyReady: readiness('blocked', operationalBlockers)
    },
    nextStepCandidates: missionBlockers.length ? ['mission_readiness', 'mission_status'] : ['mission_advance'],
    capabilityNotice: 'Available tools and providers are capabilities, not evidence that a lifecycle stage is ready.',
    declaredProviderGaps: ['product-discovery', 'ux-design', 'analytics', 'finops', 'security-supply-chain', 'infrastructure-provisioning', 'production-telemetry', 'progressive-delivery', 'customer-feedback', 'governance', 'dr-drills']
  };
}

if (Object.keys(TOOL_STAGE_MAP).length !== TOOL_NAMES.length) {
  throw new Error(`Every public tool must map to the delivery lifecycle; got ${Object.keys(TOOL_STAGE_MAP).length} mappings for ${TOOL_NAMES.length} tools`);
}
for (const name of TOOL_NAMES) toolProductDeliveryMeta(name);
