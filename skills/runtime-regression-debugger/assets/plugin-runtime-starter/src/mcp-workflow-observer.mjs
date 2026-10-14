import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

// This producer is ONLY for Veteran's own MCP tool boundary. It does not
// intercept ChatGPT, IDE, or third-party tool calls.
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const EVIDENCE = /^evidence_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBSERVER_SOURCE = 'veteran-mcp';
const OBSERVER_WORKFLOW = 'repo-validation';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function commitEvidence(value) {
  return typeof value === 'string' && COMMIT.test(value) ? 'commit:' + value.toLowerCase() : null;
}

function runtimeEvidence(value, kind) {
  return typeof value === 'string' && EVIDENCE.test(value) ? kind + ':' + value.toLowerCase() : null;
}

function receipt(activity, outcome, evidenceIds, name, requestId) {
  if (!activity || evidenceIds.some((item) => !item)) return null;
  return {
    event_id: digest(name + '\0' + requestId),
    workflow: OBSERVER_WORKFLOW,
    activity,
    outcome,
    evidence_ids: evidenceIds
  };
}

/**
 * Convert a completed Veteran tool result to an allowlisted semantic event.
 * Never serialize args, raw result, prompts, commands, source or freeform text.
 * A request ID is an idempotency key, not user-visible learning content.
 */
export function mcpWorkflowReceipt(name, args, result) {
  if (typeof args?.requestId !== 'string' || !args.requestId.trim()
      || !result || typeof result !== 'object' || Array.isArray(result)) return null;

  if (name === 'project_snapshot') {
    const head = commitEvidence(result.sourceIdentity?.head);
    return head ? receipt('repo.inspect', 'passed', [head], name, args.requestId) : null;
  }
  if (name === 'task_result_commit') {
    if (result.ok !== true) return null;
    const head = commitEvidence(result.integrationSha || result.commitSha);
    return head ? receipt('source.change', 'passed', [head], name, args.requestId) : null;
  }
  if (name === 'validation_run') {
    if (typeof result.passed !== 'boolean') return null;
    const evidence = runtimeEvidence(result.evidenceId, 'runtime');
    const head = commitEvidence(result.commitSha);
    return evidence ? receipt('checks.focused', result.passed ? 'passed' : 'failed',
      [evidence, ...(head ? [head] : [])], name, args.requestId) : null;
  }
  if (name === 'review_run') {
    if (typeof result.passed !== 'boolean') return null;
    const evidence = runtimeEvidence(result.evidenceId, 'review');
    const head = commitEvidence(result.head);
    return evidence ? receipt('review.diff', result.passed ? 'passed' : 'failed',
      [evidence, ...(head ? [head] : [])], name, args.requestId) : null;
  }
  // No automatic success from planned, unknown, skipped or unproven tasks.
  return null;
}

function settingsFromEnv(env) {
  if (env.VETERAN_WORKFLOW_OBSERVER !== '1') return null;
  const journal = env.VETERAN_WORKFLOW_JOURNAL;
  const importer = env.VETERAN_WORKFLOW_OBSERVER_IMPORTER;
  if (typeof journal !== 'string' || !path.isAbsolute(journal)) {
    throw new Error('Workflow observation requires an absolute VETERAN_WORKFLOW_JOURNAL path');
  }
  if (typeof importer !== 'string' || !path.isAbsolute(importer)
      || path.basename(importer) !== 'workflow_observer.py') {
    throw new Error('Workflow observation requires an absolute path to workflow_observer.py');
  }
  return {
    journal,
    importer,
    python: env.VETERAN_WORKFLOW_OBSERVER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  };
}

async function importReceipt(settings, observation) {
  // Argument vector and JSONL stdin; no shell interpolation or raw result.
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(settings.python, [
        settings.importer, settings.journal,
        '--source', OBSERVER_SOURCE, '--events', '-'
      ], { shell: false, windowsHide: true, timeout: 8000, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.on('error', () => {}); // Interpreter may exit before stdin is written.
    child.stdin.end(JSON.stringify(observation) + '\n');
  });
}

/**
 * Opt-in, foreground, one-process-at-a-time bridge. Never alters tool results.
 * Inject 'deliver' only for deterministic testing; production always uses the
 * existing Python journal importer and its strict schema / idempotency rules.
 */
export function createMcpWorkflowObserver({ env = process.env, deliver = importReceipt, warn = console.error } = {}) {
  const settings = settingsFromEnv(env);
  if (!settings) return { enabled: false, observe: async () => false };
  let tail = Promise.resolve();
  let warned = false;
  return {
    enabled: true,
    observe(name, args, result) {
      const observation = mcpWorkflowReceipt(name, args, result);
      if (!observation) return Promise.resolve(false);
      const current = tail.catch(() => {}).then(async () => {
        try {
          if (await deliver(settings, observation)) return true;
        } catch {
          // Optional learning capture cannot invalidate a proven tool result.
        }
        if (!warned) {
          warned = true;
          warn('[veteran-engineer] Optional workflow capture unavailable; tool result preserved.');
        }
        return false;
      });
      tail = current;
      return current;
    }
  };
}
