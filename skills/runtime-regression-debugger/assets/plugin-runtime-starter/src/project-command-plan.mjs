export const PROJECT_COMMAND_PLAN_CONTRACT = 'veteran-project-command-plan-v1';

const MAX_CHANGED_PATHS = 256;
const MAX_COMMANDS = 64;

const COMMAND_AUTHORITY_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb'
]);

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\\\', '/').replace(/^\.\//, '');
}

function normalizePaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizePath).filter(Boolean))]
    .sort()
    .slice(0, MAX_CHANGED_PATHS);
}

function safeScriptName(value) {
  const name = String(value || '');
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(name);
}

function nodeScriptCommand(manager, scriptName) {
  if (!manager || !safeScriptName(scriptName)) return null;
  return [manager, 'run', scriptName];
}

function scriptKind(name) {
  const value = String(name || '').toLowerCase();
  if (value === 'check' || value.startsWith('check:') || value === 'verify' || value.startsWith('verify:')) return 'aggregate';
  if (value === 'typecheck' || value.startsWith('typecheck:') || value === 'check:types' || value.startsWith('types:')) return 'typecheck';
  if (value === 'test' || value.startsWith('test:unit') || value.startsWith('test:') && !value.includes('e2e')) return 'test';
  if (value === 'e2e' || value.startsWith('e2e:') || value.includes('e2e')) return 'e2e';
  if (value === 'lint' || value.startsWith('lint:')) return 'lint';
  if (value === 'build' || value.startsWith('build:')) return 'build';
  if (value === 'dev' || value.startsWith('dev:') || value === 'start' || value.startsWith('start:') || value === 'serve' || value.startsWith('serve:') || value === 'preview' || value.startsWith('preview:')) return 'start';
  return 'other';
}

function commandRecord(manager, scriptName, readiness) {
  const command = nodeScriptCommand(manager, scriptName);
  const kind = scriptKind(scriptName);
  return {
    id: `node-script:${scriptName}`,
    family: 'node',
    kind,
    script: scriptName,
    command,
    source: `package.json#scripts.${scriptName}`,
    runnable: readiness.runnable,
    readinessReason: readiness.reason
  };
}

function managerReadiness(profile, readiness) {
  const manager = profile?.packageManagers?.node?.selected || null;
  if (!manager) {
    return {
      manager: null,
      runnable: false,
      reason: profile?.packageManagers?.node?.ambiguous ? 'package-manager-ambiguous' : 'package-manager-unresolved'
    };
  }
  const checks = readiness?.checks || [];
  const nodeCheck = checks.find((item) => item?.id === 'node');
  if (!nodeCheck) return { manager, runnable: false, reason: 'node-readiness-unverified' };
  if (nodeCheck.available !== true) return { manager, runnable: false, reason: 'node-runtime-unavailable' };
  if (nodeCheck.compatibility === 'mismatch') return { manager, runnable: false, reason: 'node-runtime-version-mismatch' };
  const check = checks.find((item) => item?.id === `node-package-manager:${manager}`);
  if (!check) return { manager, runnable: false, reason: 'package-manager-readiness-unverified' };
  if (check.available !== true) return { manager, runnable: false, reason: 'package-manager-unavailable' };
  if (check.compatibility === 'mismatch') return { manager, runnable: false, reason: 'package-manager-version-mismatch' };
  return { manager, runnable: true, reason: 'ready' };
}

function docsOnly(paths) {
  if (!paths.length) return false;
  return paths.every((item) => {
    const lower = item.toLowerCase();
    const base = lower.split('/').at(-1) || lower;
    return lower.startsWith('docs/')
      || /\.(?:md|mdx|rst|adoc)$/.test(lower)
      || ['readme', 'readme.md', 'changelog', 'changelog.md', 'license', 'license.md'].includes(base);
  });
}

function testLike(paths) {
  return paths.some((item) => /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^/]+$/i.test(item));
}

function sourceLike(paths) {
  return paths.some((item) => /\.(?:c|cc|cpp|cxx|h|hh|hpp|mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|cs|rb|php|swift|vue|svelte)$/i.test(item));
}

function first(commands, kind, exactNames = []) {
  for (const name of exactNames) {
    const found = commands.find((item) => item.kind === kind && item.script === name);
    if (found) return found;
  }
  return commands.find((item) => item.kind === kind) || null;
}

