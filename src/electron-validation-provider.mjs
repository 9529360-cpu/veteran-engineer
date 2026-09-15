import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ELECTRON_VALIDATION_CONTRACT = 'veteran-electron-validation-v1';
export const ELECTRON_SCENARIO_CONTRACT = 'veteran-electron-scenario-v1';

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_ENV_NAMES = 64;
const MAX_SCENARIO_BYTES = 256 * 1024;
const MAX_STEPS = 256;
const MAX_SCREENSHOTS = 32;
const MAX_SURFACES = 64;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SCREENSHOT_TOTAL_BYTES = 48 * 1024 * 1024;
const MAX_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STEP_TIMEOUT_MS = 10_000;
const ACTIONS = new Set([
  'waitForSurface',
  'click',
  'fill',
  'press',
  'assertVisible',
  'assertText',
  'assertValue',
  'assertUrl',
  'screenshot'
]);
const TARGET_TYPES = new Set(['window', 'webview']);
const MATCH_MODES = new Set(['equals', 'contains']);
const SAFE_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC',
  'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY'
];
const PROTECTED_HOME_ENV = new Set([
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'APPDATA', 'LOCALAPPDATA'
]);

function errorWithCode(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function boundedString(value, label, { max = 4096, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max || value.includes('\u0000')) {
    throw errorWithCode(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded string`, 'ELECTRON_VALIDATION_CONFIG_INVALID');
  }
  return value;
}

function normalizeRelativeFile(value, label = 'Electron scenarioFile') {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  if (!raw) throw errorWithCode(`${label} must be non-empty`, 'ELECTRON_SCENARIO_PATH_INVALID');
  if (raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw)) {
    throw errorWithCode(`${label} must be relative to the Electron cwd`, 'ELECTRON_SCENARIO_PATH_ESCAPE');
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw errorWithCode(`${label} must remain inside the Electron cwd`, 'ELECTRON_SCENARIO_PATH_ESCAPE');
  }
  return normalized;
}

function normalizeExecutablePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\u0000')) {
    throw errorWithCode('Electron executablePath must be a non-empty path', 'ELECTRON_EXECUTABLE_PATH_INVALID');
  }
  const normalized = value.trim();
  if (normalized.length > 4096) throw errorWithCode('Electron executablePath is too long', 'ELECTRON_EXECUTABLE_PATH_INVALID');
  if (path.isAbsolute(normalized)) return normalized;
  const portable = normalized.replaceAll('\\', '/');
  const relative = path.posix.normalize(portable.replace(/^\.\//, ''));
  if (!relative || relative === '.' || relative === '..' || relative.startsWith('../') || relative.startsWith('/')) {
    throw errorWithCode('Relative Electron executablePath must remain inside the Electron cwd', 'ELECTRON_EXECUTABLE_PATH_ESCAPE');
  }
  return relative;
}

function normalizeArgs(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ARGS) {
    throw errorWithCode(`Electron args must be an array with at most ${MAX_ARGS} values`, 'ELECTRON_ARGS_INVALID');
  }
  return raw.map((value) => boundedString(value, 'Electron arg', { max: MAX_ARG_LENGTH, allowEmpty: true }));
}

function normalizeEnvAllowlist(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ENV_NAMES) {
    throw errorWithCode('Electron envAllowlist must be a bounded array', 'ELECTRON_ENV_INVALID');
  }
  const output = [];
  const seen = new Set();
  for (const value of raw) {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw errorWithCode('Electron envAllowlist contains an invalid variable name', 'ELECTRON_ENV_INVALID');
    }
    const identity = value.toUpperCase();
    if (PROTECTED_HOME_ENV.has(identity)) {
      throw errorWithCode('Electron envAllowlist may not override isolated home/config variables', 'ELECTRON_ENV_INVALID');
    }
    if (!seen.has(identity)) {
      seen.add(identity);
      output.push(value);
    }
  }
  return output;
}

function normalizeTimeout(value, fallback, code) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 250 || numeric > MAX_TIMEOUT_MS) {
    throw errorWithCode(`Electron timeout must be between 250 and ${MAX_TIMEOUT_MS}ms`, code);
  }
  return Math.floor(numeric);
}

export function normalizeElectronValidation(raw) {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw errorWithCode('Electron validation configuration must be an object', 'ELECTRON_VALIDATION_CONFIG_INVALID');
  }
  const timeoutMs = normalizeTimeout(raw.timeoutMs, DEFAULT_TIMEOUT_MS, 'ELECTRON_TIMEOUT_INVALID');
  const stepTimeoutMs = normalizeTimeout(raw.stepTimeoutMs, DEFAULT_STEP_TIMEOUT_MS, 'ELECTRON_STEP_TIMEOUT_INVALID');
  return Object.freeze({
    contract: ELECTRON_VALIDATION_CONTRACT,
    executablePath: normalizeExecutablePath(raw.executablePath),
    args: Object.freeze(normalizeArgs(raw.args)),
    cwd: raw.cwd ? boundedString(raw.cwd, 'Electron cwd', { max: 1000 }) : '.',
    scenarioFile: normalizeRelativeFile(raw.scenarioFile),
    timeoutMs,
    stepTimeoutMs: Math.min(stepTimeoutMs, timeoutMs),
    envAllowlist: Object.freeze(normalizeEnvAllowlist(raw.envAllowlist)),
    chromiumSandbox: raw.chromiumSandbox === undefined ? true : (() => {
      if (typeof raw.chromiumSandbox !== 'boolean') throw errorWithCode('Electron chromiumSandbox must be boolean', 'ELECTRON_VALIDATION_CONFIG_INVALID');
      return raw.chromiumSandbox;
    })()
  });
}

function normalizeTarget(raw, index) {
  if (raw === undefined || raw === null) return Object.freeze({ type: 'window', index: 0 });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw errorWithCode(`Electron scenario step ${index + 1} target must be an object`, 'ELECTRON_SCENARIO_INVALID');
  }
  const type = raw.type === undefined ? 'window' : String(raw.type);
  if (!TARGET_TYPES.has(type)) throw errorWithCode(`Electron scenario step ${index + 1} has unknown target type ${type}`, 'ELECTRON_SCENARIO_INVALID');
  const targetIndex = raw.index === undefined ? 0 : Number(raw.index);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 64) {
    throw errorWithCode(`Electron scenario step ${index + 1} target index is invalid`, 'ELECTRON_SCENARIO_INVALID');
  }
  const titleIncludes = raw.titleIncludes === undefined ? null : boundedString(raw.titleIncludes, 'Electron target titleIncludes', { max: 240, allowEmpty: true });
  const urlIncludes = raw.urlIncludes === undefined ? null : boundedString(raw.urlIncludes, 'Electron target urlIncludes', { max: 1000, allowEmpty: true });
  return Object.freeze({
    type,
    index: targetIndex,
    ...(titleIncludes === null ? {} : { titleIncludes }),
    ...(urlIncludes === null ? {} : { urlIncludes })
  });
}

function normalizeScreenshotName(value, index) {
  const name = value === undefined ? `step-${String(index + 1).padStart(3, '0')}.png` : String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.png$/i.test(name)) {
    throw errorWithCode(`Electron scenario step ${index + 1} screenshot name must be a bounded .png filename`, 'ELECTRON_SCENARIO_INVALID');
  }
  return name;
}

function normalizeStep(raw, index, defaultStepTimeoutMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw errorWithCode(`Electron scenario step ${index + 1} must be an object`, 'ELECTRON_SCENARIO_INVALID');
  }
  const action = String(raw.action || '');
  if (!ACTIONS.has(action)) throw errorWithCode(`Electron scenario step ${index + 1} has unknown action ${action || '<empty>'}`, 'ELECTRON_SCENARIO_INVALID');
  const target = normalizeTarget(raw.target, index);
  const timeoutMs = raw.timeoutMs === undefined
    ? defaultStepTimeoutMs
    : normalizeTimeout(raw.timeoutMs, defaultStepTimeoutMs, 'ELECTRON_STEP_TIMEOUT_INVALID');
  const name = raw.name === undefined ? null : boundedString(raw.name, 'Electron step name', { max: 240 });
  const selectorRequired = new Set(['click', 'fill', 'assertVisible', 'assertText', 'assertValue']);
  const selector = raw.selector === undefined ? null : boundedString(raw.selector, 'Electron selector', { max: 2000 });
  if (selectorRequired.has(action) && !selector) {
    throw errorWithCode(`Electron scenario step ${index + 1} action ${action} requires selector`, 'ELECTRON_SCENARIO_INVALID');
  }
  const step = { action, target, timeoutMs, ...(name ? { name } : {}) };
  if (selector) step.selector = selector;
  if (action === 'fill') step.value = boundedString(raw.value ?? '', 'Electron fill value', { max: 10000, allowEmpty: true });
  if (action === 'press') {
    step.key = boundedString(raw.key, 'Electron key', { max: 120 });
    if (selector) step.selector = selector;
  }
  if (action === 'assertText') {
    step.text = boundedString(raw.text ?? '', 'Electron asserted text', { max: 10000, allowEmpty: true });
    step.match = raw.match === undefined ? 'contains' : String(raw.match);
    if (!MATCH_MODES.has(step.match)) throw errorWithCode(`Electron scenario step ${index + 1} has invalid text match`, 'ELECTRON_SCENARIO_INVALID');
  }
  if (action === 'assertValue') step.value = boundedString(raw.value ?? '', 'Electron asserted value', { max: 10000, allowEmpty: true });
  if (action === 'assertUrl') {
    step.url = boundedString(raw.url ?? '', 'Electron asserted URL', { max: 2000, allowEmpty: true });
    step.match = raw.match === undefined ? 'contains' : String(raw.match);
    if (!MATCH_MODES.has(step.match)) throw errorWithCode(`Electron scenario step ${index + 1} has invalid URL match`, 'ELECTRON_SCENARIO_INVALID');
  }
  if (action === 'screenshot') step.filename = normalizeScreenshotName(raw.filename, index);
  return Object.freeze(step);
}

export function normalizeElectronScenario(raw, { stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.contract !== ELECTRON_SCENARIO_CONTRACT) {
    throw errorWithCode(`Electron scenario must use contract ${ELECTRON_SCENARIO_CONTRACT}`, 'ELECTRON_SCENARIO_INVALID');
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS) {
    throw errorWithCode(`Electron scenario steps must contain 1-${MAX_STEPS} entries`, 'ELECTRON_SCENARIO_INVALID');
  }
  const steps = raw.steps.map((step, index) => normalizeStep(step, index, stepTimeoutMs));
  const screenshots = steps.filter((step) => step.action === 'screenshot').length;
  if (screenshots > MAX_SCREENSHOTS) throw errorWithCode(`Electron scenario may request at most ${MAX_SCREENSHOTS} screenshots`, 'ELECTRON_SCENARIO_INVALID');
  return Object.freeze({ contract: ELECTRON_SCENARIO_CONTRACT, steps: Object.freeze(steps) });
}

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function resolveContainedScenario(cwd, relativePath) {
  const realRoot = await fs.realpath(cwd);
  const absolute = path.resolve(realRoot, ...relativePath.split('/'));
  if (!insideRoot(realRoot, absolute)) throw errorWithCode('Electron scenarioFile escapes the Electron cwd', 'ELECTRON_SCENARIO_PATH_ESCAPE');
  const info = await fs.lstat(absolute).catch((error) => {
    if (error?.code === 'ENOENT') throw errorWithCode('Electron scenarioFile does not exist', 'ELECTRON_SCENARIO_NOT_FOUND');
    throw error;
  });
  if (info.isSymbolicLink()) throw errorWithCode('Electron scenarioFile may not be a symlink', 'ELECTRON_SCENARIO_SYMLINK');
  if (!info.isFile()) throw errorWithCode('Electron scenarioFile must be a regular file', 'ELECTRON_SCENARIO_INVALID');
  if (info.size > MAX_SCENARIO_BYTES) throw errorWithCode('Electron scenarioFile exceeds the bounded size limit', 'ELECTRON_SCENARIO_LIMIT_EXCEEDED');
  const real = await fs.realpath(absolute);
  if (!insideRoot(realRoot, real)) throw errorWithCode('Electron scenarioFile resolves outside the Electron cwd', 'ELECTRON_SCENARIO_PATH_ESCAPE');
  return real;
}

async function resolveExecutable(cwd, configuredPath) {
  const candidate = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(cwd, ...configuredPath.replaceAll('\\', '/').split('/'));
  if (!path.isAbsolute(configuredPath)) {
    const realRoot = await fs.realpath(cwd);
    const resolved = await fs.realpath(candidate).catch(() => candidate);
    if (!insideRoot(realRoot, resolved)) throw errorWithCode('Relative Electron executablePath escapes the Electron cwd', 'ELECTRON_EXECUTABLE_PATH_ESCAPE');
  }
  const info = await fs.stat(candidate).catch((error) => {
    if (error?.code === 'ENOENT') throw errorWithCode('Electron executablePath does not exist', 'ELECTRON_EXECUTABLE_NOT_FOUND');
    throw error;
  });
  if (!info.isFile()) throw errorWithCode('Electron executablePath must resolve to a file', 'ELECTRON_EXECUTABLE_PATH_INVALID');
  return candidate;
}

async function readScenario(cwd, electron) {
  const file = await resolveContainedScenario(cwd, electron.scenarioFile);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code) throw error;
    throw errorWithCode('Electron scenarioFile is not valid JSON', 'ELECTRON_SCENARIO_INVALID');
  }
  return normalizeElectronScenario(parsed, { stepTimeoutMs: electron.stepTimeoutMs });
}

async function createElectronEnvironment(allowlist, environment) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-home-'));
  try {
    const env = {};
    for (const key of SAFE_ENV_KEYS) if (typeof environment?.[key] === 'string') env[key] = environment[key];
    env.HOME = home;
    env.USERPROFILE = home;
    env.XDG_CONFIG_HOME = path.join(home, '.config');
    env.XDG_CACHE_HOME = path.join(home, '.cache');
    env.APPDATA = path.join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    for (const key of allowlist) if (typeof environment?.[key] === 'string') env[key] = environment[key];
    return { env, home };
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matches(value, expected, mode) {
  return mode === 'equals' ? value === expected : value.includes(expected);
}

function sanitizeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    if (url.protocol === 'file:') return `file:///${path.basename(decodeURIComponent(url.pathname))}`;
    return url.toString();
  } catch {
    return String(value).slice(0, 1000).replace(/[?#].*$/, '');
  }
}

async function windowSurfaces(app) {
  const output = [];
  for (const page of app.windows()) {
    if (output.length >= MAX_SURFACES) break;
    if (page.isClosed()) continue;
    let title = '';
    try { title = await page.title(); } catch {}
    output.push({ page, title, url: page.url() });
  }
  return output;
}

function targetMatches(surface, target) {
  if (target.titleIncludes !== undefined && !String(surface.title || '').includes(target.titleIncludes)) return false;
  if (target.urlIncludes !== undefined && !String(surface.url || '').includes(target.urlIncludes)) return false;
  return true;
}

async function waitForWindow(app, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const candidates = (await windowSurfaces(app)).filter((surface) => targetMatches(surface, target));
    if (candidates[target.index]) return candidates[target.index].page;
    if (Date.now() >= deadline) throw errorWithCode('Electron target BrowserWindow was not found before timeout', 'ELECTRON_SURFACE_NOT_FOUND', { target });
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

async function guestCommand(app, target, operation, params = {}) {
  return app.evaluate(async ({ BrowserWindow, webContents }, input) => {
    const candidates = webContents.getAllWebContents()
      .filter((contents) => {
        try { return !contents.isDestroyed() && contents.getType() === 'webview'; } catch { return false; }
      })
      .map((contents) => {
        let title = '';
        let url = '';
        try { title = contents.getTitle(); } catch {}
        try { url = contents.getURL(); } catch {}
        return { contents, title, url };
      })
      .filter((surface) => {
        if (input.target.titleIncludes !== undefined && !surface.title.includes(input.target.titleIncludes)) return false;
        if (input.target.urlIncludes !== undefined && !surface.url.includes(input.target.urlIncludes)) return false;
        return true;
      })
      .sort((left, right) => left.contents.id - right.contents.id)
      .slice(0, MAX_SURFACES);
    const surface = candidates[input.target.index];
    if (!surface) return { ok: false, code: 'ELECTRON_SURFACE_NOT_FOUND' };
    const contents = surface.contents;
    const focusOwner = () => {
      try {
        const host = contents.hostWebContents || contents;
        const owner = BrowserWindow.fromWebContents(host);
        if (owner && !owner.isDestroyed()) {
          owner.show();
          owner.focus();
        }
        if (typeof contents.focus === 'function') contents.focus();
      } catch {}
    };
    const runDom = async (domOperation) => {
      const domParams = { ...(input.params || {}), operation: domOperation };
      const source = `(() => {
        const p = ${JSON.stringify(domParams)};
        const el = p.selector ? document.querySelector(p.selector) : null;
        const visible = (node) => {
          if (!node) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
        };
        if (p.operation === 'inspect') {
          if (!el) return { found: false, visible: false, text: null, value: null, rect: null };
          const rect = el.getBoundingClientRect();
          return { found: true, visible: visible(el), text: el.textContent ?? '', value: 'value' in el ? String(el.value ?? '') : null, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        }
        if (p.operation === 'focus-clear') {
          if (!el) return { found: false };
          el.focus();
          if ('value' in el) {
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, ''); else el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { found: true };
        }
        if (p.operation === 'focus') {
          if (!el) return { found: false };
          el.focus();
          return { found: true };
        }
        return { found: false };
      })()`;
      return contents.executeJavaScript(source, true);
    };

    if (input.operation === 'inventory') {
      return { ok: true, id: contents.id, type: contents.getType(), title: surface.title, url: surface.url, hostId: contents.hostWebContents?.id || null };
    }
    if (input.operation === 'url') return { ok: true, url: surface.url };
    if (input.operation === 'inspect') return { ok: true, ...(await runDom('inspect')) };
    if (input.operation === 'click') {
      const inspected = await runDom('inspect');
      if (!inspected.found || !inspected.visible || !inspected.rect) return { ok: false, code: 'ELECTRON_SELECTOR_NOT_INTERACTABLE' };
      focusOwner();
      const x = Math.floor(inspected.rect.x + inspected.rect.width / 2);
      const y = Math.floor(inspected.rect.y + inspected.rect.height / 2);
      contents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
      contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      return { ok: true };
    }
    if (input.operation === 'fill') {
      const focused = await runDom('focus-clear');
      if (!focused.found) return { ok: false, code: 'ELECTRON_SELECTOR_NOT_FOUND' };
      focusOwner();
      await contents.insertText(String(input.params.value ?? ''));
      return { ok: true };
    }
    if (input.operation === 'press') {
      if (input.params.selector) {
        const focused = await runDom('focus');
        if (!focused.found) return { ok: false, code: 'ELECTRON_SELECTOR_NOT_FOUND' };
      }
      focusOwner();
      const pieces = String(input.params.key || '').split('+').filter(Boolean);
      const keyCode = pieces.pop() || '';
      const modifiers = pieces.map((part) => ({ Control: 'control', Ctrl: 'control', Shift: 'shift', Alt: 'alt', Meta: 'meta', Command: 'meta' }[part] || part.toLowerCase()));
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      return { ok: true };
    }
    if (input.operation === 'screenshot') {
      const image = await contents.capturePage();
      return { ok: true, pngBase64: image.toPNG().toString('base64') };
    }
    return { ok: false, code: 'ELECTRON_OPERATION_INVALID' };
  }, { target, operation, params: { ...params, operation: params.operation || operation } });
}

async function waitForGuest(app, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await guestCommand(app, target, 'inventory');
    if (result?.ok) return result;
    if (Date.now() >= deadline) throw errorWithCode('Electron target webview guest was not found before timeout', 'ELECTRON_SURFACE_NOT_FOUND', { target });
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

async function waitForGuestInspect(app, step, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await guestCommand(app, step.target, 'inspect', { selector: step.selector });
    if (result?.ok && predicate(result)) return result;
    if (Date.now() >= deadline) return result || { ok: false };
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

async function pollWindow(page, read, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let value;
  for (;;) {
    value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) return value;
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

async function captureWindow(page) {
  return page.screenshot({ type: 'png' });
}

function pushScreenshotAttachment(attachments, attachment) {
  const content = Buffer.from(attachment.content);
  if (content.length > MAX_SCREENSHOT_BYTES) {
    throw errorWithCode(`Electron screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes`, 'ELECTRON_SCREENSHOT_LIMIT_EXCEEDED');
  }
  const total = attachments.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) + content.length;
  if (total > MAX_SCREENSHOT_TOTAL_BYTES) {
    throw errorWithCode(`Electron screenshots exceed ${MAX_SCREENSHOT_TOTAL_BYTES} total bytes`, 'ELECTRON_SCREENSHOT_LIMIT_EXCEEDED');
  }
  attachments.push({ ...attachment, content });
}

function assertionName(step, index) {
  return step.name || `${step.action} step ${index + 1}`;
}

function assertionDetail(value) {
  if (value === undefined || value === null) return '';
  return String(value).slice(0, 1200);
}

async function executeWindowStep(app, page, step, stepIndex, assertions, attachments) {
  const locator = step.selector ? page.locator(step.selector) : null;
  if (step.action === 'waitForSurface') return;
  if (step.action === 'click') { await locator.click({ timeout: step.timeoutMs }); return; }
  if (step.action === 'fill') { await locator.fill(step.value, { timeout: step.timeoutMs }); return; }
  if (step.action === 'press') {
    if (locator) await locator.press(step.key, { timeout: step.timeoutMs });
    else await page.keyboard.press(step.key);
    return;
  }
  if (step.action === 'screenshot') {
    pushScreenshotAttachment(attachments, { name: `electron/${step.filename}`, kind: 'electron-screenshot', content: await captureWindow(page) });
    return;
  }
  let passed = false;
  let detail = '';
  if (step.action === 'assertVisible') {
    try { await locator.waitFor({ state: 'visible', timeout: step.timeoutMs }); passed = true; } catch { passed = false; }
  } else if (step.action === 'assertText') {
    const value = await pollWindow(page, () => locator.textContent().catch(() => null), (item) => item !== null && matches(String(item), step.text, step.match), step.timeoutMs);
    passed = value !== null && matches(String(value), step.text, step.match);
    detail = assertionDetail(value);
  } else if (step.action === 'assertValue') {
    const value = await pollWindow(page, () => locator.inputValue().catch(() => null), (item) => item !== null && item === step.value, step.timeoutMs);
    passed = value === step.value;
    detail = assertionDetail(value);
  } else if (step.action === 'assertUrl') {
    const value = await pollWindow(page, () => Promise.resolve(page.url()), (item) => matches(item, step.url, step.match), step.timeoutMs);
    passed = matches(value, step.url, step.match);
    detail = assertionDetail(sanitizeUrl(value));
  }
  assertions.push({ name: assertionName(step, stepIndex), passed, ...(detail ? { detail } : {}) });
  if (!passed) throw errorWithCode(`Electron assertion failed: ${assertionName(step, stepIndex)}`, 'ELECTRON_ASSERTION_FAILED', { stepIndex });
}

async function executeGuestStep(app, step, stepIndex, assertions, attachments) {
  if (step.action === 'waitForSurface') { await waitForGuest(app, step.target, step.timeoutMs); return; }
  if (step.action === 'click' || step.action === 'fill' || step.action === 'press') {
    const deadline = Date.now() + step.timeoutMs;
    for (;;) {
      const result = await guestCommand(app, step.target, step.action, { selector: step.selector || null, value: step.value, key: step.key });
      if (result?.ok) return;
      if (Date.now() >= deadline) throw errorWithCode(`Electron webview ${step.action} failed`, result?.code || 'ELECTRON_GUEST_ACTION_FAILED', { stepIndex });
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
  if (step.action === 'screenshot') {
    const result = await guestCommand(app, step.target, 'screenshot');
    if (!result?.ok || !result.pngBase64) throw errorWithCode('Electron webview screenshot failed', result?.code || 'ELECTRON_SCREENSHOT_FAILED', { stepIndex });
    pushScreenshotAttachment(attachments, { name: `electron/${step.filename}`, kind: 'electron-webview-screenshot', content: Buffer.from(result.pngBase64, 'base64') });
    return;
  }
  let passed = false;
  let detail = '';
  if (step.action === 'assertVisible') {
    const value = await waitForGuestInspect(app, step, (item) => item.found && item.visible, step.timeoutMs);
    passed = Boolean(value?.found && value?.visible);
  } else if (step.action === 'assertText') {
    const value = await waitForGuestInspect(app, step, (item) => item.found && matches(String(item.text ?? ''), step.text, step.match), step.timeoutMs);
    passed = Boolean(value?.found && matches(String(value.text ?? ''), step.text, step.match));
    detail = assertionDetail(value?.text);
  } else if (step.action === 'assertValue') {
    const value = await waitForGuestInspect(app, step, (item) => item.found && String(item.value ?? '') === step.value, step.timeoutMs);
    passed = Boolean(value?.found && String(value.value ?? '') === step.value);
    detail = assertionDetail(value?.value);
  } else if (step.action === 'assertUrl') {
    const deadline = Date.now() + step.timeoutMs;
    let value = null;
    for (;;) {
      const result = await guestCommand(app, step.target, 'url');
      value = result?.url || '';
      if (result?.ok && matches(value, step.url, step.match)) break;
      if (Date.now() >= deadline) break;
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    passed = matches(value || '', step.url, step.match);
    detail = assertionDetail(sanitizeUrl(value));
  }
  assertions.push({ name: assertionName(step, stepIndex), passed, ...(detail ? { detail } : {}) });
  if (!passed) throw errorWithCode(`Electron assertion failed: ${assertionName(step, stepIndex)}`, 'ELECTRON_ASSERTION_FAILED', { stepIndex });
}

async function surfaceInventory(app) {
  const windows = [];
  for (const [index, surface] of (await windowSurfaces(app)).entries()) {
    windows.push({ index, title: String(surface.title || '').slice(0, 240), url: sanitizeUrl(surface.url) });
  }
  const guests = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((contents) => {
      try { return !contents.isDestroyed() && contents.getType() === 'webview'; } catch { return false; }
    })
    .sort((left, right) => left.id - right.id)
    .slice(0, MAX_SURFACES)
    .map((contents, index) => ({
      index,
      id: contents.id,
      type: contents.getType(),
      title: String(contents.getTitle() || '').slice(0, 240),
      url: contents.getURL(),
      hostId: contents.hostWebContents?.id || null
    })));
  return {
    windows,
    webviews: guests.map((item) => ({ ...item, url: sanitizeUrl(item.url) }))
  };
}

async function loadElectronAutomation() {
  try {
    const mod = await import('playwright-core');
    if (!mod?._electron?.launch) throw new Error('playwright-core does not expose _electron.launch');
    return mod._electron;
  } catch (error) {
    throw errorWithCode('Electron automation requires the pinned optional playwright-core runtime dependency', 'ELECTRON_DRIVER_UNAVAILABLE', { message: String(error?.message || error).slice(0, 500) });
  }
}

function remainingBudget(deadline, requested) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw errorWithCode('Electron validation exceeded its total timeout', 'ELECTRON_VALIDATION_TIMEOUT');
  return Math.max(1, Math.min(requested, remaining));
}

export async function runElectronValidation(electron, {
  cwd,
  environment = process.env,
  automation = null
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + electron.timeoutMs;
  const scenario = await readScenario(cwd, electron);
  const executablePath = await resolveExecutable(cwd, electron.executablePath);
  const driver = automation || await loadElectronAutomation();
  const { env, home } = await createElectronEnvironment(electron.envAllowlist, environment);
  const assertions = [];
  const attachments = [];
  const diagnostics = { consoleMessages: 0, pageErrors: 0, crashes: 0, windowsObserved: 0, webviewsObserved: 0, stepsCompleted: 0, durationMs: 0 };
  let app = null;
  let failureCode = null;
  let failureMessage = null;
  let failureStep = null;
  let finalSurfaces = { windows: [], webviews: [] };
  const boundPages = new WeakSet();
  const bindPage = (page) => {
    if (!page || boundPages.has(page)) return;
    boundPages.add(page);
    page.on?.('console', () => { diagnostics.consoleMessages += 1; });
    page.on?.('pageerror', () => { diagnostics.pageErrors += 1; });
    page.on?.('crash', () => { diagnostics.crashes += 1; });
  };
  try {
    app = await driver.launch({
      executablePath,
      args: [...electron.args],
      cwd,
      env,
      timeout: remainingBudget(deadline, electron.timeoutMs),
      chromiumSandbox: electron.chromiumSandbox
    });
    app.on?.('window', bindPage);
    for (const page of app.windows()) bindPage(page);

    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      const boundedStep = Object.freeze({ ...step, timeoutMs: remainingBudget(deadline, step.timeoutMs) });
      try {
        if (step.target.type === 'window') {
          const page = await waitForWindow(app, step.target, boundedStep.timeoutMs);
          bindPage(page);
          await executeWindowStep(app, page, boundedStep, index, assertions, attachments);
        } else {
          if (step.action !== 'waitForSurface') await waitForGuest(app, step.target, boundedStep.timeoutMs);
          await executeGuestStep(app, boundedStep, index, assertions, attachments);
        }
        diagnostics.stepsCompleted = index + 1;
      } catch (error) {
        failureCode = error?.code || 'ELECTRON_STEP_FAILED';
        failureMessage = String(error?.message || error).slice(0, 1000);
        failureStep = index;
        try {
          if (step.target.type === 'window') {
            const page = await waitForWindow(app, step.target, Math.min(1000, Math.max(1, deadline - Date.now())));
            pushScreenshotAttachment(attachments, { name: `electron/failure-step-${String(index + 1).padStart(3, '0')}.png`, kind: 'electron-failure-screenshot', content: await captureWindow(page) });
          } else {
            const shot = await guestCommand(app, step.target, 'screenshot');
            if (shot?.ok && shot.pngBase64) pushScreenshotAttachment(attachments, { name: `electron/failure-step-${String(index + 1).padStart(3, '0')}.png`, kind: 'electron-webview-failure-screenshot', content: Buffer.from(shot.pngBase64, 'base64') });
          }
        } catch {}
        break;
      }
    }

    try { finalSurfaces = await surfaceInventory(app); } catch {}
    diagnostics.windowsObserved = finalSurfaces.windows.length;
    diagnostics.webviewsObserved = finalSurfaces.webviews.length;
    if (!failureCode && attachments.length === 0 && finalSurfaces.windows.length > 0) {
      try {
        const page = await waitForWindow(app, { type: 'window', index: 0 }, Math.min(1000, Math.max(1, deadline - Date.now())));
        pushScreenshotAttachment(attachments, { name: 'electron/final.png', kind: 'electron-screenshot', content: await captureWindow(page) });
      } catch {}
    }
  } catch (error) {
    failureCode = error?.code || 'ELECTRON_VALIDATION_FAILED';
    failureMessage = String(error?.message || error).slice(0, 1000);
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    diagnostics.durationMs = Date.now() - startedAt;
  }

  const passed = !failureCode && assertions.every((item) => item.passed);
  return {
    contract: ELECTRON_VALIDATION_CONTRACT,
    passed,
    failureCode: passed ? null : (failureCode || 'ELECTRON_ASSERTION_FAILED'),
    summary: passed
      ? `Electron scenario passed ${assertions.length} assertion(s) across ${diagnostics.stepsCompleted} step(s).`
      : `Electron scenario failed${failureStep === null ? '' : ` at step ${failureStep + 1}`}: ${failureMessage || failureCode || 'unknown failure'}`,
    assertions,
    surfaces: finalSurfaces,
    diagnostics,
    attachments
  };
}