function uniqueCommands(commands) {
  const seen = new Set();
  const result = [];
  for (const item of commands) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function validationSelection(validationCommands, changedPaths, { authorityDirty, runnable }) {
  const available = validationCommands.filter((item) => item.runnable);
  const issues = [];
  if (authorityDirty) {
    issues.push({
      code: 'COMMAND_AUTHORITY_DIRTY',
      severity: 'warning',
      message: 'Package command authority changed in the working tree; refresh repository-derived command evidence before executing a discovered script.'
    });
    return {
      status: 'degraded',
      minimal: [],
      broader: available.slice(0, 12),
      reason: 'command-authority-dirty',
      issues
    };
  }
  if (!changedPaths.length) {
    return { status: runnable ? 'discovery-only' : 'blocked', minimal: [], broader: available.slice(0, 12), reason: 'no-current-dirty-paths', issues };
  }
  if (!runnable) {
    issues.push({
      code: 'COMMAND_EXECUTION_NOT_READY',
      severity: 'blocker',
      message: 'Repository-declared validation scripts were discovered, but the selected package-manager environment is not ready.'
    });
    return { status: 'blocked', minimal: [], broader: [], reason: 'environment-not-ready', issues };
  }
  if (docsOnly(changedPaths)) {
    return {
      status: 'ready',
      minimal: [],
      broader: available.slice(0, 12),
      reason: 'documentation-only-change',
      issues
    };
  }

  const aggregate = first(available, 'aggregate', ['check', 'verify']);
  let minimal = [];
  if (aggregate) {
    minimal = [aggregate];
  } else if (testLike(changedPaths)) {
    minimal = [first(available, 'test', ['test', 'test:unit'])].filter(Boolean);
    if (!minimal.length) minimal = [first(available, 'typecheck', ['typecheck', 'check:types'])].filter(Boolean);
    if (!minimal.length) minimal = [first(available, 'lint', ['lint'])].filter(Boolean);
    if (!minimal.length) minimal = [first(available, 'build', ['build'])].filter(Boolean);
  } else if (sourceLike(changedPaths)) {
    minimal = [
      first(available, 'typecheck', ['typecheck', 'check:types']),
      first(available, 'test', ['test', 'test:unit'])
    ].filter(Boolean);
    if (!minimal.length) minimal = [first(available, 'lint', ['lint'])].filter(Boolean);
    if (!minimal.length) minimal = [first(available, 'build', ['build'])].filter(Boolean);
  } else {
    minimal = [
      first(available, 'test', ['test', 'test:unit']),
      first(available, 'build', ['build'])
    ].filter(Boolean).slice(0, 2);
    if (!minimal.length) minimal = [first(available, 'lint', ['lint'])].filter(Boolean);
  }

  minimal = uniqueCommands(minimal).slice(0, 2);
  const selected = new Set(minimal.map((item) => item.id));
  const broader = available.filter((item) => !selected.has(item.id)).slice(0, 12);
  if (!minimal.length) {
    issues.push({
      code: 'VALIDATION_COMMAND_UNRESOLVED',
      severity: 'warning',
      message: 'No repository-declared validation script matched the bounded minimal-selection rules.'
    });
  }
  return {
    status: minimal.length ? 'ready' : 'degraded',
    minimal,
    broader,
    reason: minimal.length ? 'bounded-minimal-selection' : 'no-minimal-validation-command',
    issues
  };
}

export function compileProjectCommandPlan(profile, readiness, { changedPaths = [] } = {}) {
  const normalizedChangedPaths = normalizePaths(changedPaths);
  const managerState = managerReadiness(profile, readiness);
  const scriptNames = (profile?.node?.scriptNames || []).slice(0, MAX_COMMANDS);
  const safeScriptNames = scriptNames.filter(safeScriptName);
  const unsafeScriptCount = scriptNames.length - safeScriptNames.length;
  const commands = managerState.manager
    ? safeScriptNames.map((scriptName) => commandRecord(managerState.manager, scriptName, managerState))
    : [];
  const start = commands.filter((item) => item.kind === 'start');
  const validationCommands = commands.filter((item) => ['aggregate', 'typecheck', 'test', 'e2e', 'lint', 'build'].includes(item.kind));
  const authorityDirty = normalizedChangedPaths.some((item) => COMMAND_AUTHORITY_PATHS.has(item));
  const validation = validationSelection(validationCommands, normalizedChangedPaths, {
    authorityDirty,
    runnable: managerState.runnable
  });
  const issues = [...validation.issues];
  if (unsafeScriptCount > 0) {
    issues.unshift({
      code: 'COMMAND_SCRIPT_NAME_UNSAFE',
      severity: 'warning',
      message: `${unsafeScriptCount} package script name(s) were not converted into executable invocations because they are unsafe as bounded command arguments.`
    });
  }
  if (!managerState.manager && profile?.node) {
    issues.unshift({
      code: profile?.packageManagers?.node?.ambiguous ? 'COMMAND_PACKAGE_MANAGER_AMBIGUOUS' : 'COMMAND_PACKAGE_MANAGER_UNRESOLVED',
      severity: 'blocker',
      message: 'Node scripts exist, but repository evidence does not identify one package manager for safe invocation.'
    });
  }
  if (managerState.manager && !managerState.runnable) {
    issues.unshift({
      code: 'COMMAND_PACKAGE_MANAGER_NOT_READY',
      severity: 'blocker',
      message: `${managerState.manager} command invocation is discovered but not ready on the current execution host.`
    });
  }

  return {
    contract: PROJECT_COMMAND_PLAN_CONTRACT,
    status: issues.some((item) => item.severity === 'blocker') ? 'blocked' : validation.status,
    executionPolicy: 'caller-reviewed',
    autoExecute: false,
    packageManager: managerState.manager,
    changedPaths: normalizedChangedPaths,
    authorityDirty,
    start,
    validation,
    commands,
    issues
  };
}
